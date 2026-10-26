// The bar pinned to the bottom of the viewport: group, full path, status, progress.

export class StickyBar {
  constructor({ onOpenPanel, onCopyPath }) {
    this.root = document.createElement("div");
    this.root.id = "adhd-review-bar";
    this.root.innerHTML = `
      <span class="adhd-group"></span>
      <span class="adhd-path" title="Click to copy the path"><span></span></span>
      <span class="adhd-flag" hidden></span>
      <span class="adhd-message" hidden></span>
      <span class="adhd-progress">
        <span class="adhd-track"><span class="adhd-fill"></span></span>
        <span class="adhd-pct"></span>
        <span class="adhd-detail"></span>
      </span>
      <span class="adhd-keys"></span>
      <button type="button" class="adhd-panel" title="Toggle the review panel">Panel</button>
    `;
    this.group = this.root.querySelector(".adhd-group");
    this.path = this.root.querySelector(".adhd-path span");
    this.flag = this.root.querySelector(".adhd-flag");
    this.message = this.root.querySelector(".adhd-message");
    this.fill = this.root.querySelector(".adhd-fill");
    this.pct = this.root.querySelector(".adhd-pct");
    this.detail = this.root.querySelector(".adhd-detail");
    this.keys = this.root.querySelector(".adhd-keys");
    this.root.querySelector(".adhd-panel").addEventListener("click", onOpenPanel);
    this.root.querySelector(".adhd-path").addEventListener("click", onCopyPath);
    this.help = null;
    this.messageTimer = null;
  }

  mount() {
    if (!this.root.isConnected) document.body.append(this.root);
    document.documentElement.classList.add("adhd-review-active");
    document.body.classList.add("adhd-review-active");
  }

  unmount() {
    this.root.remove();
    this.hideHelp();
    document.documentElement.classList.remove("adhd-review-active");
    document.body.classList.remove("adhd-review-active");
  }

  // Keeps the bar clear of the sidebar when it is open.
  setRightOffset(pixels) {
    this.root.style.setProperty("right", `${pixels}px`, "important");
    if (this.help) this.help.style.setProperty("right", `${pixels + 16}px`, "important");
  }

  setKeys(keys) {
    this.keys.innerHTML = `<kbd>${escapeHtml(keys.next)}</kbd>/<kbd>${escapeHtml(keys.previous)}</kbd> files · <kbd>${escapeHtml(keys.viewed)}</kbd> viewed · <kbd>${escapeHtml(keys.later)}</kbd> later · <kbd>${escapeHtml(keys.help)}</kbd> help`;
  }

  render({ group, position, path, viewed, later, progress }) {
    this.group.textContent = group ? `${group}${position ? ` · ${position.index}/${position.total}` : ""}` : "ADHD Review";
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
      [keys.refresh, "refresh from GitHub"],
      [keys.help, "toggle this help"],
    ];
    this.help = document.createElement("div");
    this.help.id = "adhd-review-help";
    this.help.innerHTML = `<h3>ADHD Review keys</h3><table>${rows
      .map(([key, text]) => `<tr><td><kbd>${escapeHtml(key)}</kbd></td><td>${escapeHtml(text)}</td></tr>`)
      .join("")}</table>`;
    document.body.append(this.help);
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
