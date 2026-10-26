import { loadSettings, loadToken, loadPrLocal, updatePrLocal, parsePrUrl, prStorageKey } from "../settings.js";
import { parseRulesText } from "../rules.js";
import { orderFiles, groupFiles, progress, neighbourFile, nextPendingFile, positionInGroup, isViewed } from "../review_model.js";
import { findRenderedFiles, fileAtViewportLine, anchorIdFor, findFileLink, scrollToContainer, waitFor, isTypingTarget } from "./dom.js";
import { StickyBar } from "./sticky_bar.js";
import { Drawer } from "./drawer.js";

const FILES_TABS = new Set(["files", "changes"]);
// Horizontal line (px from the top of the viewport) that decides which file is "current":
// below GitHub's sticky toolbar and sticky file header.
const CURRENT_FILE_LINE = 160;
const RENDER_TIMEOUT_MS = 4000;

class ReviewPage {
  constructor() {
    this.bar = new StickyBar({ onOpenPanel: () => this.drawer.toggle(), onCopyPath: () => this.copyPath() });
    this.drawer = new Drawer({ onToggle: (open, width) => this.bar.setRightOffset(open ? width : 0) });
    this.activeKey = null;
    this.pr = null;
    this.remote = null;
    this.local = null;
    this.settings = null;
    this.ordered = [];
    this.groups = [];
    this.knownPaths = new Set();
    this.rendered = new Map();
    this.currentPath = null;
    this.pendingReloadPath = null;
    this.rescanTimer = null;
    this.detectScheduled = false;
    this.saveCurrentTimer = null;
  }

  start() {
    document.addEventListener("keydown", (event) => this.onKeyDown(event), true);
    chrome.runtime.onMessage.addListener((message) => {
      this.onMessage(message);
    });
    chrome.storage.onChanged.addListener((changes, area) => this.onStorageChanged(changes, area));
    new MutationObserver(() => this.scheduleRescan()).observe(document.documentElement, { childList: true, subtree: true });
    window.addEventListener("scroll", () => this.scheduleDetect(), { passive: true });
    window.addEventListener("hashchange", () => this.scheduleRescan());
    setInterval(() => this.checkUrl(), 500);
    this.checkUrl();
  }

  // GitHub navigates without reloading: watch the URL.
  checkUrl() {
    const info = parsePrUrl(location.href);
    const active = Boolean(info && FILES_TABS.has(info.tab));
    const key = active ? info.prKey : null;
    if (key === this.activeKey) return;
    this.activeKey = key;
    if (!active) {
      this.bar.unmount();
      this.drawer.unmount();
      this.pr = null;
      this.remote = null;
      return;
    }
    this.pr = info;
    this.currentPath = null;
    this.load();
  }

  async load({ force = false } = {}) {
    this.bar.mount();
    this.drawer.mount();
    this.drawer.restore();
    this.settings = await loadSettings();
    this.bar.setKeys(this.settings.keys);
    this.bar.render({ progress: null });
    if (!(await loadToken())) {
      this.bar.showMessage('No GitHub token yet: <a href="#" class="adhd-options">open the options</a>', { sticky: true });
      this.bar.message.querySelector(".adhd-options").addEventListener("click", (event) => {
        event.preventDefault();
        this.send({ type: "openOptions" });
      });
      return;
    }
    this.bar.showMessage("Loading pull request from GitHub…", { sticky: true });
    const response = await this.send({ type: "loadPr", prKey: this.pr.prKey, force });
    if (!response.ok) {
      this.bar.showMessage(escapeHtml(response.error), { sticky: true });
      return;
    }
    this.remote = response.result;
    this.local = await loadPrLocal(this.pr.prKey);
    this.bar.clearMessage();
    this.compute();
    this.rescan();
  }

  compute() {
    if (!this.remote) return;
    const { rules } = parseRulesText(this.settings.rulesText);
    this.ordered = orderFiles(this.remote.files, rules, { lineCap: this.settings.lineCap });
    this.groups = groupFiles(this.ordered);
    this.knownPaths = new Set(this.ordered.map((file) => file.path));
    this.render();
  }

  render() {
    if (!this.remote) return;
    const file = this.fileAt(this.currentPath);
    const position = file ? positionInGroup(this.groups, file.path) : null;
    this.bar.render({
      group: file?.group,
      position,
      path: file?.path,
      viewed: file ? isViewed(file) : false,
      later: file ? Boolean(this.local?.later?.[file.path]) : false,
      progress: progress(this.ordered),
    });
  }

