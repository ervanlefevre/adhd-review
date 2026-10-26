import { loadSettings, loadToken, loadPrLocal, updatePrLocal, parsePrUrl, prStorageKey } from "../settings.js";
import { parseRulesText } from "../rules.js";
import { orderFiles, groupFiles, progress, isViewed, changedLines } from "../review_model.js";

const elements = Object.fromEntries(
  [
    "prLink", "prNumber", "refresh", "notice", "percent", "counts", "overallFill", "groups", "addFileNote", "notes",
    "commentsCount", "comments", "notesPreview", "laterCount", "later", "reviewBody", "submitResult",
  ].map((id) => [id, document.getElementById(id)])
);
const tabs = [...document.querySelectorAll("nav.tabs button")];
const sections = { progress: document.getElementById("tab-progress"), notes: document.getElementById("tab-notes"), wrapup: document.getElementById("tab-wrapup") };
const submitButtons = [...document.querySelectorAll(".submit-row button")];

const state = { tabId: null, prKey: null, remote: null, local: null, settings: null, ordered: [], groups: [] };
let notesSaveTimer = null;

// ---- tab resolution -------------------------------------------------------

async function resolveTab() {
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  const info = tab ? parsePrUrl(tab.url) : null;
  const prKey = info?.prKey || null;
  const changed = prKey !== state.prKey || tab?.id !== state.tabId;
  state.tabId = tab?.id ?? null;
  state.prKey = prKey;
  if (changed) await load();
}

chrome.tabs.onActivated.addListener(resolveTab);
chrome.tabs.onUpdated.addListener((tabId, change) => {
  if (change.url && tabId === state.tabId) resolveTab();
});
chrome.windows.onFocusChanged.addListener((windowId) => {
  if (windowId !== chrome.windows.WINDOW_ID_NONE) resolveTab();
});

// ---- loading --------------------------------------------------------------

async function load({ force = false } = {}) {
  state.settings = await loadSettings();
  if (!state.prKey) {
    state.remote = null;
    notice("Open a pull request's Files changed tab on github.com.");
    renderAll();
    return;
  }
  if (!(await loadToken())) {
    notice("No GitHub token yet. Add one in the extension options.", { options: true });
    renderAll();
    return;
  }
  notice("Loading…");
  const response = await chrome.runtime.sendMessage({ type: "loadPr", prKey: state.prKey, force });
  if (!response.ok) {
    state.remote = null;
    notice(response.error, { error: true });
    renderAll();
    return;
  }
  state.remote = response.result;
  state.local = await loadPrLocal(state.prKey);
  notice(null);
  compute();
  renderAll();
}

function compute() {
  if (!state.remote) return;
  const { rules } = parseRulesText(state.settings.rulesText);
  state.ordered = orderFiles(state.remote.files, rules, { lineCap: state.settings.lineCap });
  state.groups = groupFiles(state.ordered);
}

function notice(text, { error = false, options = false } = {}) {
  elements.notice.hidden = !text;
  elements.notice.textContent = text || "";
  elements.notice.className = `notice ${error ? "error" : ""}`;
  if (options) {
    const link = document.createElement("button");
    link.className = "link";
    link.textContent = "Open options";
    link.addEventListener("click", () => chrome.runtime.openOptionsPage());
    elements.notice.append(" ", link);
  }
}

// ---- rendering ------------------------------------------------------------

function renderAll() {
  renderHeader();
  renderProgress();
  renderNotes();
  renderWrapUp();
}

function renderHeader() {
  if (!state.remote) {
    elements.prLink.textContent = "ADHD Review";
    elements.prLink.href = "#";
    elements.prNumber.textContent = "";
    return;
  }
  elements.prLink.textContent = state.remote.title;
  elements.prLink.title = state.remote.title;
  elements.prLink.href = state.remote.url;
  elements.prNumber.textContent = `#${state.prKey.split("#")[1]}`;
}

