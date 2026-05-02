(async () => {
  try {
    await import(chrome.runtime.getURL('src/content/content_script.js'));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes('Extension context invalidated') || message.includes('Failed to fetch dynamically imported module')) {
      return;
    }
    throw error;
  }
})();
