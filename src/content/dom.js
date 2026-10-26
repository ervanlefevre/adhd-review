// Everything that touches GitHub's page DOM. GitHub's "Files changed" page is a
// React application with generated class names, so instead of hard-coded selectors
// the file blocks are located from two stable facts: a file block contains a
// checkbox labelled "Viewed", and it contains the file path as text. The known
// paths come from the API, which also keeps diff lines that happen to look like a
// path from being mistaken for a header (they have no checkbox near them).

const MAX_ANCESTOR_DEPTH = 10;
// A file header keeps its checkbox close: when the only checkbox of a candidate
// container is deeper than this, the container is a page layout, not a header.
const MAX_CHECKBOX_DEPTH = 8;
// Path texts inside these never belong to a file header (file tree, sidebars).
const EXCLUDED_ANCESTORS = '[role="tree"], [role="treeitem"], nav, aside, [role="navigation"]';

// Fast path for GitHub's classic page, which exposes the path as a data attribute.
const DATA_PATH_SELECTOR = "[data-path], [data-file-path]";

export function isViewedCheckbox(input) {
  if (input.type !== "checkbox") return false;
  if (input.classList.contains("js-reviewed-checkbox")) return true;
  const texts = [input.getAttribute("aria-label"), input.name, input.id];
  for (const label of input.labels || []) texts.push(label.textContent);
  const labelledBy = input.getAttribute("aria-labelledby");
  if (labelledBy) for (const id of labelledBy.split(/\s+/)) texts.push(document.getElementById(id)?.textContent);
  return texts.some((text) => /viewed/i.test(text || ""));
}

export function findViewedCheckboxes() {
  return [...document.querySelectorAll('input[type="checkbox"]')].filter(isViewedCheckbox);
}

// Map(path -> { container, checkbox, title }) for the files currently rendered.
export function findRenderedFiles(knownPaths) {
  const rendered = new Map();
  const checkboxes = findViewedCheckboxes();

  const register = (path, element) => {
    if (!knownPaths.has(path) || rendered.has(path)) return;
    if (element.closest(EXCLUDED_ANCESTORS)) return;
    const found = containerWithOneCheckbox(element, checkboxes);
    if (found) rendered.set(path, { ...found, title: element });
  };

  // Classic page: the header carries the path as a data attribute. File tree entries may
  // carry it too, but they have no "Viewed" checkbox nearby and are skipped.
  for (const element of document.querySelectorAll(DATA_PATH_SELECTOR)) {
    register(element.dataset.path || element.dataset.filePath, element);
  }
  if (rendered.size === knownPaths.size) return rendered;

  // New page: the path is text. GitHub may split it for wrapping (zero-width spaces,
  // <wbr>, several spans), so match whole text nodes first, then small elements.
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  let node;
  while ((node = walker.nextNode())) register(normalizeText(node.data), node.parentElement);
  for (const element of document.querySelectorAll("a, h2, h3, h4, span, code, strong, button")) {
    register(normalizeText(element.textContent), element);
  }
  for (const element of document.querySelectorAll("[title], [aria-label]")) {
    register(element.getAttribute("title"), element);
    register(element.getAttribute("aria-label"), element);
  }
  return rendered;
}

function normalizeText(text) {
  return (text || "").replace(/[\u200b\u200c\u200d\ufeff]/g, "").trim();
}

// Climb from an element until an ancestor contains exactly one "Viewed" checkbox.
function containerWithOneCheckbox(element, checkboxes) {
  let ancestor = element;
  for (let depth = 0; ancestor && depth < MAX_ANCESTOR_DEPTH; depth += 1) {
    const contained = checkboxes.filter((checkbox) => ancestor.contains(checkbox));
    if (contained.length === 1) {
      return depthBetween(contained[0], ancestor) <= MAX_CHECKBOX_DEPTH ? { container: ancestor, checkbox: contained[0] } : null;
    }
    if (contained.length > 1) return null;
    ancestor = ancestor.parentElement;
  }
  return null;
}

function depthBetween(descendant, ancestor) {
  let depth = 0;
  for (let node = descendant; node && node !== ancestor; node = node.parentElement) depth += 1;
  return depth;
}

// The rendered file whose block crosses the horizontal line at `threshold` px from the
// top of the viewport; falls back to the last block that starts above it.
export function fileAtViewportLine(rendered, threshold) {
  let best = null;
  let bestTop = -Infinity;
  for (const [path, entry] of rendered) {
    const rect = entry.container.getBoundingClientRect();
    if (rect.top <= threshold && rect.bottom > threshold) return path;
    if (rect.top <= threshold && rect.top > bestTop) {
      bestTop = rect.top;
      best = path;
    }
  }
  return best;
}

export async function anchorIdFor(path) {
  const bytes = new TextEncoder().encode(path);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  const hex = [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  return `diff-${hex}`;
}

export function findFileLink(path, anchorId) {
  return (
    document.querySelector(`a[href$="#${anchorId}"]`) ||
    document.querySelector(`[data-path="${cssEscape(path)}"] a, a[title="${cssEscape(path)}"], [aria-label="${cssEscape(path)}"]`)
  );
}

function cssEscape(value) {
  return CSS.escape(value);
}

export function scrollToContainer(container, offset) {
  const top = container.getBoundingClientRect().top + window.scrollY - offset;
  window.scrollTo({ top: Math.max(0, top), behavior: "auto" });
}

export function waitFor(predicate, timeoutMs, intervalMs = 150) {
  return new Promise((resolve) => {
    const startedAt = Date.now();
    const tick = () => {
      const value = predicate();
      if (value) return resolve(value);
      if (Date.now() - startedAt > timeoutMs) return resolve(null);
      setTimeout(tick, intervalMs);
    };
    tick();
  });
}

export function isTypingTarget(target) {
  if (!(target instanceof Element)) return false;
  if (target.closest("input, textarea, select, [contenteditable=''], [contenteditable='true'], [role='textbox']")) return true;
  return false;
}