function renderProgress() {
  if (!state.remote) {
    elements.percent.textContent = "–";
    elements.counts.textContent = "";
    elements.overallFill.style.width = "0%";
    elements.groups.replaceChildren();
    return;
  }
  const total = progress(state.ordered);
  elements.percent.textContent = `${total.percent}%`;
  elements.counts.textContent = `${total.viewedFiles}/${total.totalFiles} files · ~${total.remainingLines.toLocaleString("fr-FR")} lines left`;
  elements.overallFill.style.width = `${total.percent}%`;

  const commentsByPath = countComments();
  const later = state.local?.later || {};
  const currentPath = state.local?.currentPath;
  const openGroups = new Set([...elements.groups.querySelectorAll("details[open]")].map((details) => details.dataset.label));
  const firstRender = elements.groups.childElementCount === 0;

  elements.groups.replaceChildren(
    ...state.groups.map((group) => {
      const done = group.viewedFiles === group.totalFiles;
      const details = element("details", { className: `group ${done ? "done" : ""}`, dataset: { label: group.label } });
      const containsCurrent = group.files.some((file) => file.path === currentPath);
      details.open = firstRender ? !done || containsCurrent : openGroups.has(group.label) || containsCurrent;
      const summary = element("summary");
      summary.append(element("span", { className: "label", textContent: group.label }));
      const count = element("span", { className: "count", textContent: `${group.viewedFiles}/${group.totalFiles}` });
      if (!done) {
        const markAll = element("button", { className: "small", textContent: "Mark all viewed", title: "Mark every remaining file of this group as viewed" });
        markAll.addEventListener("click", (event) => {
          event.preventDefault();
          event.stopPropagation();
          markGroupViewed(group);
        });
        count.prepend(markAll);
      }
      summary.append(count);
      summary.append(element("div", { className: "track small" }, element("div", { className: "fill", style: `width: ${group.percent}%` })));
      details.append(summary);

      const list = element("ul", { className: "files" });
      for (const file of group.files) {
        const viewed = isViewed(file);
        const item = element("li", { className: `${viewed ? "viewed" : ""} ${file.path === currentPath ? "current" : ""}`, title: file.path });
        item.append(element("span", { className: "icon", textContent: viewed ? "✓" : "·" }));
        const slash = file.path.lastIndexOf("/");
        const name = element("span", { className: "name" });
        name.append(element("span", { className: "dir", textContent: slash === -1 ? "" : file.path.slice(0, slash + 1) }), file.path.slice(slash + 1));
        item.append(name);
        if (commentsByPath[file.path]) item.append(element("span", { className: "badge comments", textContent: `💬 ${commentsByPath[file.path]}` }));
        if (later[file.path]) item.append(element("span", { className: "badge later", textContent: "later" }));
        item.append(element("span", { className: "lines", textContent: `${changedLines(file)}` }));
        item.addEventListener("click", () => goToFile(file.path));
        list.append(item);
      }
      details.append(list);
      return details;
    })
  );
  elements.groups.querySelector("li.current")?.scrollIntoView({ block: "nearest" });
}

function countComments() {
  const counts = {};
  for (const comment of state.remote?.pendingReview?.comments || []) counts[comment.path] = (counts[comment.path] || 0) + 1;
  return counts;
}

function renderNotes() {
  const notes = state.local?.notes || "";
  const textarea = elements.notes;
  textarea.disabled = !state.prKey;
  if (document.activeElement !== textarea || notes.startsWith(textarea.value)) {
    if (textarea.value !== notes) {
      textarea.value = notes;
      if (document.activeElement === textarea) textarea.setSelectionRange(notes.length, notes.length);
    }
  }
}

function renderWrapUp() {
  const comments = state.remote?.pendingReview?.comments || [];
  elements.commentsCount.textContent = comments.length ? `(${comments.length})` : "";
  elements.comments.replaceChildren(
    ...(comments.length
      ? comments.map((comment) => {
          const box = element("div", { className: `comment ${comment.outdated ? "outdated" : ""}` });
          const jump = element("button", { className: "link", textContent: `${comment.path}${comment.line ? `:${comment.line}` : ""}` });
          jump.addEventListener("click", () => goToComment(comment));
          box.append(element("div", { className: "where" }, jump), element("div", { className: "body", textContent: comment.body }));
          return box;
        })
      : [element("div", { className: "empty", textContent: state.remote ? "No pending comment on this pull request." : "" })])
  );
  elements.notesPreview.textContent = state.local?.notes || "(no notes)";

  const laterPaths = Object.keys(state.local?.later || {}).filter((path) => state.local.later[path]);
  elements.laterCount.textContent = laterPaths.length ? `(${laterPaths.length})` : "";
  elements.later.replaceChildren(
    ...(laterPaths.length
      ? laterPaths.map((path) => {
          const item = element("li");
          const jump = element("button", { className: "link name", textContent: path, title: path });
          jump.addEventListener("click", () => goToFile(path));
          const clear = element("button", { className: "small", textContent: "Done" });
          clear.addEventListener("click", () => clearLater(path));
          item.append(jump, clear);
          return item;
        })
      : [element("li", { className: "muted", textContent: "Nothing flagged." })])
  );
  for (const button of submitButtons) button.disabled = !state.remote;
}

