(async () => {
  await import(chrome.runtime.getURL('src/content/content_script.js'));
})();
