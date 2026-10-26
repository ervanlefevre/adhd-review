// Classic content script: Chrome loads content scripts as non-module scripts,
// so this loader imports the real entry point as an ES module.
(async () => {
  try {
    await import(chrome.runtime.getURL("src/content/page.js"));
  } catch (error) {
    console.error("[adhd-review] failed to load", error);
  }
})();
