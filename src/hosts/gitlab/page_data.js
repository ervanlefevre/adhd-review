// Reads the merge request data GitLab's own "Changes" tab (Rapid Diffs) holds in the
// page: the app data attribute, the diff files metadata endpoint (same origin, session
// cookie) and the viewed files autosaved in localStorage. Nothing here is a public
// API, so it is the one place to adjust when GitLab changes its page.
import { remoteFromMetadata, viewedStorageKey } from "./remote.js";
import { mergeRequestUrl } from "./url.js";

const ROOT_SELECTOR = "[data-rapid-diffs]";

export function appData() {
  const root = document.querySelector(ROOT_SELECTOR);
  if (!root) return null;
  try {
    return JSON.parse(root.dataset.appData || "{}");
  } catch {
    return null;
  }
}

export async function loadRemote(info) {
  const data = appData();
  if (!data) {
    throw new Error("This merge request does not use GitLab's Rapid Diffs, which the extension needs: pick it in the dropdown at the top of the Changes tab (classic loading is not supported).");
  }
  if (!data.diff_files_endpoint) throw new Error("GitLab's page data has no diff files endpoint.");
  const response = await fetch(new URL(data.diff_files_endpoint, location.origin), {
    credentials: "same-origin",
    headers: { Accept: "application/json" },
  });
  if (!response.ok) throw new Error(`GitLab answered ${response.status} when asked for the file list.`);
  const payload = await response.json();
  return remoteFromMetadata({
    diffFiles: payload.diff_files,
    viewedIds: readViewedIds(data.mr_path),
    projectPath: info.projectPath,
    iid: info.iid,
    title: pageTitle(),
    url: mergeRequestUrl(info),
    codeReviewEnabled: data.code_review_enabled !== false,
  });
}

export function readViewedIds(mrPath) {
  try {
    const stored = localStorage.getItem(viewedStorageKey(mrPath));
    const ids = stored ? JSON.parse(stored) : [];
    return Array.isArray(ids) ? ids : [];
  } catch {
    return [];
  }
}

// "<title> (!397) · Merge requests · Group / Project · GitLab"
function pageTitle() {
  const title = document.title.replace(/\s*\(![0-9]+\).*$/, "").trim();
  return title || document.title;
}
