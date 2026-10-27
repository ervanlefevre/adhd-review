// Everything that touches GitLab's page DOM (Rapid Diffs). Every file is one
// <diff-file> custom element whose id is sha1(path) and whose data-file-data carries
// the paths; the "Viewed" control is a plain checkbox flagged data-viewed-checkbox.
// Files stream into the DOM after the first ones, so a file missing from the page is
// simply not streamed yet.
import { ViewedControl, scrollToContainer } from "../../content/dom_shared.js";

const FILE_SELECTOR = "diff-file[data-file-data]";
const CHECKBOX_SELECTOR = "[data-viewed-checkbox]";
const TITLE_SELECTOR = ".rd-diff-file-title";

const pathCache = new WeakMap();

function pathOf(element) {
  if (pathCache.has(element)) return pathCache.get(element);
  let path = null;
  try {
    const data = JSON.parse(element.dataset.fileData);
    path = data.new_path || data.old_path || null;
  } catch {
    path = null;
  }
  pathCache.set(element, path);
  return path;
}

function controlIn(element) {
  const input = element.querySelector(CHECKBOX_SELECTOR);
  return input ? new ViewedControl(input, "input") : null;
}

// Map(path -> { container, checkbox, title }) for the files currently in the DOM.
// Entries of `previous` still attached to the same element are kept.
export function findRenderedFiles(knownPaths, previous = new Map()) {
  const rendered = new Map();
  for (const element of document.querySelectorAll(FILE_SELECTOR)) {
    const path = pathOf(element);
    if (!path || !knownPaths.has(path) || rendered.has(path)) continue;
    const kept = previous.get(path);
    if (kept && kept.container === element && kept.checkbox?.isConnected) {
      rendered.set(path, kept);
      continue;
    }
    rendered.set(path, { container: element, checkbox: controlIn(element), title: element.querySelector(TITLE_SELECTOR) });
  }
  return rendered;
}

export function controlForElement(element) {
  if (!(element instanceof Element)) return null;
  const input = element.closest(CHECKBOX_SELECTOR);
  return input ? new ViewedControl(input, "input") : null;
}

// The element id is the file hash GitLab's metadata gives for each file.
export async function anchorIndexFor(files) {
  const index = new Map();
  for (const file of files) if (file.fileHash) index.set(file.fileHash, file.path);
  return index;
}

export async function anchorIdFor(file) {
  return file.fileHash || null;
}

// There is no link to click: the element is either in the DOM (then it was found by
// the scan) or not streamed yet.
export function findFileLink() {
  return null;
}

// GitLab's sticky merge request header covers the top of the page; the element's
// scroll-margin-top is how GitLab itself keeps a jumped-to file below it.
export function scrollTo(entry, offset) {
  const margin = parseInt(getComputedStyle(entry.container).scrollMarginTop, 10) || 0;
  scrollToContainer(entry.container, offset + margin);
}

// Line links are "#<file hash>_<old line>_<new line>": a draft note on a new line n
// sits on the row whose link ends with "_n"; on an old (removed) line, the row whose
// link holds "_<old>_".
export function commentTarget(container, comment) {
  if (!container) return null;
  const position = comment.position || {};
  let link = null;
  if (position.newLine) link = container.querySelector(`a[href$="_${position.newLine}"]`);
  if (!link && position.oldLine) link = container.querySelector(`a[href*="_${position.oldLine}_"]`);
  if (!link) return null;
  return link.closest("tr, [data-line-row], .rd-line") || link;
}

export function commentHash() {
  return null;
}

export function describeViewedCandidates() {
  return [];
}

export function describeUnmatched(knownPaths, rendered) {
  const elements = [...document.querySelectorAll(FILE_SELECTOR)];
  const unknown = elements.filter((element) => !knownPaths.has(pathOf(element)));
  return {
    knownPaths: knownPaths.size,
    rendered: rendered.size,
    checkboxes: document.querySelectorAll(CHECKBOX_SELECTOR).length,
    unmatched: unknown.length,
    samples: unknown.slice(0, 2).map((element) => pathOf(element)),
  };
}
