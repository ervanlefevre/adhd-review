// The supported code hosts. A review key ("owner/repo#12" on GitHub,
// "gitlab:group/project!12" on GitLab) says which host a page, a cache entry or a
// message belongs to; the descriptor then gives the labels and the behaviours.
import * as github from "./github/url.js";
import * as gitlab from "./gitlab/url.js";

export const hosts = { github, gitlab };

export const tabPatterns = [github.tabPattern, gitlab.tabPattern];
export const origins = [github.origin, gitlab.origin];

export function parseReviewUrl(url) {
  return github.parse(url) || gitlab.parse(url);
}

export function hostForKey(prKey) {
  return gitlab.isKey(prKey) ? gitlab : github;
}

export function hostForId(id) {
  return hosts[id] || github;
}
