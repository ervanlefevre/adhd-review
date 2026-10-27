import { GitHubApi } from "./hosts/github/api.js";
import { GitLabApi } from "./hosts/gitlab/api.js";
import { loadToken, parsePrKey } from "./settings.js";
import { hostForKey, tabPatterns } from "./hosts/index.js";

// Remote state cache lives in the service worker memory and in chrome.storage.session
// so that it survives the worker being suspended. GitHub states are fetched here from
// the API; GitLab states are assembled by the content script (file list and viewed
// state only exist in the page) and stored here, with the draft notes added from
// the API when a token is configured.
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
      return checkConnection(message.host || "github", message.token);
    case "loadPr":
      return loadPr(message.prKey, { force: message.force });
    case "storeRemote":
      return storeRemote(message);
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

async function checkConnection(host, token) {
  const value = token || (await loadToken(host));
  if (host === "gitlab") return new GitLabApi(value).currentUser();
  return new GitHubApi(value).viewerLogin();
}

async function githubApi() {
  return new GitHubApi(await loadToken("github"));
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
  const tabs = await chrome.tabs.query({ url: tabPatterns });
  for (const tab of tabs) chrome.tabs.sendMessage(tab.id, message).catch(() => {});
}

async function loadPr(prKey, { force = false } = {}) {
  const cached = await readCache(prKey);
  if (cached && !force && Date.now() - cached.fetchedAt < CACHE_TTL_MS) return cached;
  if (hostForKey(prKey).id === "gitlab") {
    if (!cached) throw new Error("Open the merge request's Changes tab on gitlab.com first: the file list comes from the page.");
    // A refresh only re-reads the draft notes; the page sends a fresh state itself.
    return storeRemote({ prKey, state: cached });
  }
  const state = await (await githubApi()).pullRequest(parsePrKey(prKey));
  await writeCache(prKey, state);
  return { ...state, fetchedAt: Date.now() };
}

// GitLab: the content script hands over the state it read from the page.
async function storeRemote({ prKey, state }) {
  const complete = await withDraftNotes(prKey, state);
  await writeCache(prKey, complete);
  return { ...complete, fetchedAt: Date.now() };
}

async function withDraftNotes(prKey, state) {
  const token = await loadToken("gitlab");
  if (!token) return { ...state, pendingReview: null, draftsError: "no-token" };
  try {
    const comments = await new GitLabApi(token).draftNotes(parsePrKey(prKey));
    return { ...state, pendingReview: { id: null, comments }, draftsError: null };
  } catch (error) {
    return { ...state, pendingReview: null, draftsError: error.message };
  }
}

// appliedOnPage: the content script clicked the page's own checkbox, so the host
// already persisted the change; only the cache needs updating.
async function setViewed({ prKey, path, viewed, appliedOnPage }) {
  const state = await loadPr(prKey);
  if (!appliedOnPage) {
    if (hostForKey(prKey).id === "gitlab") throw new Error("GitLab keeps the viewed state in the page: open the Changes tab and mark the file there.");
    await (await githubApi()).setFileViewed(state.id, path, viewed);
  }
  const files = state.files.map((file) => (file.path === path ? { ...file, viewerViewedState: viewed ? "VIEWED" : "UNVIEWED" } : file));
  await writeCache(prKey, { ...state, files });
  return { path, viewed };
}

async function submitReview({ prKey, event, body }) {
  const state = await loadPr(prKey);
  let review;
  if (hostForKey(prKey).id === "gitlab") {
    const hasDrafts = (state.pendingReview?.comments?.length || 0) > 0;
    review = await new GitLabApi(await loadToken("gitlab")).submitReview({ ...parsePrKey(prKey), event, body, hasDrafts });
  } else {
    review = await (await githubApi()).submitReview({ reviewId: state.pendingReview?.id, pullRequestId: state.id, event, body });
  }
  await loadPr(prKey, { force: true });
  return review;
}

async function openSidePanel(tabId) {
  if (tabId === undefined) throw new Error("No tab to open the side panel for");
  await chrome.sidePanel.open({ tabId });
  return true;
}
