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

const VIEWED_TEXT = /^\s*viewed\s*$/i;

// GitHub's "Viewed" control, whatever it is made of: a native checkbox (classic page),
// a custom checkbox or toggle button (new React page). Every control exposes the same
// surface: `element`, `checked`, `isConnected`, `click()`.
class ViewedControl {
  constructor(element, kind) {
    this.element = element;
    this.kind = kind;
  }

  get checked() {
    if (this.kind === "input") return this.element.checked;
    return this.element.getAttribute("aria-checked") === "true" || this.element.getAttribute("aria-pressed") === "true";
  }

  get isConnected() {
    return this.element.isConnected;
  }

  click() {
    this.element.click();
  }
}

function labelText(element) {
  const texts = [element.getAttribute("aria-label"), element.getAttribute("title")];
  const labelledBy = element.getAttribute("aria-labelledby");
  if (labelledBy) for (const id of labelledBy.split(/\s+/)) texts.push(document.getElementById(id)?.textContent);
  return texts;
}

export function isViewedCheckbox(input) {
  if (input.type !== "checkbox") return false;
  if (input.classList.contains("js-reviewed-checkbox")) return true;
  const texts = [...labelText(input), input.name, input.id];
  for (const label of input.labels || []) texts.push(label.textContent);
  // Custom checkboxes: the text sits next to the input, not in a <label>.
  texts.push(input.parentElement?.textContent, input.parentElement?.parentElement?.textContent);
  return texts.some((text) => text && (VIEWED_TEXT.test(text) || /viewed/i.test(text) && text.trim().length < 40));
}

function isViewedToggle(element) {
  const texts = [...labelText(element), element.textContent];
  return texts.some((text) => text && VIEWED_TEXT.test(text));
}

// The "is this a Viewed control" answer is cached per element: label lookups are not
// free and the scan runs often.
const viewedControlCache = new WeakMap();

function controlFor(element) {
  if (viewedControlCache.has(element)) return viewedControlCache.get(element);
  let control = null;
  if (element instanceof HTMLInputElement) {
    if (isViewedCheckbox(element)) control = new ViewedControl(element, "input");
  } else if (isViewedToggle(element)) {
    control = new ViewedControl(element, "toggle");
  }
  viewedControlCache.set(element, control);
  return control;
}

const CONTROL_SELECTOR = 'input[type="checkbox"], [role="checkbox"], [role="switch"], button[aria-pressed], button[aria-checked]';

export function findViewedCheckboxes() {
  const result = [];
  for (const element of document.querySelectorAll(CONTROL_SELECTOR)) {
    const control = controlFor(element);
    if (control) result.push(control);
  }
  return result;
}

export function controlForElement(element) {
  if (!(element instanceof Element)) return null;
  const candidate = element.closest(CONTROL_SELECTOR);
  return candidate ? controlFor(candidate) : null;
}

// Diagnostics when no control is recognised: the markup around any element whose own
// text is "Viewed", so the detection can be adapted to GitHub's current structure.
export function describeViewedCandidates(limit = 2) {
  const samples = [];
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  let node;
  while ((node = walker.nextNode()) && samples.length < limit) {
    if (!VIEWED_TEXT.test(node.data)) continue;
    let element = node.parentElement;
    for (let depth = 0; depth < 3 && element.parentElement; depth += 1) element = element.parentElement;
    samples.push(element.outerHTML.replace(/\s+/g, " ").slice(0, 900));
  }
  return samples;
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
  let node = checkbox.element;
  for (let depth = 0; depth < MAX_ANCESTOR_DEPTH; depth += 1) {
    const parent = node.parentElement;
    if (!parent || parent === document.body || parent === document.documentElement) break;
    let count = 0;
    for (const candidate of checkboxes) if (parent.contains(candidate.element)) count += 1;
    if (count > 1) break;
    node = parent;
  }
  return node === checkbox.element ? null : node;
}

const TITLE_CANDIDATES = "a, h2, h3, h4, span, button, code, strong, [title], [aria-label]";
const MAX_CANDIDATES = 600;

// Looks for a known path in the header around the checkbox: climbs from the checkbox
// towards the container, stopping before the level that holds the diff itself.
function pathNear(checkbox, container, knownPaths) {
  let node = checkbox.element.parentElement;
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

// Resolves with the first truthy value of `predicate`, null after `timeoutMs`. An
// exception thrown by the predicate rejects instead of leaving the promise pending.
export function waitFor(predicate, timeoutMs, intervalMs = 150) {
  return new Promise((resolve, reject) => {
    const startedAt = Date.now();
    const tick = () => {
      let value;
      try {
        value = predicate();
      } catch (error) {
        reject(error);
        return;
      }
      if (value) return resolve(value);
      if (Date.now() - startedAt > timeoutMs) return resolve(null);
      setTimeout(tick, intervalMs);
    };
    tick();
  });
}

// Diagnostics: a short description of the checkboxes the scan could not attach to a
// known path, with a snippet of the markup around them.
export function describeUnmatched(knownPaths, rendered, limit = 2) {
  const matched = new Set([...rendered.values()].map((entry) => entry.checkbox));
  const unmatched = findViewedCheckboxes().filter((checkbox) => !matched.has(checkbox));
  const samples = unmatched.slice(0, limit).map((checkbox) => {
    let node = checkbox.element;
    for (let depth = 0; depth < 4 && node.parentElement; depth += 1) node = node.parentElement;
    return node.outerHTML.replace(/\s+/g, " ").slice(0, 700);
  });
  return { knownPaths: knownPaths.size, rendered: rendered.size, checkboxes: unmatched.length + matched.size, unmatched: unmatched.length, samples };
}

export function isTypingTarget(target) {
  if (!(target instanceof Element)) return false;
  if (target.closest("input, textarea, select, [contenteditable=''], [contenteditable='true'], [role='textbox']")) return true;
  return false;
}
