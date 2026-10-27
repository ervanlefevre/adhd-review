// The bar pinned to the bottom of the viewport: group, full path, status, progress.

export class StickyBar {
  constructor({ onOpenPanel, onCopyPath }) {
    this.root = document.createElement("div");
    this.root.id = "adhd-review-bar";
    // Layout set inline with !important, like the sidebar: GitHub's stylesheets must
    // not be able to move the bar; the stylesheet only provides the look.
    // The bar lives in the browser's top layer (Popover API): a top-layer element is
    // positioned against the viewport whatever the page does to its ancestors, and
    // nothing on the page stacks above it. The inline values undo the popover UA style.
    this.root.setAttribute("popover", "manual");
    for (const [property, value] of Object.entries({
      position: "fixed",
      inset: "auto 0 0 0",
      width: "auto",
      height: "auto",
      "max-height": "50vh",
      margin: "0",
      border: "0",
      overflow: "visible",
      display: "flex",
      "flex-direction": "column",
      "align-items": "stretch",
      transform: "none",
    })) {
      this.root.style.setProperty(property, value, "important");
    }
    this.root.innerHTML = `
      <div class="adhd-row">
        <span class="adhd-group"></span>
        <span class="adhd-path" title="Click to copy the path"><span></span></span>
        <span class="adhd-flag" hidden></span>
        <span class="adhd-busy" hidden><span class="adhd-spin"></span><span class="adhd-busy-text"></span></span>
      </div>
      <div class="adhd-row">
        <span class="adhd-progress">
          <span class="adhd-track"><span class="adhd-fill"></span></span>
          <span class="adhd-pct"></span>
          <span class="adhd-detail"></span>
        </span>
        <span class="adhd-message" hidden></span>
        <span class="adhd-keys"></span>
        <button type="button" class="adhd-panel" title="Toggle the review panel">Panel</button>
      </div>
    `;
    this.group = this.root.querySelector(".adhd-group");
    this.path = this.root.querySelector(".adhd-path span");
    this.flag = this.root.querySelector(".adhd-flag");
    this.busy = this.root.querySelector(".adhd-busy");
    this.busyText = this.root.querySelector(".adhd-busy-text");
    this.busyCount = 0;
    this.message = this.root.querySelector(".adhd-message");
    this.fill = this.root.querySelector(".adhd-fill");
    this.pct = this.root.querySelector(".adhd-pct");
    this.detail = this.root.querySelector(".adhd-detail");
    this.keys = this.root.querySelector(".adhd-keys");
    this.root.querySelector(".adhd-panel").addEventListener("click", onOpenPanel);
    this.focusSink = document.createElement("span");
    this.focusSink.tabIndex = -1;
    this.focusSink.className = "adhd-focus-sink";
    this.root.append(this.focusSink);
    this.root.querySelector(".adhd-path").addEventListener("click", onCopyPath);
    this.help = null;
    this.rightOffset = 0;
    this.messageTimer = null;
  }

  mount() {
    // Appended to <html>, not <body>: a transform, filter or containment on the body
    // would turn it into the containing block of a fixed element.
    if (!this.root.isConnected) document.documentElement.append(this.root);
    try {
      if (!this.root.matches(":popover-open")) this.root.showPopover();
    } catch (error) {
      console.warn("[adhd-review] popover unavailable, falling back to a fixed bar", error);
      this.root.removeAttribute("popover");
    }
    document.documentElement.classList.add("adhd-review-active");
    document.body.classList.add("adhd-review-active");
    setTimeout(() => this.selfCheck(), 500);
  }

  selfCheck() {
    if (!this.root.isConnected || window.innerHeight === 0) return;
    const rect = this.root.getBoundingClientRect();
    if (Math.abs(rect.bottom - window.innerHeight) > 2 || rect.top < 0) {
      const computed = getComputedStyle(this.root);
      console.warn("[adhd-review] bar off-screen", {
        rect: { top: rect.top, bottom: rect.bottom, height: rect.height },
        innerHeight: window.innerHeight,
        position: computed.position,
        bottom: computed.bottom,
        transform: computed.transform,
        parent: this.root.parentElement?.tagName,
        htmlTransform: getComputedStyle(document.documentElement).transform,
        bodyTransform: getComputedStyle(document.body).transform,
      });
    }
  }

  unmount() {
    this.root.remove();
    this.hideHelp();
    document.documentElement.classList.remove("adhd-review-active");
    document.body.classList.remove("adhd-review-active");
  }

  // Keeps the bar clear of the sidebar when it is open.
  setRightOffset(pixels) {
    this.rightOffset = pixels;
    this.root.style.setProperty("right", `${pixels}px`, "important");
    if (this.help) this.help.style.setProperty("right", `${pixels + 16}px`, "important");
  }

