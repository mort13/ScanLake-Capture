const COMMAND_MAP = {
  'capture': 'capture',
  'save-scan': 'save',
  'new-cluster': 'newCluster',
};

const URL_PATTERNS = [
  '*://capture.scanlake.rocks/*',
  '*://localhost/*',
  '*://127.0.0.1/*',
];

chrome.commands.onCommand.addListener((command) => {
  const action = COMMAND_MAP[command];
  if (!action) return;

  chrome.tabs.query({ url: URL_PATTERNS }, (tabs) => {
    for (const tab of tabs) {
      if (tab.id != null) {
        chrome.tabs.sendMessage(tab.id, { type: 'scanlake-hotkey', action });
      }
    }
  });
});
