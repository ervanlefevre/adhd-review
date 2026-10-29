// GitHub host descriptor: how pull request URLs and keys look, and the words the UI
// uses for this platform. No DOM, no network: loadable from every context and tests.

export const id = "github";
export const origin = "https://github.com";
export const tabPattern = "https://github.com/*/*/pull/*";
export const labels = {
  platform: "GitHub",
  noun: "pull request",
  filesTab: "Files changed",
  tokenName: "GitHub token",
};
// Viewed state lives on GitHub and can be changed through the API for files the page
// has not rendered.
export const remoteViewed = true;
// Progress needs the API, so the token is required before anything shows.
export const tokenRequiredToLoad = true;

const FILES_TABS = new Set(["files", "changes"]);

export function parse(url) {
  const match = /^https:\/\/github\.com\/([^/]+)\/([^/]+)\/pull\/(\d+)(\/[a-z]+)?/.exec(url || "");
  if (!match) return null;
  const [, owner, repo, number, tab] = match;
  return { host: id, owner, repo, number: Number(number), tab: (tab || "").replace("/", ""), prKey: `${owner}/${repo}#${number}` };
}

export function isFilesTab(info) {
  return FILES_TABS.has(info.tab);
}

export function parseKey(prKey) {
  const match = /^([^/]+)\/([^#]+)#(\d+)$/.exec(prKey);
  if (!match) throw new Error(`Invalid pull request key: ${prKey}`);
  return { owner: match[1], repo: match[2], number: Number(match[3]) };
}

export function numberLabel(prKey) {
  return `#${parseKey(prKey).number}`;
}
