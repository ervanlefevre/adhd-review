// DOM helpers shared by every host's page probing: the "Viewed" control surface,
// viewport maths, scrolling and waiting.

// A host's "Viewed" control, whatever it is made of: a native checkbox (GitLab, GitHub
// classic) or a toggle button (GitHub's React page). Every control exposes the same
// surface: `element`, `checked`, `isConnected`, `click()`.
export class ViewedControl {
  constructor(element, kind) {
    this.element = element;
    this.kind = kind;
  }

  get checked() {
    if (this.kind === "input") return this.element.checked;
    // GitHub's toggle button carries aria-pressed and a filled/empty checkbox icon;
    // the icon is what the user sees, so it wins when present.
    const icon = this.element.querySelector(".octicon-checkbox-fill, .octicon-checkbox");
    if (icon) return icon.classList.contains("octicon-checkbox-fill");
    return this.element.getAttribute("aria-checked") === "true" || this.element.getAttribute("aria-pressed") === "true";
  }

  get isConnected() {
    return this.element.isConnected;
  }

  click() {
    this.element.click();
  }
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

// The nearest ancestor that scrolls (GitLab's diffs live in an overflow panel, not in
// the window); null when the window itself scrolls.
export function scrollParent(element) {
  let node = element?.parentElement;
  while (node && node !== document.body && node !== document.documentElement) {
    const style = getComputedStyle(node);
    if (/(auto|scroll)/.test(style.overflowY) && node.scrollHeight > node.clientHeight) return node;
    node = node.parentElement;
  }
  return null;
}

// Brings the container's top to `offset` px below the top of whatever scrolls it.
export function scrollToContainer(container, offset) {
  const scroller = scrollParent(container);
  const top = container.getBoundingClientRect().top;
  if (scroller) {
    scroller.scrollTop += top - scroller.getBoundingClientRect().top - offset;
    return;
  }
  window.scrollTo({ top: Math.max(0, top + window.scrollY - offset), behavior: "auto" });
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

export function isTypingTarget(target) {
  if (!(target instanceof Element)) return false;
  if (target.closest("input, textarea, select, [contenteditable=''], [contenteditable='true'], [role='textbox']")) return true;
  return false;
}
