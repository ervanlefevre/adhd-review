// In-page drawer hosting the extension's panel page in an iframe. Unlike
// chrome.sidePanel.open(), it needs no user-gesture plumbing, so a key press or a
// click in the page always works. The iframe is an extension page and keeps full
// access to the extension APIs.

export class Drawer {
  constructor({ onToggle }) {
    this.root = document.createElement("div");
    this.root.id = "adhd-review-drawer";
    this.root.hidden = true;
    this.frame = document.createElement("iframe");
    this.frame.src = chrome.runtime.getURL("src/sidepanel/sidepanel.html?embedded=1");
    this.frame.title = "ADHD Review panel";
    this.loaded = new Promise((resolve) => this.frame.addEventListener("load", resolve, { once: true }));
    const close = document.createElement("button");
    close.type = "button";
    close.className = "adhd-drawer-close";
    close.title = "Close the panel";
    close.textContent = "×";
    close.addEventListener("click", () => this.close());
    this.root.append(close, this.frame);

    this.icon = document.createElement("button");
    this.icon.type = "button";
    this.icon.id = "adhd-review-icon";
    this.icon.title = "ADHD Review panel (progress, notes, wrap-up)";
    this.icon.innerHTML =
      '<svg viewBox="0 0 16 16" width="18" height="18" aria-hidden="true"><path fill="currentColor" d="M2 2.5A1.5 1.5 0 0 1 3.5 1h9A1.5 1.5 0 0 1 14 2.5v11a1.5 1.5 0 0 1-1.5 1.5h-9A1.5 1.5 0 0 1 2 13.5v-11ZM3.5 2a.5.5 0 0 0-.5.5v11a.5.5 0 0 0 .5.5h9a.5.5 0 0 0 .5-.5v-11a.5.5 0 0 0-.5-.5h-9ZM5 4.75A.75.75 0 0 1 5.75 4h4.5a.75.75 0 0 1 0 1.5h-4.5A.75.75 0 0 1 5 4.75Zm0 3A.75.75 0 0 1 5.75 7h4.5a.75.75 0 0 1 0 1.5h-4.5A.75.75 0 0 1 5 7.75Zm0 3a.75.75 0 0 1 .75-.75h2.5a.75.75 0 0 1 0 1.5h-2.5A.75.75 0 0 1 5 10.75Z"/></svg>';
    this.icon.addEventListener("click", () => this.toggle());
    this.onToggle = onToggle;
  }

  mount() {
    if (!this.root.isConnected) document.body.append(this.root);
    if (!this.icon.isConnected) document.body.append(this.icon);
  }

  unmount() {
    this.root.remove();
    this.icon.remove();
  }

  get isOpen() {
    return this.root.isConnected && !this.root.hidden;
  }

  async open() {
    this.mount();
    this.root.hidden = false;
    this.icon.classList.add("active");
    this.onToggle?.(true);
    await this.loaded;
  }

  close() {
    this.root.hidden = true;
    this.icon.classList.remove("active");
    this.onToggle?.(false);
  }

  toggle() {
    return this.isOpen ? this.close() : this.open();
  }

  // Messages to the embedded panel page go through the extension runtime, like for
  // the native side panel; this is only a convenience wrapper.
  async send(message) {
    await this.loaded;
    return chrome.runtime.sendMessage(message).catch(() => {});
  }
}
