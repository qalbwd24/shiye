/* Focused acceptance for the current local workspace changes. */
(async () => {
  const result = { kind: 'verify-result', stage: 'workspace', checks: [], errors: [] };
  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const expect = (ok, name) => {
    if (!ok) throw Error(name);
    result.checks.push(name);
  };
  const until = async (read, name) => {
    for (let i = 0; i < 80; i++) {
      if (read()) return;
      await wait(200);
    }
    throw Error(name);
  };
  try {
    await until(
      () => document.querySelector('#LeftColumn .ListItem.Chat .ListItem-button'),
      '本地对话加载',
    );
    const { trustedClick } = await window.shiyeVerifyInput({ expect, until, wait, result });
    if (document.body.dataset.shiyeSidebar === 'collapsed')
      await trustedClick(document.querySelector('.shiye-sidebar-fallback'));
    await trustedClick(document.querySelector('#LeftColumn .ListItem.Chat .ListItem-button'));
    await until(() => document.querySelector('#editable-message-text'), '本地编辑器加载');
    await wait(900);
    await window.shiyeVerifyWorkspace({ expect, until, wait, result });
  } catch (error) {
    result.errors.push(error.stack || String(error));
  }
  result.frame = await new Promise((resolve) => {
    function receive({ data }) {
      if (data.kind !== 'window-state') return;
      chrome.webview.removeEventListener('message', receive);
      resolve(data);
    }
    chrome.webview.addEventListener('message', receive);
    chrome.webview.postMessage({ kind: 'get-window-state' });
  });
  result.emojiLayout = [...document.querySelectorAll('.shiye-emoji-message')].map((node) => ({
    width: node.clientWidth,
    scrollWidth: node.scrollWidth,
    font: getComputedStyle(node).fontSize,
  }));
  chrome.webview.postMessage(result);
})();
