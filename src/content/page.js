import { loadSettings, loadToken, loadPrLocal, updatePrLocal, parsePrUrl, prStorageKey } from "../settings.js";
import { parseRulesText } from "../rules.js";
import { orderFiles, groupFiles, progress, neighbourFile, nextPendingFile, positionInGroup, isViewed } from "../review_model.js";
import { findRenderedFiles, fileAtViewportLine, anchorIdFor, findFileLink, scrollToContainer, waitFor, isTypingTarget, controlForElement, describeUnmatched, describeViewedCandidates } from "./dom.js";
import { StickyBar } from "./sticky_bar.js";
import { Drawer } from "./drawer.js";

const FILES_TABS = new Set(["files", "changes"]);
// Horizontal line (px from the top of the viewport) that decides which file is "current":
// below GitHub's sticky toolbar and sticky file header.
const CURRENT_FILE_LINE = 160;
const RENDER_TIMEOUT_MS = 3000;
// After a programmatic scroll, scroll events must not re-detect the current file.
const DETECT_PAUSE_MS = 600;

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
    this.injectStylesheet();
    document.addEventListener("keydown", (event) => this.onKeyDown(event), true);
    document.addEventListener("change", (event) => this.onCheckboxChange(event), true);
    document.addEventListener("click", (event) => setTimeout(() => this.onCheckboxChange(event), 50), true);
    chrome.runtime.onMessage.addListener((message) => {
      this.onMessage(message);
    });
    chrome.storage.onChanged.addListener((changes, area) => this.onStorageChanged(changes, area));
    // Mutations inside our own bar, help and sidebar never change GitHub's file blocks.
    new MutationObserver((mutations) => {
      if (mutations.some((mutation) => !this.isOwnNode(mutation.target))) {
        this.pageMutated = true;
        this.scheduleRescan();
      }
    }).observe(document.documentElement, { childList: true, subtree: true });
    window.addEventListener("scroll", () => this.scheduleDetect(), { passive: true });
    window.addEventListener("hashchange", () => this.scheduleRescan());
    // The embedded panel asks for the current file when it (re)loads.
    window.addEventListener("message", (event) => {
      if (event.data?.source !== "adhd-review" || event.data.type !== "requestState" || !this.pr) return;
      if (event.source !== this.drawer.frame.contentWindow) return;
      this.drawer.notify({ type: "currentFile", prKey: this.pr.prKey, path: this.currentPath });
    });
    // The window blurs when the focus enters the sidebar's iframe: show it.
    window.addEventListener("blur", () => setTimeout(() => this.drawer.setFocused(document.activeElement === this.drawer.frame), 0));
    window.addEventListener("focus", () => this.drawer.setFocused(false));
    setInterval(() => this.checkUrl(), 500);
    this.checkUrl();
  }

  isOwnNode(node) {
    const element = node instanceof Element ? node : node.parentElement;
    return Boolean(element?.closest("#adhd-review-bar, #adhd-review-help, #adhd-review-drawer, #adhd-review-icon, #adhd-review-edge"));
  }

  // The manifest also declares the stylesheet, but a copy appended last in <head> wins
  // ties against GitHub's rules and is re-read on every page load.
  async injectStylesheet() {
    try {
      const css = await (await fetch(chrome.runtime.getURL("src/content/sticky_bar.css"))).text();
      const style = document.createElement("style");
      style.id = "adhd-review-style";
      style.textContent = css;
      (document.head || document.documentElement).append(style);
    } catch (error) {
      console.warn("[adhd-review] stylesheet injection failed", error);
    }
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
    this.bar.setColor(this.settings.progressColor);
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
    this.celebrateCompletedGroups();
    this.render();
  }

  celebrateCompletedGroups() {
    const done = new Set(this.groups.filter((group) => group.viewedFiles === group.totalFiles).map((group) => group.label));
    const allDone = this.ordered.length > 0 && this.ordered.every(isViewed);
    if (this.doneGroups && this.doneGroupsKey === this.pr.prKey) {
      if (allDone && !this.allDone) {
        this.bar.showMessage(`🎉🎉🎉 All ${this.ordered.length} files reviewed! Open the panel (<kbd>${escapeHtml(this.settings.keys.panel)}</kbd>) for the wrap-up.`, { sticky: true });
        this.bar.pulse();
      } else {
        const completed = [...done].filter((label) => !this.doneGroups.has(label));
        if (completed.length > 0) {
          this.bar.showMessage(`🎉 ${escapeHtml(completed.join(", "))} complete!`);
          this.bar.pulse();
        }
      }
    }
    this.doneGroups = done;
    this.allDone = allDone;
    this.doneGroupsKey = this.pr.prKey;
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
    const startedAt = performance.now();
    this.rendered = findRenderedFiles(this.knownPaths, this.rendered);
    this.recordScan(performance.now() - startedAt);
    this.reportUnmatchedOnce();
    this.detect();
  }

  // Every 25 scans, the average and worst durations are logged once as a warning when
  // scans are expensive on this page.
  recordScan(elapsed) {
    this.scanStats = this.scanStats || { count: 0, total: 0, max: 0 };
    const stats = this.scanStats;
    stats.count += 1;
    stats.total += elapsed;
    stats.max = Math.max(stats.max, elapsed);
    if (stats.count % 25 === 0 && stats.total / stats.count > 40) {
      console.warn("[adhd-review] scan stats", JSON.stringify({ scans: stats.count, averageMs: Math.round(stats.total / stats.count), maxMs: Math.round(stats.max), ...describeUnmatched(this.knownPaths, this.rendered, 0) }));
    }
  }

  // Once per page: if some "Viewed" checkboxes could not be attached to a file, log a
  // snippet of their markup so the matching can be adjusted to GitHub's DOM.
  reportUnmatchedOnce() {
    if (this.reportedUnmatched) return;
    const report = describeUnmatched(this.knownPaths, this.rendered);
    if (report.checkboxes === 0) {
      // No control recognised at all: show what carries the text "Viewed" on this page.
      const candidates = describeViewedCandidates();
      if (candidates.length === 0) return;
      this.reportedUnmatched = true;
      console.warn("[adhd-review] no Viewed control recognised; markup around the text Viewed:", JSON.stringify(candidates));
      return;
    }
    this.reportedUnmatched = true;
    if (report.unmatched > 0) console.warn("[adhd-review] unmatched file headers", JSON.stringify(report));
    else console.debug("[adhd-review] all rendered files matched", report);
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
    if (!this.remote || performance.now() < (this.detectPausedUntil || 0)) return;
    const path = fileAtViewportLine(this.rendered, CURRENT_FILE_LINE);
    if (path && path !== this.currentPath) this.setCurrent(path);
  }

  setCurrent(path) {
    this.currentPath = path;
    this.render();
    // The panel is told right away; storage keeps it for a panel opened later.
    const message = { type: "currentFile", prKey: this.pr.prKey, path };
    this.drawer.notify(message);
    chrome.runtime.sendMessage(message).catch(() => {});
    clearTimeout(this.saveCurrentTimer);
    this.saveCurrentTimer = setTimeout(() => updatePrLocal(this.pr.prKey, { currentPath: path }), 300);
  }

  // ---- navigation --------------------------------------------------------

  async goToFile(path) {
    if (!path) return;
    const timings = [];
    const lap = (label, startedAt) => timings.push(`${label} ${Math.round(performance.now() - startedAt)}ms`);
    const startedAt = performance.now();
    let entry = this.rendered.get(path);
    if (!entry) {
      let phase = performance.now();
      const anchorId = await anchorIdFor(path);
      lap("anchor", phase);
      if (this.pendingReloadPath === path) {
        location.hash = anchorId;
        location.reload();
        return;
      }
      phase = performance.now();
      const link = findFileLink(path, anchorId);
      if (link) link.click();
      else location.hash = anchorId;
      lap(link ? "tree click" : "hash", phase);
      phase = performance.now();
      // Rescan only after the page mutated: polling with full scans starves GitHub's
      // own rendering. Halfway through, the URL hash is tried as a second strategy.
      this.pageMutated = true;
      let hashTried = !link;
      entry = await waitFor(() => {
        if (!hashTried && performance.now() - phase > RENDER_TIMEOUT_MS / 2) {
          hashTried = true;
          location.hash = anchorId;
          this.pageMutated = true;
        }
        if (!this.pageMutated) return null;
        this.pageMutated = false;
        this.rendered = findRenderedFiles(this.knownPaths, this.rendered);
        return this.rendered.get(path);
      }, RENDER_TIMEOUT_MS, 100);
      lap("wait render", phase);
      if (performance.now() - startedAt > 2000) {
        console.warn("[adhd-review] slow jump to", path, timings.join(", "), JSON.stringify(describeUnmatched(this.knownPaths, this.rendered, 1)));
      }
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
    this.detectPausedUntil = performance.now() + DETECT_PAUSE_MS;
    this.setCurrent(path);
  }

  goToNeighbour(direction) {
    const target = neighbourFile(this.ordered, this.currentPath, direction);
    return this.goToFile(target?.path);
  }

  // `from` is the file the action acted on: the current file may already have moved
  // (GitHub collapses a viewed file and the page reflows) by the time the jump starts.
  goToNextPending(from = this.currentPath) {
    const target = nextPendingFile(this.ordered, from, this.laterPaths());
    if (!target) {
      this.bar.showMessage("Nothing left to review: every file is viewed or flagged for later. Time for the wrap-up.");
      return Promise.resolve();
    }
    return this.goToFile(target.path);
  }

  // ---- actions -----------------------------------------------------------

  // GitHub's own checkbox is the source of truth whenever the file is on the page:
  // clicking it updates GitHub's state and its counters instantly. The API is only
  // used for files GitHub has not rendered.
  pageCheckbox(path) {
    let entry = this.rendered.get(path);
    if (!entry?.checkbox?.isConnected) {
      this.rendered = findRenderedFiles(this.knownPaths, this.rendered);
      entry = this.rendered.get(path);
    }
    return entry?.checkbox?.isConnected ? entry.checkbox : null;
  }

  applyViewedLocally(path, viewed) {
    const state = viewed ? "VIEWED" : "UNVIEWED";
    for (const file of [this.fileAt(path), this.remote.files.find((candidate) => candidate.path === path)]) {
      if (file) file.viewerViewedState = state;
    }
    this.compute();
  }

  async setViewed(path, viewed) {
    if (!this.fileAt(path)) return false;
    this.applyViewedLocally(path, viewed);
    const checkbox = this.pageCheckbox(path);
    if (checkbox) {
      // GitHub confirms the tick only once its own request completes, which can take a
      // while when several marks are in flight: click once, move on, verify later.
      // A second click would untoggle it.
      if (checkbox.checked !== viewed) {
        checkbox.click();
        this.verifyTick(path, checkbox, viewed);
      }
      await this.send({ type: "setViewed", prKey: this.pr.prKey, path, viewed, appliedOnPage: true });
      return true;
    }
    this.bar.beginBusy(viewed ? "marking through the API…" : "unmarking through the API…");
    const response = await this.send({ type: "setViewed", prKey: this.pr.prKey, path, viewed, appliedOnPage: false });
    this.bar.endBusy();
    if (!response.ok) {
      this.bar.showMessage(escapeHtml(response.error), { sticky: true });
      await this.load({ force: true });
      return false;
    }
    return true;
  }

  async verifyTick(path, checkbox, viewed) {
    const current = () => (checkbox.isConnected ? checkbox : this.pageCheckbox(path));
    this.bar.beginBusy(viewed ? "waiting for GitHub to tick…" : "waiting for GitHub to untick…");
    const settled = await waitFor(() => current()?.checked === viewed, 5000, 150);
    if (settled || !current()) {
      this.bar.endBusy();
      return;
    }
    const response = await this.send({ type: "setViewed", prKey: this.pr.prKey, path, viewed, appliedOnPage: false });
    this.bar.endBusy();
    this.bar.showMessage(
      response.ok
        ? `GitHub's checkbox did not react for <code>${escapeHtml(path)}</code>; marked through the API (reload to see it ticked)`
        : escapeHtml(response.error)
    );
  }

  async actionViewed() {
    const file = this.fileAt(this.currentPath);
    if (!file) return this.goToNextPending();
    const checkbox = this.pageCheckbox(file.path);
    if (isViewed(file) && (!checkbox || checkbox.checked)) {
      this.bar.showMessage("Already viewed, moving on");
      return this.goToNextPending(file.path);
    }
    if (await this.setViewed(file.path, true)) await this.goToNextPending(file.path);
  }

  async actionUnview() {
    const file = this.fileAt(this.currentPath);
    if (!file) return;
    const checkbox = this.pageCheckbox(file.path);
    if (!isViewed(file) && (!checkbox || !checkbox.checked)) {
      this.bar.showMessage("Not viewed yet");
      return;
    }
    if (await this.setViewed(file.path, false)) this.bar.showMessage("Unmarked as viewed");
  }

  // The user may tick GitHub's checkbox with the mouse: keep the state in sync.
  onCheckboxChange(event) {
    if (!this.remote) return;
    const control = controlForElement(event.target);
    if (!control) return;
    const path = [...this.rendered].find(([, entry]) => entry.checkbox.element === control.element)?.[0];
    if (!path) return;
    const file = this.fileAt(path);
    if (!file || isViewed(file) === control.checked) return;
    this.applyViewedLocally(path, control.checked);
    this.send({ type: "setViewed", prKey: this.pr.prKey, path, viewed: control.checked, appliedOnPage: true });
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
    if (flagged) await this.goToNextPending(file.path);
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
    const from = this.currentPath;
    for (const file of pending) {
      if (!(await this.setViewed(file.path, true))) return;
    }
    await this.goToNextPending(from);
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

  // Moves the keyboard focus out of the panel's iframe back into the page, on an
  // element of ours so GitHub's own focus styles are not triggered.
  focusPage() {
    window.focus();
    this.bar.focusSink.focus({ preventScroll: true });
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
    const action = this.actionForKey(event.key);
    if (!action) return;
    event.preventDefault();
    event.stopPropagation();
    this.runAction(action);
  }

  actionForKey(key) {
    const keys = this.settings?.keys || {};
    return Object.keys(keys).find((name) => keys[name] === key) || null;
  }

  // Actions run one at a time: a second key pressed while the first is still
  // marking and scrolling must act on the file reached, not on the previous one.
  runAction(action) {
    if (action !== "help") this.bar.hideHelp();
    // A hung action (a frame that never loads, a request that never answers) must not
    // block every following key: each one is capped at 15 seconds.
    const capped = () =>
      Promise.race([
        Promise.resolve(this.performAction(action)),
        new Promise((resolve) => setTimeout(() => resolve(console.warn("[adhd-review] action timed out", action)), 15000)),
      ]);
    this.queue = (this.queue || Promise.resolve()).then(capped).catch((error) => console.error("[adhd-review] action failed", action, error));
    return this.queue;
  }

  performAction(action) {
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
        return this.bar.toggleHelp(this.settings.keys);
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
      case "keyPress":
        if (message.prKey === this.pr.prKey && this.remote) {
          const action = this.actionForKey(message.key);
          if (action) await this.runAction(action);
        }
        break;
      case "focusPage":
        this.focusPage();
        break;
      case "closePanel":
        this.drawer.close();
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
