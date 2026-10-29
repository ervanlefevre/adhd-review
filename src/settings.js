import { DEFAULT_RULES_TEXT } from "./rules.js";
import { DEFAULT_LINE_CAP } from "./review_model.js";
import { parseReviewUrl, hostForKey } from "./hosts/index.js";

export const DEFAULT_KEYS = {
  next: "j",
  previous: "k",
  viewed: "v",
  unview: "u",
  later: "l",
  nextPending: "n",
  markGroup: "G",
  panel: "o",
  refresh: "r",
  help: "?",
};

export const DEFAULT_SETTINGS = {
  rulesText: DEFAULT_RULES_TEXT,
  lineCap: DEFAULT_LINE_CAP,
  keys: DEFAULT_KEYS,
  scrollOffset: 0,
  progressColor: "#3fb950",
};

export async function loadSettings() {
  const { settings } = await chrome.storage.local.get("settings");
  return { ...DEFAULT_SETTINGS, ...(settings || {}), keys: { ...DEFAULT_KEYS, ...(settings?.keys || {}) } };
}

export async function saveSettings(settings) {
  await chrome.storage.local.set({ settings });
}

// One token per host. The GitHub one keeps its historical "token" key.
export const TOKEN_KEYS = { github: "token", gitlab: "gitlabToken" };

export async function loadToken(host = "github") {
  const key = TOKEN_KEYS[host] || TOKEN_KEYS.github;
  const stored = await chrome.storage.local.get(key);
  return stored[key] || "";
}

export async function saveToken(token, host = "github") {
  const key = TOKEN_KEYS[host] || TOKEN_KEYS.github;
  await chrome.storage.local.set({ [key]: token.trim() });
}

// Per pull request local state: later flags, notes, current file.
export function prStorageKey(prKey) {
  return `pr:${prKey}`;
}

export async function loadPrLocal(prKey) {
  const key = prStorageKey(prKey);
  const stored = await chrome.storage.local.get(key);
  return { later: {}, notes: "", currentPath: null, ...(stored[key] || {}) };
}

export async function updatePrLocal(prKey, patch) {
  const current = await loadPrLocal(prKey);
  const next = { ...current, ...patch, updatedAt: Date.now() };
  await chrome.storage.local.set({ [prStorageKey(prKey)]: next });
  return next;
}

// Whatever the host, a review page is described by `{ host, prKey, tab, ... }`.
export function parsePrUrl(url) {
  return parseReviewUrl(url);
}

export function parsePrKey(prKey) {
  return hostForKey(prKey).parseKey(prKey);
}