  setKeys(keys) {
    this.keys.innerHTML = `<kbd>${escapeHtml(keys.next)}</kbd>/<kbd>${escapeHtml(keys.previous)}</kbd> files · <kbd>${escapeHtml(keys.viewed)}</kbd> viewed · <kbd>${escapeHtml(keys.later)}</kbd> later · <kbd>${escapeHtml(keys.help)}</kbd> help`;
  }

  render({ group, position, path, viewed, later, progress }) {
    this.group.textContent = group
      ? `${group}${position ? ` · ${position.group.viewedFiles}/${position.group.totalFiles} viewed · #${position.index}` : ""}`
      : "ADHD Review";
    if (path) {
      const slash = path.lastIndexOf("/");
      const dir = slash === -1 ? "" : path.slice(0, slash + 1);
      const base = slash === -1 ? path : path.slice(slash + 1);
      this.path.innerHTML = `<span class="adhd-dir">${escapeHtml(dir)}</span><span class="adhd-base">${escapeHtml(base)}</span>`;
    } else {
      this.path.textContent = "Scroll to a file, or press the next-file key";
    }
    this.flag.hidden = !(viewed || later);
    this.flag.className = `adhd-flag ${viewed ? "viewed" : later ? "later" : ""}`;
    this.flag.textContent = viewed ? "viewed" : later ? "later" : "";
    if (progress) {
      this.fill.style.width = `${progress.percent}%`;
      this.pct.textContent = `${progress.percent}%`;
      this.detail.textContent = `${progress.viewedFiles}/${progress.totalFiles} files · ~${formatNumber(progress.remainingLines)} lines left`;
    }
  }

  // Brief pulse of the progress track (a group just got completed).
  pulse() {
    this.root.classList.remove("adhd-pulse");
    void this.root.offsetWidth;
    this.root.classList.add("adhd-pulse");
  }

  setColor(color) {
    this.root.style.setProperty("--adhd-progress", color);
  }

  // Spinner while a mark is waiting for GitHub; several may be in flight.
  beginBusy(text) {
    this.busyCount += 1;
    this.busyText.textContent = text;
    this.busy.hidden = false;
  }

  endBusy() {
    this.busyCount = Math.max(0, this.busyCount - 1);
    if (this.busyCount === 0) this.busy.hidden = true;
  }

  showMessage(html, { sticky = false } = {}) {
    clearTimeout(this.messageTimer);
    this.message.innerHTML = html;
    this.message.hidden = false;
    if (!sticky) this.messageTimer = setTimeout(() => this.clearMessage(), 4000);
  }

  clearMessage() {
    this.message.hidden = true;
    this.message.innerHTML = "";
  }

  toggleHelp(keys) {
    if (this.help) return this.hideHelp();
    const rows = [
      [keys.next, "next file in review order"],
      [keys.previous, "previous file"],
      [keys.viewed, "mark viewed and go to the next pending file"],
      [keys.unview, "unmark viewed (stays on the file)"],
      [keys.later, "flag for later and move on (press again to unflag)"],
      [keys.nextPending, "next file neither viewed nor flagged"],
      [keys.markGroup, "mark the whole current group as viewed"],
      [keys.panel, "toggle the review panel (progress, notes, wrap-up)"],
      ["alt+n", "add a note for the current file"],
      [keys.refresh, `refresh from ${this.platform || "GitHub"}`],
      [keys.help, "toggle this help"],
    ];
    this.help = document.createElement("div");
    this.help.id = "adhd-review-help";
    this.help.innerHTML = `<h3>ADHD Review keys</h3><table>${rows
      .map(([key, text]) => `<tr><td><kbd>${escapeHtml(key)}</kbd></td><td>${escapeHtml(text)}</td></tr>`)
      .join("")}</table>`;
    // Top layer and inline layout, like the bar: GitHub's page must not be able to
    // push the overlay into the document flow.
    this.help.setAttribute("popover", "manual");
    for (const [property, value] of Object.entries({
      position: "fixed",
      inset: "auto 16px 80px auto",
      right: `${this.rightOffset + 16}px`,
      width: "340px",
      height: "auto",
      margin: "0",
      overflow: "visible",
      display: "block",
    })) {
      this.help.style.setProperty(property, value, "important");
    }
    document.documentElement.append(this.help);
    try {
      this.help.showPopover();
    } catch {
      this.help.removeAttribute("popover");
    }
  }

  hideHelp() {
    this.help?.remove();
    this.help = null;
  }
}

function escapeHtml(text) {
  return String(text).replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
}

function formatNumber(value) {
  return new Intl.NumberFormat("fr-FR").format(value);
}