  fileAt(path) {
    return this.ordered.find((file) => file.path === path) || null;
  }

  laterPaths() {
    return new Set(Object.keys(this.local?.later || {}).filter((path) => this.local.later[path]));
  }

  // ---- page observation --------------------------------------------------

  scheduleRescan() {
    clearTimeout(this.rescanTimer);
    this.rescanTimer = setTimeout(() => this.rescan(), 250);
  }

  rescan() {
    if (!this.remote) return;
    this.rendered = findRenderedFiles(this.knownPaths);
    this.detect();
  }

  scheduleDetect() {
    if (this.detectScheduled) return;
    this.detectScheduled = true;
    requestAnimationFrame(() => {
      this.detectScheduled = false;
      this.detect();
    });
  }

  detect() {
    if (!this.remote) return;
    const path = fileAtViewportLine(this.rendered, CURRENT_FILE_LINE);
    if (path && path !== this.currentPath) this.setCurrent(path);
  }

  setCurrent(path) {
    this.currentPath = path;
    this.render();
    clearTimeout(this.saveCurrentTimer);
    this.saveCurrentTimer = setTimeout(() => updatePrLocal(this.pr.prKey, { currentPath: path }), 300);
  }

  // ---- navigation --------------------------------------------------------

  async goToFile(path) {
    if (!path) return;
    let entry = this.rendered.get(path);
    if (!entry) {
      const anchorId = await anchorIdFor(path);
      if (this.pendingReloadPath === path) {
        location.hash = anchorId;
        location.reload();
        return;
      }
      const link = findFileLink(path, anchorId);
      if (link) link.click();
      else location.hash = anchorId;
      entry = await waitFor(() => {
        this.rendered = findRenderedFiles(this.knownPaths);
        return this.rendered.get(path);
      }, RENDER_TIMEOUT_MS);
      if (!entry) {
        this.pendingReloadPath = path;
        this.bar.showMessage(`GitHub did not render <code>${escapeHtml(path)}</code>; press the same key again to reload the page on it.`);
        this.currentPath = path;
        this.render();
        return;
      }
    }
    this.pendingReloadPath = null;
    scrollToContainer(entry.container, this.settings.scrollOffset);
    this.setCurrent(path);
  }

  goToNeighbour(direction) {
    const target = neighbourFile(this.ordered, this.currentPath, direction);
    return this.goToFile(target?.path);
  }

  goToNextPending() {
    const target = nextPendingFile(this.ordered, this.currentPath, this.laterPaths());
    if (!target) {
      this.bar.showMessage("Nothing left to review: every file is viewed or flagged for later. Time for the wrap-up.");
      return Promise.resolve();
    }
    return this.goToFile(target.path);
  }

  // ---- actions -----------------------------------------------------------

  async setViewed(path, viewed) {
    const file = this.fileAt(path);
    if (!file) return false;
    const entry = this.rendered.get(path);
    let appliedOnPage = false;
    if (entry?.checkbox) {
      if (entry.checkbox.checked !== viewed) entry.checkbox.click();
      appliedOnPage = true;
    }
    file.viewerViewedState = viewed ? "VIEWED" : "UNVIEWED";
    const remoteFile = this.remote.files.find((candidate) => candidate.path === path);
    if (remoteFile) remoteFile.viewerViewedState = file.viewerViewedState;
    this.compute();
    const response = await this.send({ type: "setViewed", prKey: this.pr.prKey, path, viewed, appliedOnPage });
    if (!response.ok) {
      this.bar.showMessage(escapeHtml(response.error), { sticky: true });
      await this.load({ force: true });
      return false;
    }
    return true;
  }

  async actionViewed() {
    const file = this.fileAt(this.currentPath);
    if (!file) return this.goToNextPending();
    if (isViewed(file)) {
      this.bar.showMessage("Already viewed, moving on");
      return this.goToNextPending();
    }
    if (await this.setViewed(file.path, true)) await this.goToNextPending();
  }

  async actionUnview() {
    const file = this.fileAt(this.currentPath);
    if (!file) return;
    if (!isViewed(file)) {
      this.bar.showMessage("Not viewed yet");
      return;
    }
    if (await this.setViewed(file.path, false)) this.bar.showMessage("Unmarked as viewed");
  }

