// Everything that touches GitHub's page DOM. GitHub's "Files changed" page is a
// React application with generated class names, so instead of hard-coded selectors
// the file blocks are located from two stable facts: a file block contains a
// checkbox labelled "Viewed", and it contains the file path as text. The known
// paths come from the API, which also keeps diff lines that happen to look like a
// path from being mistaken for a header (they have no checkbox near them).
import { ViewedControl, scrollToContainer } from "../../content/dom_shared.js";

const MAX_ANCESTOR_DEPTH = 10;
// Path texts inside these never belong to a file header (file tree, sidebars).
const EXCLUDED_ANCESTORS = '[role="tree"], [role="treeitem"], nav, aside, [role="navigation"]';

// Fast path for GitHub's classic page, which exposes the path as a data attribute.
const DATA_PATH_SELECTOR = "[data-path], [data-file-path]";

const VIEWED_TEXT = /^\s*viewed\s*$/i;

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

// aria-label is "Viewed" or "Not Viewed" depending on the state; the inner text is "Viewed".
function isViewedToggle(element) {
  const texts = [...labelText(element), element.textContent];
  return texts.some((text) => text && (VIEWED_TEXT.test(text) || /^\s*not viewed\s*$/i.test(text)));
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
// `anchors` maps GitHub's "diff-<sha256(path)>" ids to paths (built by the caller,
// hashing is asynchronous); the header's title link carries that id.
export function findRenderedFiles(knownPaths, previous = new Map(), anchors = null) {
  const rendered = new Map();
  const checkboxes = findViewedCheckboxes();
  const known = knownIndex(knownPaths);
  const onPage = new Set(checkboxes);
  for (const [path, entry] of previous) {
    if (entry.checkbox && onPage.has(entry.checkbox) && entry.container.isConnected) rendered.set(path, entry);
  }
  const mapped = new Set([...rendered.values()].map((entry) => entry.checkbox));

  for (const checkbox of checkboxes) {
    if (mapped.has(checkbox)) continue;
    const container = fileContainer(checkbox, checkboxes);
    if (!container) continue;
    const found = pathFromAttributes(container, knownPaths, anchors) || pathNear(checkbox, container, known);
    if (found && !rendered.has(found.path)) rendered.set(found.path, { container, checkbox, title: found.element });
  }
  return rendered;
}

// Cheap exact handles GitHub puts in the header: data-path (classic page),
// data-file-path (the "Expand all lines" button) and the title link's #diff-<sha> anchor.
function pathFromAttributes(container, knownPaths, anchors) {
  const dataElement = container.matches(DATA_PATH_SELECTOR) ? container : container.querySelector(DATA_PATH_SELECTOR);
  const dataPath = dataElement ? dataElement.dataset.path || dataElement.dataset.filePath : null;
  if (dataPath && knownPaths.has(dataPath)) return { path: dataPath, element: dataElement };
  if (anchors) {
    for (const link of container.querySelectorAll('a[href*="#diff-"]')) {
      const path = anchors.get(link.getAttribute("href").split("#")[1]);
      if (path) return { path, element: link };
    }
  }
  return null;
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

// Known paths indexed by their normalized form (no whitespace, no invisible characters).
function knownIndex(knownPaths) {
  const byNormalized = new Map();
  for (const path of knownPaths) byNormalized.set(normalizeText(path), path);
  return { paths: knownPaths, byNormalized };
}

// Looks for a known path in the header around the checkbox: climbs from the checkbox
// towards the container, stopping before the level that holds the diff itself.
function pathNear(checkbox, container, known) {
  let node = checkbox.element.parentElement;
  while (node && container.contains(node)) {
    if (node.closest(EXCLUDED_ANCESTORS)) return null;
    const candidates = node.querySelectorAll(TITLE_CANDIDATES);
    if (candidates.length > MAX_CANDIDATES) return null;
    for (const element of candidates) {
      for (const text of candidateTexts(element)) {
        const path = matchPath(text, known);
        if (path) return { path, element };
      }
    }
    if (node === container) return null;
    node = node.parentElement;
  }
  return null;
}

function candidateTexts(element) {
  return [element.getAttribute("title"), element.getAttribute("aria-label"), element.textContent];
}

// Exact match after normalization, or a GitHub truncation ("…ack_office/x.erb") that
// ends exactly one known path.
function matchPath(rawText, known) {
  const text = normalizeText(rawText);
  if (!text) return null;
  const exact = known.byNormalized.get(text);
  if (exact) return exact;
  if (!text.startsWith("…") && !text.startsWith("...")) return null;
  const tail = text.replace(/^(…|\.\.\.)/, "");
  if (tail.length < 4) return null;
  let found = null;
  for (const [normalized, path] of known.byNormalized) {
    if (normalized.endsWith(tail)) {
      if (found) return null;
      found = path;
    }
  }
  return found;
}

// Whitespace and every Unicode format character (zero-width spaces, joiners, soft
// hyphens, the left-to-right marks GitHub wraps paths in) are dropped before comparing.
function normalizeText(text) {
  return (text || "").replace(/[\s\p{Cf}]/gu, "");
}

// GitHub's title links and tree links use "#diff-<sha256(path)>".
export async function anchorIndexFor(files) {
  const index = new Map();
  for (const file of files) index.set(await anchorIdFor(file), file.path);
  return index;
}

export async function anchorIdFor(file) {
  const bytes = new TextEncoder().encode(file.path);
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

export function scrollTo(entry, offset) {
  scrollToContainer(entry.container, offset);
}

// Below GitHub's sticky toolbar and sticky file header.
export function currentFileLine() {
  return 160;
}

// A pending review comment is rendered with the id "r<databaseId>".
export function commentTarget(container, comment) {
  return document.getElementById(`r${comment.databaseId}`);
}

export function commentHash(comment) {
  return `r${comment.databaseId}`;
}

// Diagnostics: a short description of the checkboxes the scan could not attach to a
// known path, with a snippet of the markup around them.
export function describeUnmatched(knownPaths, rendered, limit = 2) {
  const matched = new Set([...rendered.values()].map((entry) => entry.checkbox));
  const checkboxes = findViewedCheckboxes();
  const unmatched = checkboxes.filter((checkbox) => !matched.has(checkbox));
  const samples = unmatched.slice(0, limit).map((checkbox) => {
    // What the matcher saw, level by level, from the control up to its container.
    const container = fileContainer(checkbox, checkboxes);
    const levels = [];
    let node = checkbox.element.parentElement;
    while (node && container && container.contains(node) && levels.length < 8) {
      const candidates = node.querySelectorAll(TITLE_CANDIDATES);
      const texts = new Set();
      for (const element of candidates) {
        for (const text of candidateTexts(element)) {
          const trimmed = (text || "").replace(/\s+/g, " ").trim();
          if (trimmed && trimmed.length < 160) texts.add(trimmed);
          if (texts.size >= 12) break;
        }
      }
      levels.push({ tag: node.tagName.toLowerCase(), className: (node.className || "").toString().slice(0, 40), candidates: candidates.length, excluded: Boolean(node.closest(EXCLUDED_ANCESTORS)), texts: [...texts] });
      if (node === container) break;
      node = node.parentElement;
    }
    const header = checkbox.element.closest("[data-diff-header-wrapper], header") || checkbox.element.parentElement?.parentElement;
    const markup = (header?.outerHTML || "").replace(/<svg[\s\S]*?<\/svg>/g, "<svg/>").replace(/ class="[^"]*"/g, "").replace(/\s+/g, " ").slice(0, 2500);
    return { levels, markup };
  });
  return { knownPaths: knownPaths.size, rendered: rendered.size, checkboxes: checkboxes.length, unmatched: unmatched.length, samples };
}
