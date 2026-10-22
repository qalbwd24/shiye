/* Loaded only by --verify, over an isolated synthetic library. */
window.shiyeVerifyInput = async ({ expect, until, wait, result }) => {
  async function native(method, parameters) {
    return new Promise((resolve, reject) => {
      const id = crypto.randomUUID();
      const timeout = setTimeout(() => {
        window.chrome.webview.removeEventListener('message', receive);
        reject(Error(`Input timeout: ${method}`));
      }, 6000);
      function receive({ data }) {
        if (data.kind !== 'verify-input-result' || data.id !== id) return;
        clearTimeout(timeout);
        window.chrome.webview.removeEventListener('message', receive);
        if (data.error) reject(Error(data.error));
        else resolve(data.result);
      }
      window.chrome.webview.addEventListener('message', receive);
      window.chrome.webview.postMessage({ kind: 'verify-input', id, method, parameters });
    });
  }
  async function trustedClick(element) {
    if (!element) throw Error('Missing trusted click target');
    element.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    await wait(80);
    const rect = element.getBoundingClientRect();
    const x = rect.x + rect.width / 2,
      y = rect.y + rect.height / 2;
    await native('Input.dispatchMouseEvent', {
      type: 'mousePressed',
      x,
      y,
      button: 'left',
      clickCount: 1,
    });
    await native('Input.dispatchMouseEvent', {
      type: 'mouseReleased',
      x,
      y,
      button: 'left',
      clickCount: 1,
    });
    await wait(150);
  }
  async function key(keyName, code, virtualKey) {
    await native('Input.dispatchKeyEvent', {
      type: 'rawKeyDown',
      key: keyName,
      code,
      windowsVirtualKeyCode: virtualKey,
    });
    await native('Input.dispatchKeyEvent', {
      type: 'keyUp',
      key: keyName,
      code,
      windowsVirtualKeyCode: virtualKey,
    });
  }
  function replace(text) {
    const input = document.querySelector('#editable-message-text');
    input.focus();
    document.execCommand('selectAll');
    document.execCommand('insertText', false, text);
  }
  async function closeDialog() {
    document.querySelector('.shiye-dialog[open] header button[aria-label="关闭"]').click();
    await wait(200);
  }
  async function verifyLocalInput() {
    let bridge;
    await until(() => {
      window.dispatchEvent(
        new CustomEvent('shiye-editor-request', {
          detail: {
            receive: (value) => {
              bridge = value;
            },
          },
        }),
      );
      return !!bridge;
    }, '本地编辑器事务桥就绪');
    const input = document.querySelector('#editable-message-text');
    result.editorGeometry = [];
    for (let node = input; node && node !== document.body; node = node.parentElement) {
      const style = getComputedStyle(node);
      if (style.transform !== 'none' || style.position === 'fixed')
        result.editorGeometry.push({
          className: node.className,
          transform: style.transform,
          position: style.position,
        });
    }
    if (localStorage.getItem('shiye-verify-assets')) {
      const asset = await window.shiyeLocalAssets.get('wallpaper');
      expect(asset?.blob.size > 3 * 1024 * 1024, '大背景关闭重开后仍完整存在');
      expect(
        getComputedStyle(document.body).getPropertyValue('--shiye-wallpaper').includes('blob:'),
        '大背景重开恢复为本地 Blob URL',
      );
      expect(
        (await window.shiyeLocalAssets.list()).some((asset) => asset.id.startsWith('sticker:')),
        '表情包收藏重开保留',
      );
    }
    replace('表情插入位置');
    await wait(200);
    await trustedClick(document.querySelector('.shiye-symbol-button'));
    await until(() => document.querySelector('.shiye-symbol-dialog [data-tab=emoji]'), '表情包优先面板');
    await trustedClick(document.querySelector('.shiye-symbol-dialog [data-tab=emoji]'));
    await until(() => document.querySelector('.shiye-emoji-grid'), '本地表情面板');
    await trustedClick(document.querySelector('.shiye-emoji-grid button'));
    await until(
      () =>
        input.editor.state.doc.textContent.includes('😀') || input.querySelector('img[alt="😀"]'),
      '表情插入编辑器',
    );
    expect(input.textContent.includes('表情插入位置'), '插入表情保留既有文字');
    await wait(200);
    const assetCanvas = document.createElement('canvas');
    assetCanvas.width = 1200;
    assetCanvas.height = 900;
    const context = assetCanvas.getContext('2d');
    const pixels = context.createImageData(1200, 900);
    for (let offset = 0; offset < pixels.data.length; offset += 65536)
      crypto.getRandomValues(
        pixels.data.subarray(offset, Math.min(pixels.data.length, offset + 65536)),
      );
    context.putImageData(pixels, 0, 0);
    const assetBlob = await new Promise((resolve) => assetCanvas.toBlob(resolve, 'image/png'));
    expect(assetBlob.size > 3 * 1024 * 1024, '合成大图超过旧 3 MB 限制');
    await trustedClick(document.querySelector('.shiye-symbol-button'));
    await trustedClick(document.querySelector('.shiye-symbol-tabs [data-tab="sticker"]'));
    const upload = document.querySelector('.shiye-sticker-import input');
    const transfer = new DataTransfer();
    const pngName = '合成表情包' + Date.now() + '.png';
    transfer.items.add(new File([assetBlob], pngName, { type: 'image/png' }));
    upload.files = transfer.files;
    upload.dispatchEvent(new Event('change', { bubbles: true }));
    await until(
      () => document.querySelector(`.shiye-sticker-grid button[title="${pngName}"]`),
      '导入本机表情包',
    );
    expect(!document.querySelector('.SymbolMenu'), '本地表情面板不挂载 Telegram 远程素材组件');
    await trustedClick(document.querySelector(`.shiye-sticker-grid button[title="${pngName}"]`));
    await until(() => document.querySelector('[aria-label="确认发送"]'), '表情包进入发送确认');
    await until(
      () => !document.querySelector('[aria-label="确认发送"]').disabled,
      '表情包准备完成',
    );
    await trustedClick(document.querySelector('[aria-label="确认发送"]'));
    await until(
      () => !document.querySelector('#editable-message-text-modal'),
      '表情包发送关闭预览',
    );
    await wait(800);
    expect(!document.querySelector('.shiye-symbol-dialog[open]'), '表情包发送完成未崩溃');
    const gifBytes = Uint8Array.from(
      atob(
        'R0lGODlhAQABAIAAAAAAAP///yH5BAEKAAEALAAAAAABAAEAAAICRAEAIfkEAQoAAQAsAAAAAAEAAQAAAgJEAQA7',
      ),
      (ch) => ch.charCodeAt(0),
    );
    await trustedClick(document.querySelector('.shiye-symbol-button'));
    await trustedClick(document.querySelector('.shiye-symbol-tabs [data-tab="sticker"]'));
    const gifTransfer = new DataTransfer();
    const gifName = '合成双帧' + Date.now() + '.gif';
    gifTransfer.items.add(new File([gifBytes], gifName, { type: 'image/gif' }));
    const gifImport = document.querySelector('.shiye-sticker-import input');
    gifImport.files = gifTransfer.files;
    gifImport.dispatchEvent(new Event('change', { bubbles: true }));
    await until(
      () => document.querySelector(`.shiye-sticker-grid button[title="${gifName}"]`),
      'GIF 导入收藏',
    );
    await trustedClick(document.querySelector(`.shiye-sticker-grid button[title="${gifName}"]`));
    await until(
      () =>
        document.querySelector('[aria-label="确认发送"]') &&
        !document.querySelector('[aria-label="确认发送"]').disabled,
      'GIF 发送预览',
    );
    await trustedClick(document.querySelector('[aria-label="确认发送"]'));
    await until(() => !document.querySelector('#editable-message-text-modal'), 'GIF 发送完成');
    await wait(1000);
    const gifLibrary = await new Promise((resolve, reject) => {
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
      gifLibrary.documents.some(
        (doc) =>
          doc.mimeType === 'image/gif' &&
          doc.bytes?.length === gifBytes.length &&
          doc.bytes.every((byte, i) => byte === gifBytes[i]),
      ),
      'GIF 发送保留原始双帧字节',
    );
    localStorage.setItem('shiye-input-commands-v1', '{}');
    replace('/');
    await until(() => document.querySelector('#shiye-commands'), '斜杠命令显示');
    expect(
      [...document.querySelectorAll('#shiye-commands [role=option] strong')].filter((item) =>
        ['/表情', '/表情包', '/图片', '/时间', '/搜索'].includes(item.textContent),
      ).length === 5,
      '五个本地命令',
    );
    await key('ArrowDown', 'ArrowDown', 40);
    expect(
      document.querySelector('#shiye-command-1').getAttribute('aria-selected') === 'true',
      '命令方向键选择',
    );
    await key('Escape', 'Escape', 27);
    expect(!document.querySelector('#shiye-commands'), 'Esc 关闭命令');
    replace('/time');
    await until(() => document.querySelector('#shiye-commands'), '英文命令别名');
    await key('Enter', 'Enter', 13);
    await wait(200);
    expect(
      !input.textContent.includes('/time') && /\d/.test(input.textContent),
      '命令 Enter 插入时间不发送',
    );
    replace('/emoji');
    await until(() => document.querySelector('#shiye-commands'), '组词前命令可见');
    await native('Input.imeSetComposition', { text: '中文', selectionStart: 2, selectionEnd: 2 });
    expect(!document.querySelector('#shiye-commands'), '真实 Chromium 组词事件收起命令');
    await key('Enter', 'Enter', 13);
    await wait(50);
    expect(input.textContent.includes('中文'), '中文组词 Enter 不误发');
    await native('Input.insertText', { text: '中文' });
    await wait(150);
    replace('中文候选确认验收');
    await wait(150);
    await key('Enter', 'Enter', 13);
    await until(() => !input.textContent.includes('中文候选确认验收'), '组词结束可正常发送');
    result.checks.push('Chromium IME 组合事件和确认后发送');
    await trustedClick(document.querySelector('#LeftMainHeader button[aria-label="设置"]'));
    document.querySelector('[data-input]').click();
    await wait(150);
    const enabled = document.querySelector('[data-command="enabled"]');
    await trustedClick(enabled);
    expect(!enabled.checked, '命令总开关可关闭');
    await closeDialog();
    replace('/');
    await wait(200);
    expect(!document.querySelector('#shiye-commands'), '关闭后斜杠保留普通文字');
    await trustedClick(document.querySelector('#LeftMainHeader button[aria-label="设置"]'));
    document.querySelector('[data-input]').click();
    await wait(150);
    document.querySelector('[data-command="enabled"]').click();
    document.querySelector('[data-command="time"]').click();
    await closeDialog();
    replace('/');
    await until(() => document.querySelector('#shiye-commands'), '重新开启命令');
    expect(
      !document.querySelector('#shiye-commands').textContent.includes('/时间'),
      '单独关闭指定命令',
    );
    await key('Escape', 'Escape', 27);
    replace('');
    await trustedClick(document.querySelector('#LeftMainHeader button[aria-label="设置"]'));
    document.querySelector('[data-appearance]').click();
    await wait(150);
    const wallpaper = document.querySelector('#shiyeWallpaper');
    wallpaper.files = transfer.files;
    wallpaper.dispatchEvent(new Event('change', { bubbles: true }));
    await until(
      () =>
        document.querySelector('.shiye-dialog [role=status]')?.textContent.includes('背景已保存'),
      '超过 3 MB 背景保存',
    );
    const savedBackground = await window.shiyeLocalAssets.get('wallpaper');
    expect(savedBackground.blob.size === assetBlob.size, '背景 Blob 保存原始字节长度');
    expect(
      !JSON.parse(localStorage.getItem('shiye-preview-appearance-v1')).wallpaper,
      '背景不挤占设置 localStorage',
    );
    expect(
      getComputedStyle(document.body).getPropertyValue('--shiye-wallpaper').includes('blob:'),
      '背景以本地 Blob URL 显示',
    );
    document.querySelector('#shiyeDone').click();
    await wait(200);
    localStorage.setItem('shiye-verify-assets', 'true');
    await trustedClick(document.querySelector('#LeftMainHeader button[aria-label="设置"]'));
    document.querySelector('[data-input]').click();
    await wait(150);
    document.querySelector('[data-command="time"]').click();
    await closeDialog();

    expect(
      !/参与者/.test(document.querySelector('.MiddleHeader')?.textContent || ''),
      '话题顶部不显示参与人数',
    );
    await trustedClick(document.querySelector('.shiye-toggle-topics'));
    expect(
      getComputedStyle(document.querySelector('#LeftColumn')).display === 'none',
      '话题栏可折叠',
    );
    expect(
      Math.abs(document.querySelector('#MiddleColumn').getBoundingClientRect().width - innerWidth) <
        2,
      '折叠后聊天占用窗口宽度',
    );
    await trustedClick(document.querySelector('.shiye-toggle-topics'));
    expect(
      getComputedStyle(document.querySelector('#LeftColumn')).display !== 'none',
      '话题栏可再次展开',
    );
    await trustedClick(document.querySelector('.shiye-toggle-topics'));
    expect(
      JSON.parse(localStorage.getItem('shiye-preview-appearance-v1')).sidebarCollapsed,
      '折叠状态已持久化',
    );
  }
  return { trustedClick, verifyLocalInput, native, key };
};
