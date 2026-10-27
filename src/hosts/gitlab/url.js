// GitLab host descriptor (gitlab.com only for now): merge request URLs and keys, and
// the words the UI uses for this platform. No DOM, no network.

export const id = "gitlab";
export const origin = "https://gitlab.com";
export const tabPattern = "https://gitlab.com/*/-/merge_requests/*";
export const labels = {
  platform: "GitLab",
  noun: "merge request",
  filesTab: "Changes",
  tokenName: "GitLab token",
};
// GitLab keeps "viewed" in the page (localStorage), not on the server: only the page's
// own checkbox can change it.
export const remoteViewed = false;
// The file list and viewed state come from the page itself; the token only serves the
// wrap-up (draft notes, publish, approve).
export const tokenRequiredToLoad = false;

const KEY_PREFIX = "gitlab:";

// Project paths can be nested (group/subgroup/project): everything before "/-/".
export function parse(url) {
  const match = /^https:\/\/gitlab\.com\/([^?#]+?)\/-\/merge_requests\/(\d+)(?:\/([a-z_]+))?/.exec(url || "");
  if (!match) return null;
  const [, projectPath, iid, tab] = match;
  return { host: id, projectPath, iid: Number(iid), tab: tab || "", prKey: `${KEY_PREFIX}${projectPath}!${iid}` };
}

export function isFilesTab(info) {
  return info.tab === "diffs";
}

export function isKey(prKey) {
  return typeof prKey === "string" && prKey.startsWith(KEY_PREFIX);
}

export function parseKey(prKey) {
  const match = /^gitlab:(.+)!(\d+)$/.exec(prKey);
  if (!match) throw new Error(`Invalid merge request key: ${prKey}`);
  return { projectPath: match[1], iid: Number(match[2]) };
}

export function numberLabel(prKey) {
  return `!${parseKey(prKey).iid}`;
}

export function mergeRequestUrl({ projectPath, iid }) {
  return `${origin}/${projectPath}/-/merge_requests/${iid}`;
}
