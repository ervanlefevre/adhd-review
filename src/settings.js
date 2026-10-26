import { DEFAULT_RULES_TEXT } from "./rules.js";
import { DEFAULT_LINE_CAP } from "./review_model.js";

export const DEFAULT_KEYS = {
  next: "j",
  previous: "k",
  viewed: "v",
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
};

export async function loadSettings() {
  const { settings } = await chrome.storage.local.get("settings");
  return { ...DEFAULT_SETTINGS, ...(settings || {}), keys: { ...DEFAULT_KEYS, ...(settings?.keys || {}) } };
}

export async function saveSettings(settings) {
  await chrome.storage.local.set({ settings });
}

export async function loadToken() {
  const { token } = await chrome.storage.local.get("token");
  return token || "";
}

export async function saveToken(token) {
  await chrome.storage.local.set({ token: token.trim() });
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

export function parsePrUrl(url) {
  const match = /^https:\/\/github\.com\/([^/]+)\/([^/]+)\/pull\/(\d+)(\/[a-z]+)?/.exec(url || "");
  if (!match) return null;
  const [, owner, repo, number, tab] = match;
  return { owner, repo, number: Number(number), tab: (tab || "").replace("/", ""), prKey: `${owner}/${repo}#${number}` };
}

export function parsePrKey(prKey) {
  const match = /^([^/]+)\/([^#]+)#(\d+)$/.exec(prKey);
  if (!match) throw new Error(`Invalid pull request key: ${prKey}`);
  return { owner: match[1], repo: match[2], number: Number(match[3]) };
}
