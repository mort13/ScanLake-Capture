chrome.runtime.onMessage.addListener((message) => {
  if (message && message.type === 'scanlake-hotkey' && message.action) {
    window.dispatchEvent(
      new CustomEvent('scanlake-hotkey', { detail: { action: message.action } })
    );
  }
});
