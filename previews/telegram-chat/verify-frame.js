/* Isolated acceptance for native chrome, per-room settings and compact bubbles. */
(async () => {
  const result = { kind: 'verify-result', stage: 'frame-settings', checks: [], errors: [] };
  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const expect = (ok, name) => {
    if (!ok) throw Error(name);
    result.checks.push(name);
  };
  async function until(read, name) {
    for (let i = 0; i < 100; i++) {
      if (read()) return;
      await wait(150);
    }
    throw Error(name);
  }
  const { trustedClick, native, key } = await window.shiyeVerifyInput({
    expect,
    until,
    wait,
    result,
  });
  async function getFrame() {
    return new Promise((resolve) => {
      function receive({ data }) {
        if (data.kind !== 'window-state') return;
        chrome.webview.removeEventListener('message', receive);
        resolve(data);
      }
      chrome.webview.addEventListener('message', receive);
      chrome.webview.postMessage({ kind: 'get-window-state' });
    });
  }
  try {
    await until(
      () => document.querySelector('#LeftColumn .shiye-room-settings'),
      '逐个对话的独立设置入口',
    );
    if (document.body.dataset.shiyeSidebar === 'collapsed')
      await trustedClick(document.querySelector('.shiye-sidebar-fallback'));
    chrome.webview.postMessage({ kind: 'zoom-step', step: 0 });
    await until(
      () =>
        getComputedStyle(document.documentElement).getPropertyValue('--shiye-ui-zoom').trim() ===
        '1',
      '验收缩放归一',
    );
    expect(window.shiyeFrameUiVersion === '20261015-frame2', '本地界面资源已按版本刷新');
    const { rooms } = await window.shiyeRoomUi.command('list');
    const persisted = JSON.parse(localStorage.getItem('shiye-frame-room-proof') || 'null');
    if (persisted) {
      const item = rooms.find((r) => r.id === persisted.id);
      expect(
        item?.title === persisted.title &&
          item?.category === '独立设置验收' &&
          item?.idleHours === 7.5,
        '退出进程后对话设置仍保留',
      );
      expect(
        item?.wallpaperAssetId === persisted.wallpaperAssetId &&
          !!(await window.shiyeLocalAssets.get(item.wallpaperAssetId))?.blob,
        '退出进程后对话壁纸原图仍保留',
      );
    }
    const buttons = [...document.querySelectorAll('#LeftColumn .shiye-room-settings')];
    const firstId = buttons[0].dataset.roomId;
    const targetId = buttons.find((b) => b.dataset.roomId !== firstId)?.dataset.roomId;
    expect(!!targetId, '至少两个对话分别配置');
    window.dispatchEvent(new CustomEvent('shiye-open-room', { detail: { id: firstId } }));
    await until(() => window.shiyeRoomUi.currentId() === firstId, '进入原对话');
    await wait(500);
    const before = rooms.find((r) => r.id === firstId);
    await trustedClick(document.querySelector(`.shiye-room-settings[data-room-id="${targetId}"]`));
    await until(
      () => document.querySelector('dialog[open] form [name=id]'),
      '点击对话的小齿轮打开设置',
    );
    let form = document.querySelector('dialog[open] form');
    expect(form.elements.id.value === targetId, '编辑明确选中的对话');
    expect(window.shiyeRoomUi.currentId() === firstId, '打开其他对话设置不切走当前编辑');
    expect(form.elements.id.closest('label').hidden, '单独设置不显示多余的选择列表');
    const title = '独立设置验证' + Date.now();
    form.elements.title.value = title;
    form.elements.category.value = '独立设置验收';
    form.elements.idleHours.value = '7.5';
    form.elements.description.value = '合成说明';
    const canvas = document.createElement('canvas');
    canvas.width = 160;
    canvas.height = 120;
    canvas.getContext('2d').fillStyle = '#526c68';
    canvas.getContext('2d').fillRect(0, 0, 160, 120);
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
    const files = new DataTransfer();
    files.items.add(new File([blob], '对话壁纸.png', { type: 'image/png' }));
    form.elements.wallpaper.files = files.files;
    form.elements.wallpaper.dispatchEvent(new Event('change', { bubbles: true }));
    await until(() => !form.querySelector('.shiye-room-wallpaper-preview').hidden, '独立壁纸预览');
    form.requestSubmit();
    await until(() => !document.querySelector('dialog[open]'), '对话设置提交');
    const saved = (await window.shiyeRoomUi.command('list')).rooms;
    const target = saved.find((r) => r.id === targetId),
      unchanged = saved.find((r) => r.id === firstId);
    expect(
      target.title === title &&
        target.category === '独立设置验收' &&
        target.idleHours === 7.5 &&
        target.description === '合成说明',
      '对话名称分类说明归篇间隔实际保存',
    );
    expect(JSON.stringify(before) === JSON.stringify(unchanged), '其他对话配置未被修改');
    expect(
      !!target.wallpaperAssetId &&
        !!(await window.shiyeLocalAssets.get(target.wallpaperAssetId))?.blob,
      '独立壁纸实际保存',
    );
    await until(() => window.shiyeRoomUi.currentId() === firstId, '保存设置后保留原对话');
    await trustedClick(document.querySelector(`.shiye-room-settings[data-room-id="${targetId}"]`));
    await until(
      () => document.querySelector('dialog[open] form [name=id]'),
      '重新打开同一对话设置',
    );
    form = document.querySelector('dialog[open] form');
    expect(
      form.elements.title.value === title &&
        form.elements.category.value === '独立设置验收' &&
        form.elements.idleHours.value === '7.5',
      '重开设置恢复正确字段',
    );
    document.querySelector('dialog[open] header button[aria-label="关闭"]').click();
    localStorage.setItem(
      'shiye-frame-room-proof',
      JSON.stringify({ id: targetId, title, wallpaperAssetId: target.wallpaperAssetId }),
    );
    window.dispatchEvent(new CustomEvent('shiye-open-room', { detail: { id: firstId } }));
    await until(() => document.querySelector('#editable-message-text'), '输入框就绪');
    await wait(500);
    let input = document.querySelector('#editable-message-text');
    input.focus();
    document.execCommand('selectAll');
    document.execCommand('insertText', false, '');
    const marker = '紧凑气泡' + Date.now();
    await native('Input.insertText', { text: marker });
    await wait(200);
    await key('Enter', 'Enter', 13);
    await until(
      () =>
        [...document.querySelectorAll('.shiye-markdown')].some(
          (n) => n.textContent.trim() === marker,
        ),
      '实际发送短消息',
    );
    const bubble = () =>
      [...document.querySelectorAll('.shiye-markdown')]
        .find((n) => n.textContent.trim() === marker)
        ?.closest('.message-content');
    document.body.style.setProperty('--shiye-message-size', '16px');
    await wait(150);
    const small = +getComputedStyle(bubble()).paddingLeft.replace('px', '');
    document.body.style.setProperty('--shiye-message-size', '24px');
    await wait(200);
    const largeStyle = getComputedStyle(bubble()),
      textStyle = getComputedStyle(bubble().querySelector('.text-content'));
    expect(small === 8 && parseFloat(largeStyle.paddingLeft) === 8, '字体放大时气泡水平留白不增大');
    expect(
      parseFloat(largeStyle.paddingTop) === 4 && parseFloat(largeStyle.paddingBottom) === 5,
      '气泡垂直留白保持紧凑',
    );
    expect(parseFloat(textStyle.fontSize) === 24, '文字可以独立放大');
    expect(
      getComputedStyle(bubble().querySelector('.shiye-markdown')).display === 'inline',
      '短消息不强制另起文档块',
    );
    expect(
      parseFloat(getComputedStyle(bubble().querySelector('.MessageMeta')).fontSize) === 11,
      '时间采用独立小字号',
    );
    result.bubble = {
      height: bubble().getBoundingClientRect().height,
      textSize: textStyle.fontSize,
      padding: largeStyle.padding,
    };
    for (let i = 0; i < 5; i++) chrome.webview.postMessage({ kind: 'zoom-step', step: 1 });
    await until(
      () =>
        getComputedStyle(document.documentElement).getPropertyValue('--shiye-ui-zoom').trim() ===
        '1.2',
      '窗口缩放到 120%',
    );
    expect(
      Math.abs(parseFloat(getComputedStyle(bubble()).paddingLeft) * 1.2 - 8) < 0.05,
      'Ctrl 缩放时气泡留白不膨胀',
    );
    expect(
      Math.abs(
        parseFloat(getComputedStyle(bubble().querySelector('.MessageMeta')).fontSize) * 1.2 - 11,
      ) < 0.05,
      'Ctrl 缩放时消息时间保持小字号',
    );
    chrome.webview.postMessage({ kind: 'zoom-step', step: 0 });
    await until(
      () =>
        getComputedStyle(document.documentElement).getPropertyValue('--shiye-ui-zoom').trim() ===
        '1',
      '恢复验收缩放',
    );
    document.body.style.setProperty('--shiye-message-size', '16px');
    const frame = await getFrame();
    result.frame = frame;
    expect(
      frame.resizeMode === 'captured-native-grips' && frame.grips.length === 8,
      '四边四角均有原生拉伸热区',
    );
    expect(frame.resizeEdgeDip === 8 && frame.resizeCornerDip === 18, '拉伸边缘与角落热区扩大');
    expect(frame.headerFontPx === (12 * frame.dpi) / 96, '标题字号只按 DPI 换算一次');
    expect(
      !frame.caption.includes('独立测试库') && !frame.caption.includes('对话预览'),
      '标题栏移除预览测试库字样',
    );
    expect(frame.glyphDip === 14, '标题栏图标统一矢量尺度');
  } catch (error) {
    result.errors.push(error.stack || String(error));
  }
  chrome.webview.postMessage(result);
})();
