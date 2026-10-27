// Everything that touches GitHub's page DOM. GitHub's "Files changed" page is a
// React application with generated class names, so instead of hard-coded selectors
// the file blocks are located from two stable facts: a file block contains a
// checkbox labelled "Viewed", and it contains the file path as text. The known
// paths come from the API, which also keeps diff lines that happen to look like a
// path from being mistaken for a header (they have no checkbox near them).

const MAX_ANCESTOR_DEPTH = 10;
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
// Starts from the "Viewed" checkboxes (one per rendered file) and looks for the path
// only around each of them, so the cost is proportional to the number of files, not
// to the size of the diffs. Entries of `previous` whose checkbox is still on the page
// are kept as they are.
export function findRenderedFiles(knownPaths, previous = new Map()) {
  const rendered = new Map();
  const checkboxes = findViewedCheckboxes();
  const onPage = new Set(checkboxes);
  for (const [path, entry] of previous) {
    if (entry.checkbox && onPage.has(entry.checkbox) && entry.container.isConnected) rendered.set(path, entry);
  }
  const mapped = new Set([...rendered.values()].map((entry) => entry.checkbox));

  for (const checkbox of checkboxes) {
    if (mapped.has(checkbox)) continue;
    const container = fileContainer(checkbox, checkboxes);
    if (!container) continue;
    const dataPath = container.dataset?.path || container.querySelector(DATA_PATH_SELECTOR)?.dataset.path;
    const found = dataPath && knownPaths.has(dataPath) ? { path: dataPath, element: container } : pathNear(checkbox, container, knownPaths);
    if (found && !rendered.has(found.path)) rendered.set(found.path, { container, checkbox, title: found.element });
  }
  return rendered;
}

// The file block: the highest ancestor of the checkbox that holds no other "Viewed"
// checkbox. The climb is capped so that a lone rendered file (virtualized page) does
// not claim the whole layout.
function fileContainer(checkbox, checkboxes) {
  let node = checkbox;
  for (let depth = 0; depth < MAX_ANCESTOR_DEPTH; depth += 1) {
    const parent = node.parentElement;
    if (!parent || parent === document.body || parent === document.documentElement) break;
    let count = 0;
    for (const candidate of checkboxes) if (parent.contains(candidate)) count += 1;
    if (count > 1) break;
    node = parent;
  }
  return node === checkbox ? null : node;
}

const TITLE_CANDIDATES = "a, h2, h3, h4, span, button, code, strong, [title], [aria-label]";
const MAX_CANDIDATES = 600;

// Looks for a known path in the header around the checkbox: climbs from the checkbox
// towards the container, stopping before the level that holds the diff itself.
function pathNear(checkbox, container, knownPaths) {
  let node = checkbox.parentElement;
  while (node && container.contains(node)) {
    if (node.closest(EXCLUDED_ANCESTORS)) return null;
    const candidates = node.querySelectorAll(TITLE_CANDIDATES);
    if (candidates.length > MAX_CANDIDATES) return null;
    for (const element of candidates) {
      for (const text of [element.getAttribute("title"), element.getAttribute("aria-label"), normalizeText(element.textContent)]) {
        const path = matchPath(text, knownPaths);
        if (path) return { path, element };
      }
    }
    if (node === container) return null;
    node = node.parentElement;
  }
  return null;
}

// Exact match, or a GitHub truncation ("…ack_office/x.erb") that ends one known path.
function matchPath(text, knownPaths) {
  if (!text) return null;
  if (knownPaths.has(text)) return text;
  if (!text.startsWith("…") && !text.startsWith("...")) return null;
  const tail = text.replace(/^(…|\.\.\.)/, "");
  if (tail.length < 4) return null;
  let found = null;
  for (const path of knownPaths) {
    if (path.endsWith(tail)) {
      if (found) return null;
      found = path;
    }
  }
  return found;
}

function normalizeText(text) {
  return (text || "").replace(/[\u200b\u200c\u200d\ufeff]/g, "").trim();
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
