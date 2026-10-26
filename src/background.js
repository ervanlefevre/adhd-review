import { GitHubApi } from "./github_api.js";
import { loadToken, parsePrKey } from "./settings.js";

// Remote state cache (GitHub data) lives in the service worker memory and in
// chrome.storage.session so that it survives the worker being suspended.
const CACHE_TTL_MS = 5 * 60 * 1000;

chrome.runtime.onInstalled.addListener(() => {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  handle(message, sender)
    .then((result) => sendResponse({ ok: true, result }))
    .catch((error) => sendResponse({ ok: false, error: error.message || String(error) }));
  return true;
});

async function handle(message, sender) {
  switch (message.type) {
    case "checkConnection":
      return new GitHubApi(message.token || (await loadToken())).viewerLogin();
    case "loadPr":
      return loadPr(message.prKey, { force: message.force });
    case "setViewed":
      return setViewed(message);
    case "submitReview":
      return submitReview(message);
    case "openSidePanel":
      return openSidePanel(message.tabId ?? sender.tab?.id);
    case "focusTab":
      return chrome.tabs.update(message.tabId, { active: true });
    case "openOptions":
      return chrome.runtime.openOptionsPage();
    default:
      throw new Error(`Unknown message type: ${message.type}`);
  }
}

async function api() {
  return new GitHubApi(await loadToken());
}

function cacheKey(prKey) {
  return `remote:${prKey}`;
}

async function readCache(prKey) {
  const key = cacheKey(prKey);
  const stored = await chrome.storage.session.get(key);
  return stored[key] || null;
}

async function writeCache(prKey, state) {
  await chrome.storage.session.set({ [cacheKey(prKey)]: { ...state, fetchedAt: Date.now() } });
  broadcast({ type: "remoteStateChanged", prKey });
}

// Extension pages (side panel, options) listen on runtime messages; content scripts
// only receive tab messages, so both channels are used.
async function broadcast(message) {
  chrome.runtime.sendMessage(message).catch(() => {});
  const tabs = await chrome.tabs.query({ url: "https://github.com/*/*/pull/*" });
  for (const tab of tabs) chrome.tabs.sendMessage(tab.id, message).catch(() => {});
}

async function loadPr(prKey, { force = false } = {}) {
  const cached = await readCache(prKey);
  if (cached && !force && Date.now() - cached.fetchedAt < CACHE_TTL_MS) return cached;
  const state = await (await api()).pullRequest(parsePrKey(prKey));
  await writeCache(prKey, state);
  return { ...state, fetchedAt: Date.now() };
}

// appliedOnPage: the content script clicked GitHub's own checkbox, so GitHub already
// persisted the change; only the cache needs updating.
async function setViewed({ prKey, path, viewed, appliedOnPage }) {
  const state = await loadPr(prKey);
  if (!appliedOnPage) await (await api()).setFileViewed(state.id, path, viewed);
  const files = state.files.map((file) => (file.path === path ? { ...file, viewerViewedState: viewed ? "VIEWED" : "UNVIEWED" } : file));
  await writeCache(prKey, { ...state, files });
  return { path, viewed };
}

async function submitReview({ prKey, event, body }) {
  const state = await loadPr(prKey);
  const review = await (await api()).submitReview({ reviewId: state.pendingReview?.id, pullRequestId: state.id, event, body });
  await loadPr(prKey, { force: true });
  return review;
}

async function openSidePanel(tabId) {
  if (tabId === undefined) throw new Error("No tab to open the side panel for");
  await chrome.sidePanel.open({ tabId });
  return true;
}