  async actionLater() {
    const file = this.fileAt(this.currentPath);
    if (!file) return;
    const later = { ...(this.local.later || {}) };
    const flagged = !later[file.path];
    if (flagged) later[file.path] = true;
    else delete later[file.path];
    this.local = await updatePrLocal(this.pr.prKey, { later });
    this.render();
    if (flagged) await this.goToNextPending();
    else this.bar.showMessage("Later flag removed");
  }

  async actionMarkGroup() {
    const position = positionInGroup(this.groups, this.currentPath);
    if (!position) return;
    const pending = position.group.files.filter((file) => !isViewed(file));
    if (pending.length === 0) {
      this.bar.showMessage(`"${escapeHtml(position.group.label)}" is already fully viewed`);
      return;
    }
    if (!window.confirm(`Mark the ${pending.length} remaining file(s) of "${position.group.label}" as viewed?`)) return;
    for (const file of pending) {
      if (!(await this.setViewed(file.path, true))) return;
    }
    await this.goToNextPending();
  }

  async actionNote() {
    const path = this.currentPath;
    if (!path) return;
    const notes = (this.local.notes || "").replace(/\s+$/, "");
    this.local = await updatePrLocal(this.pr.prKey, { notes: `${notes}${notes ? "\n" : ""}- ${path}: ` });
    await this.drawer.open();
    setTimeout(() => this.drawer.send({ type: "focusNotes", prKey: this.pr.prKey }), 150);
  }

  // The native Chrome side panel opens from the toolbar icon; from the page, the
  // in-page drawer is used because chrome.sidePanel.open() needs a user gesture in the
  // extension's own context and a relayed key press does not reliably qualify.
  openPanel() {
    return this.drawer.toggle();
  }

  async copyPath() {
    if (!this.currentPath) return;
    await navigator.clipboard.writeText(this.currentPath);
    this.bar.showMessage("Path copied");
  }

  onKeyDown(event) {
    if (!this.pr || !this.remote || event.isComposing || isTypingTarget(event.target)) return;
    if (event.altKey && event.code === "KeyN" && !event.metaKey && !event.ctrlKey) {
      event.preventDefault();
      event.stopPropagation();
      this.actionNote();
      return;
    }
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    const keys = this.settings.keys;
    const action = Object.keys(keys).find((name) => keys[name] === event.key);
    if (!action) return;
    event.preventDefault();
    event.stopPropagation();
    this.bar.hideHelp();
    switch (action) {
      case "next":
        return this.goToNeighbour(1);
      case "previous":
        return this.goToNeighbour(-1);
      case "viewed":
        return this.actionViewed();
      case "unview":
        return this.actionUnview();
      case "later":
        return this.actionLater();
      case "nextPending":
        return this.goToNextPending();
      case "markGroup":
        return this.actionMarkGroup();
      case "panel":
        return this.openPanel();
      case "refresh":
        return this.load({ force: true });
      case "help":
        return this.bar.toggleHelp(keys);
      default:
        return undefined;
    }
  }

  // ---- messages and storage ---------------------------------------------

  async onMessage(message) {
    if (!this.pr) return;
    switch (message.type) {
      case "goToFile":
        if (message.prKey === this.pr.prKey) await this.goToFile(message.path);
        break;
      case "goToComment":
        if (message.prKey === this.pr.prKey) {
          await this.goToFile(message.path);
          const anchor = `r${message.databaseId}`;
          const target = await waitFor(() => document.getElementById(anchor), 1500);
          if (target) target.scrollIntoView({ block: "center" });
          else location.hash = anchor;
        }
        break;
      case "remoteStateChanged":
        if (message.prKey === this.pr.prKey) {
          const response = await this.send({ type: "loadPr", prKey: this.pr.prKey });
          if (response.ok) {
            this.remote = response.result;
            this.compute();
          }
        }
        break;
      default:
        break;
    }
  }

  onStorageChanged(changes, area) {
    if (area !== "local" || !this.pr) return;
    const change = changes[prStorageKey(this.pr.prKey)];
    if (change?.newValue) {
      this.local = { later: {}, notes: "", currentPath: null, ...change.newValue };
      this.render();
    }
    if (changes.settings || changes.token) this.load();
  }

  send(message) {
    return chrome.runtime.sendMessage(message).catch((error) => ({ ok: false, error: error.message }));
  }
}

function escapeHtml(text) {
  return String(text).replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
}

new ReviewPage().start();
