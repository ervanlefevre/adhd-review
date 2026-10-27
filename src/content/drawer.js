// Right sidebar hosting the extension's panel page in an iframe. It pushes the page
// content (right margin on the document) instead of covering it, spans the window
// height, and opens from a key, the floating icon, the bar's button or by moving the
// mouse to the right edge of the window.
//
// Structural styles are set inline with !important: GitHub's stylesheets must not be
// able to turn the sidebar into an in-flow box, whatever they declare for divs,
// buttons or iframes. The stylesheet only provides colours.

const WIDTH = 440;
const Z_INDEX = 2147482999;
const EDGE_WIDTH = 8;
const EDGE_HOVER_DELAY_MS = 120;

export class Drawer {
  constructor({ onToggle }) {
    this.onToggle = onToggle;
    this.width = WIDTH;

    this.root = document.createElement("div");
    this.root.id = "adhd-review-drawer";
    important(this.root, {
      position: "fixed",
      top: "0",
      right: "0",
      bottom: "0",
      width: `${WIDTH}px`,
      "max-width": "90vw",
      "z-index": String(Z_INDEX),
      display: "none",
      margin: "0",
      padding: "0",
      "box-sizing": "border-box",
    });

    this.frame = document.createElement("iframe");
    this.frame.src = chrome.runtime.getURL("src/sidepanel/sidepanel.html?embedded=1");
    this.frame.title = "ADHD Review panel";
    important(this.frame, { display: "block", width: "100%", height: "100%", border: "0", margin: "0", padding: "0", background: "transparent" });
    this.loaded = new Promise((resolve) => this.frame.addEventListener("load", resolve, { once: true }));

    this.root.append(this.frame);

    this.icon = document.createElement("button");
    this.icon.type = "button";
    this.icon.id = "adhd-review-icon";
    this.icon.title = "ADHD Review panel (progress, notes, wrap-up)";
    this.icon.innerHTML =
      '<svg viewBox="0 0 16 16" width="18" height="18" aria-hidden="true"><path fill="currentColor" d="M2 2.5A1.5 1.5 0 0 1 3.5 1h9A1.5 1.5 0 0 1 14 2.5v11a1.5 1.5 0 0 1-1.5 1.5h-9A1.5 1.5 0 0 1 2 13.5v-11ZM3.5 2a.5.5 0 0 0-.5.5v11a.5.5 0 0 0 .5.5h9a.5.5 0 0 0 .5-.5v-11a.5.5 0 0 0-.5-.5h-9ZM5 4.75A.75.75 0 0 1 5.75 4h4.5a.75.75 0 0 1 0 1.5h-4.5A.75.75 0 0 1 5 4.75Zm0 3A.75.75 0 0 1 5.75 7h4.5a.75.75 0 0 1 0 1.5h-4.5A.75.75 0 0 1 5 7.75Zm0 3a.75.75 0 0 1 .75-.75h2.5a.75.75 0 0 1 0 1.5h-2.5A.75.75 0 0 1 5 10.75Z"/></svg>';
    important(this.icon, {
      position: "fixed",
      right: "14px",
      bottom: "76px",
      "z-index": String(Z_INDEX + 1),
      display: "flex",
      "align-items": "center",
      "justify-content": "center",
      width: "38px",
      height: "38px",
      padding: "0",
      margin: "0",
      "border-radius": "999px",
      cursor: "pointer",
    });
    this.icon.addEventListener("click", () => this.toggle());

    // Invisible strip along the right edge: resting the mouse on it opens the sidebar.
    this.edge = document.createElement("div");
    this.edge.id = "adhd-review-edge";
    this.edge.title = "Open the ADHD Review panel";
    important(this.edge, {
      position: "fixed",
      top: "0",
      right: "0",
      bottom: "0",
      width: `${EDGE_WIDTH}px`,
      "z-index": String(Z_INDEX - 1),
      cursor: "w-resize",
      background: "transparent",
    });
    this.edgeTimer = null;
    this.edge.addEventListener("mouseenter", () => {
      clearTimeout(this.edgeTimer);
      this.edgeTimer = setTimeout(() => this.open(), EDGE_HOVER_DELAY_MS);
    });
    this.edge.addEventListener("mouseleave", () => clearTimeout(this.edgeTimer));
  }

  mount() {
    for (const element of [this.root, this.icon, this.edge]) {
      if (!element.isConnected) document.body.append(element);
    }
  }

  unmount() {
    this.root.remove();
    this.icon.remove();
    this.edge.remove();
    this.pushPage(false);
  }

  get isOpen() {
    return this.root.isConnected && this.root.style.display !== "none";
  }

  async open() {
    this.mount();
    important(this.root, { display: "block" });
    important(this.edge, { display: "none" });
    this.icon.classList.add("active");
    this.pushPage(true);
    this.remember(true);
    this.onToggle?.(true, this.width);
  }

  close() {
    important(this.root, { display: "none" });
    important(this.edge, { display: "block" });
    this.icon.classList.remove("active");
    this.pushPage(false);
    this.remember(false);
    this.onToggle?.(false, 0);
  }

  toggle() {
    return this.isOpen ? this.close() : this.open();
  }

  // Blue edge while the keyboard focus is inside the panel.
  setFocused(focused) {
    this.root.classList.toggle("focused", focused);
  }

  pushPage(open) {
    const html = document.documentElement;
    if (open) {
      html.style.setProperty("margin-right", `${this.width}px`, "important");
      html.classList.add("adhd-review-drawer-open");
    } else {
      html.style.removeProperty("margin-right");
      html.classList.remove("adhd-review-drawer-open");
    }
  }

  // Global, not per pull request: once opened the sidebar stays open on every pull
  // request page until closed.
  remember(open) {
    chrome.storage.local.set({ drawerOpen: open }).catch(() => {});
  }

  async restore() {
    const { drawerOpen } = await chrome.storage.local.get("drawerOpen");
    if (drawerOpen && !this.isOpen) await this.open();
  }

  // Direct channel to the embedded panel: runtime messages from a content script are
  // not reliably delivered to an extension iframe living inside the web page, while
  // postMessage to the frame always is.
  async send(message) {
    await this.loaded;
    this.notify(message);
    return chrome.runtime.sendMessage(message).catch(() => {});
  }

  notify(message) {
    const target = this.frame.contentWindow;
    if (!target) return;
    try {
      target.postMessage({ source: "adhd-review", ...message }, new URL(chrome.runtime.getURL("/")).origin);
    } catch (error) {
      console.debug("[adhd-review] panel notify failed", error);
    }
  }
}

function important(element, declarations) {
  for (const [property, value] of Object.entries(declarations)) element.style.setProperty(property, value, "important");
}
