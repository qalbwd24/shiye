/* Synthetic alias configuration and foreground-focus acceptance. */
window.shiyeVerifyMappings = async ({ expect, until, wait, result }) => {
  const { trustedClick, key, native } = await window.shiyeVerifyInput({
    expect,
    until,
    wait,
    result,
  });
  if (document.body.dataset.shiyeSidebar === 'collapsed')
    await trustedClick(document.querySelector('.shiye-toggle-topics'));
  const suffix = Date.now();
  const first = `开心${suffix}`,
    renamed = `猫猫${suffix}`,
    stickerName = `动图${suffix}`;
  let input = document.querySelector('#editable-message-text');
  const replace = async (text) => {
    input = document.querySelector('#editable-message-text');
    input.focus();
    await native('Input.dispatchKeyEvent', {
      type: 'rawKeyDown',
      key: 'a',
      code: 'KeyA',
      windowsVirtualKeyCode: 65,
      modifiers: 2,
    });
    await native('Input.dispatchKeyEvent', {
      type: 'keyUp',
      key: 'a',
      code: 'KeyA',
      windowsVirtualKeyCode: 65,
      modifiers: 2,
    });
    await key('Backspace', 'Backspace', 8);
    if (text) await native('Input.insertText', { text });
    await wait(150);
  };
  window.dispatchEvent(new Event('shiye-open-mappings'));
  await until(() => document.querySelector('.shiye-mapping-form'), '映射设置加载');
  let form = document.querySelector('.shiye-mapping-form');
  form.elements.alias.value = '/' + first;
  form.elements.value.value = '🐱';
  form.requestSubmit();
  await until(
    () => document.querySelector('.shiye-mapping-list').textContent.includes(first),
    'Emoji 映射保存',
  );
  expect(
    (await window.shiyeLocalAssets.get('mapping:' + first)).value === '🐱',
    '自定义 emoji 映射持久化',
  );
  form.elements.alias.value = first;
  form.requestSubmit();
  await wait(200);
  expect(
    form.querySelector('[role=status]').textContent.includes('已经有映射'),
    '重复映射不会覆盖',
  );
  form.elements.alias.value = 'emoji';
  form.requestSubmit();
  await wait(200);
  expect(form.querySelector('[role=status]').textContent.includes('内置命令'), '内置命令冲突提示');
  const row = [...document.querySelectorAll('.shiye-mapping-row')].find((row) =>
    row.textContent.includes(first),
  );
  row.querySelector('button').click();
  form.elements.alias.value = renamed;
  form.requestSubmit();
  await until(
    () => document.querySelector('.shiye-mapping-list').textContent.includes(renamed),
    '映射改名',
  );
  expect(!(await window.shiyeLocalAssets.get('mapping:' + first)), '改名原子移除旧名称');
  document.querySelector('.shiye-dialog[open] header button[aria-label="关闭"]').click();
  await wait(200);
  await replace('/' + renamed);
  await until(() => document.querySelector('#shiye-commands'), '中文别名补全');
  await key('Enter', 'Enter', 13);
  await until(
    () => input.editor.state.doc.textContent.includes('🐱') || input.querySelector('img[alt="🐱"]'),
    '别名确认插入 emoji',
  );
  expect(!input.textContent.includes(renamed), '确认后替换命令文字');
  await replace('https://example.local/foo');
  await wait(200);
  expect(!document.querySelector('#shiye-commands'), '网址斜杠不触发映射');
  const original = (await window.shiyeLocalAssets.list()).find(
    (asset) => asset.id.startsWith('sticker:') && asset.blob.type === 'image/gif',
  );
  const assetId = 'sticker:alias-test-' + suffix;
  await window.shiyeLocalAssets.put({ id: assetId, name: '别名测试.gif', blob: original.blob });
  window.dispatchEvent(new Event('shiye-open-mappings'));
  await until(() => document.querySelector('.shiye-mapping-form'), '表情包映射设置');
  await until(
    () =>
      [...document.querySelector('.shiye-mapping-form').elements.asset.options].some(
        (option) => option.value === assetId,
      ),
    '表情包选项加载',
  );
  form = document.querySelector('.shiye-mapping-form');
  form.elements.alias.value = stickerName;
  form.elements.kind.value = 'sticker';
  form.elements.kind.dispatchEvent(new Event('change'));
  form.elements.asset.value = assetId;
  form.requestSubmit();
  await until(
    () => document.querySelector('.shiye-mapping-list').textContent.includes(stickerName),
    '表情包映射保存',
  );
  document.querySelector('.shiye-dialog[open] header button[aria-label="关闭"]').click();
  await wait(200);
  await replace('/' + stickerName);
  await until(() => document.querySelector('#shiye-commands'), '表情包别名补全');
  await key('Enter', 'Enter', 13);
  await until(() => document.querySelector('.shiye-media-cancel'), '映射进入发送确认');
  document.querySelector('.shiye-media-cancel').click();
  await until(() => !document.querySelector('#editable-message-text-modal'), '取消表情包发送');
  await wait(200);
  input = document.querySelector('#editable-message-text');
  expect(!input.textContent.includes(stickerName), '表情包确认前不会误发文字命令');
  await window.shiyeLocalAssets.remove(assetId);
  await replace('');
  await wait(150);
  await replace('/' + stickerName);
  await until(() => document.querySelector('#shiye-commands'), '缺失素材测试');
  await key('Enter', 'Enter', 13);
  await until(() => document.querySelector('#shiye-commands [role=status]'), '缺失素材明确提示');
  expect(input.textContent.includes(stickerName), '缺失素材不吞掉输入');
  await key('Escape', 'Escape', 27);
  await replace('');
  window.dispatchEvent(new Event('shiye-open-mappings'));
  await until(() => document.querySelector('.shiye-mapping-form'), '映射删除设置');
  await until(
    () =>
      [...document.querySelectorAll('.shiye-mapping-row')].some((row) =>
        row.textContent.includes(renamed),
      ),
    '待删除映射加载',
  );
  const renamedRow = [...document.querySelectorAll('.shiye-mapping-row')].find((row) =>
    row.textContent.includes(renamed),
  );
  renamedRow.querySelectorAll('button')[1].click();
  await wait(200);
  expect(!(await window.shiyeLocalAssets.get('mapping:' + renamed)), '映射可独立删除');
  await window.shiyeLocalAssets.remove('mapping:' + stickerName);
  document.querySelector('.shiye-dialog[open] header button[aria-label="关闭"]').click();
  await wait(200);
  await replace('热键唤回焦点验收');
  await wait(200);
  window.dispatchEvent(new Event('shiye-hotkey-resume'));
  await wait(350);
  expect(document.activeElement === input, '唤回后自动聚焦当前输入框');
  expect(input.textContent.includes('热键唤回焦点验收'), '唤回保留未发送内容');
  const ticket = 'verify-hide-' + suffix;
  window.dispatchEvent(new CustomEvent('shiye-before-hide', { detail: ticket }));
  // The page posts outward, so observe the worker flush directly as the durable storage proof.
  await wait(1200);
  const library = await new Promise((resolve, reject) => {
    const open = indexedDB.open('shiye-telegram-preview-v1');
    open.onsuccess = () => {
      const db = open.result;
      const read = db.transaction('preview').objectStore('preview').get('library');
      read.onsuccess = () => {
        resolve(read.result);
        db.close();
      };
      read.onerror = () => reject(read.error);
    };
    open.onerror = () => reject(open.error);
  });
  expect(
    library.dialogs.active.some((dialog) => dialog.draft?.message?.includes('热键唤回焦点验收')),
    '收起前主动保存草稿，不等待十秒防抖',
  );
  const windowState = () =>
    new Promise((resolve) => {
      function receive({ data }) {
        if (data.kind !== 'window-state') return;
        chrome.webview.removeEventListener('message', receive);
        resolve(data);
      }
      chrome.webview.addEventListener('message', receive);
      chrome.webview.postMessage({ kind: 'get-window-state' });
    });
  const beforePin = await windowState();
  chrome.webview.postMessage({ kind: 'set-topmost', value: !beforePin.topmost });
  await wait(200);
  expect((await windowState()).topmost !== beforePin.topmost, '原生边框置顶状态可切换');
  chrome.webview.postMessage({ kind: 'set-topmost', value: beforePin.topmost });
  await wait(200);
  result.aliasChecksComplete = true;
};