function element(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (key === "dataset") Object.assign(node.dataset, value);
    else if (key === "style") node.setAttribute("style", value);
    else node[key] = value;
  }
  node.append(...children);
  return node;
}

// ---- actions --------------------------------------------------------------

function goToFile(path) {
  if (state.tabId === null) return;
  chrome.tabs.sendMessage(state.tabId, { type: "goToFile", prKey: state.prKey, path }).catch(() => {});
}

function goToComment(comment) {
  if (state.tabId === null) return;
  chrome.tabs.sendMessage(state.tabId, { type: "goToComment", prKey: state.prKey, path: comment.path, databaseId: comment.databaseId }).catch(() => {});
}

async function markGroupViewed(group) {
  const pending = group.files.filter((file) => !isViewed(file));
  if (!window.confirm(`Mark the ${pending.length} remaining file(s) of "${group.label}" as viewed on GitHub?`)) return;
  for (const file of pending) {
    const response = await chrome.runtime.sendMessage({ type: "setViewed", prKey: state.prKey, path: file.path, viewed: true, appliedOnPage: false });
    if (!response.ok) {
      notice(response.error, { error: true });
      return;
    }
  }
}

async function clearLater(path) {
  const later = { ...(state.local.later || {}) };
  delete later[path];
  state.local = await updatePrLocal(state.prKey, { later });
}

elements.notes.addEventListener("input", () => {
  clearTimeout(notesSaveTimer);
  const value = elements.notes.value;
  notesSaveTimer = setTimeout(async () => {
    if (state.prKey) state.local = await updatePrLocal(state.prKey, { notes: value });
  }, 400);
});

elements.addFileNote.addEventListener("click", () => {
  const path = state.local?.currentPath;
  if (!path) return;
  const current = elements.notes.value.replace(/\s+$/, "");
  elements.notes.value = `${current}${current ? "\n" : ""}- ${path}: `;
  elements.notes.focus();
  elements.notes.setSelectionRange(elements.notes.value.length, elements.notes.value.length);
  elements.notes.dispatchEvent(new Event("input"));
});

for (const button of submitButtons) {
  button.addEventListener("click", async () => {
    const event = button.dataset.event;
    const body = elements.reviewBody.value.trim();
    const pendingCount = state.remote?.pendingReview?.comments.length || 0;
    const label = { COMMENT: "comment", APPROVE: "approval", REQUEST_CHANGES: "change request" }[event];
    if (!window.confirm(`Submit the review as a ${label} with ${pendingCount} pending comment(s)${body ? " and a global comment" : ""}?`)) return;
    submitButtons.forEach((candidate) => (candidate.disabled = true));
    elements.submitResult.textContent = "Submitting…";
    const response = await chrome.runtime.sendMessage({ type: "submitReview", prKey: state.prKey, event, body });
    if (response.ok) {
      elements.submitResult.replaceChildren("Review submitted: ", element("a", { href: response.result.url, target: "_blank", textContent: response.result.state.toLowerCase() }));
      elements.reviewBody.value = "";
    } else {
      elements.submitResult.replaceChildren(element("span", { className: "error", textContent: response.error }));
    }
    submitButtons.forEach((candidate) => (candidate.disabled = false));
  });
}

elements.refresh.addEventListener("click", () => load({ force: true }));

for (const tab of tabs) {
  tab.addEventListener("click", () => selectTab(tab.dataset.tab));
}

function selectTab(name) {
  for (const tab of tabs) tab.setAttribute("aria-selected", String(tab.dataset.tab === name));
  for (const [key, section] of Object.entries(sections)) section.hidden = key !== name;
}

// ---- live updates ---------------------------------------------------------

chrome.runtime.onMessage.addListener((message) => {
  if (message.type === "remoteStateChanged" && message.prKey === state.prKey) load();
  if (message.type === "focusNotes" && message.prKey === state.prKey) {
    selectTab("notes");
    elements.notes.focus();
    elements.notes.setSelectionRange(elements.notes.value.length, elements.notes.value.length);
  }
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local") return;
  if (state.prKey && changes[prStorageKey(state.prKey)]) {
    state.local = { later: {}, notes: "", currentPath: null, ...changes[prStorageKey(state.prKey)].newValue };
    renderProgress();
    renderNotes();
    renderWrapUp();
  }
  if (changes.settings || changes.token) load();
});

resolveTab();
