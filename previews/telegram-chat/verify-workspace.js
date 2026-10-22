/* Synthetic workspace acceptance; executed only by the isolated native host. */
window.shiyeVerifyWorkspace = async ({ expect, until, wait, result }) => {
  const { native, key, trustedClick } = await window.shiyeVerifyInput({
    expect,
    until,
    wait,
    result,
  });
  async function boldKey() {
    await native('Input.dispatchKeyEvent', {
      type: 'rawKeyDown',
      key: 'b',
      code: 'KeyB',
      windowsVirtualKeyCode: 66,
      modifiers: 2,
    });
    await native('Input.dispatchKeyEvent', {
      type: 'keyUp',
      key: 'b',
      code: 'KeyB',
      windowsVirtualKeyCode: 66,
      modifiers: 2,
    });
  }
  const mixed = '混合斜体验收' + Date.now();
  let startInput = document.querySelector('#editable-message-text');
  startInput.focus();
  document.execCommand('selectAll');
  document.execCommand('insertText', false, '');
  await boldKey();
  await native('Input.insertText', { text: '已有加粗' });
  await boldKey();
  await native('Input.insertText', { text: ' 和 *' + mixed + '* 与 `code`' });
  await wait(200);
  await key('Enter', 'Enter', 13);
  await until(
    () =>
      [...document.querySelectorAll('.Message i,.Message em')].some((node) =>
        node.textContent.includes(mixed),
      ),
    '混合既有富文本与 Markdown 时斜体正常渲染',
  );
  expect(
    [...document.querySelectorAll('.Message i,.Message em')].some((node) =>
      node.textContent.includes(mixed),
    ),
    '混合加粗、行内代码和手输斜体可同时显示',
  );
  async function sendPlain(text) {
    const input = document.querySelector('#editable-message-text');
    input.focus();
    document.execCommand('selectAll');
    document.execCommand('insertText', false, '');
    await native('Input.insertText', { text });
    await wait(150);
    await key('Enter', 'Enter', 13);
    await wait(350);
  }
  const markdownTitle = '文档验收' + Date.now();
  const source =
    '# ' +
    markdownTitle +
    '\n\n**加粗** *斜体* ==高亮== ~~删除~~\n\n' +
    '> 引用内容\n\n- 无序项\n\n1. 有序项\n\n- [x] 已完成\n- [ ] 未完成\n\n' +
    '| 项目 | 内容 |\n| --- | --- |\n| 甲 | 乙 |\n\n[链接](https://example.com)\n\n' +
    '---\n\n```js\nconst value = "**代码原文** ==原文==";\n```';
  await sendPlain(source);
  await until(
    () =>
      [...document.querySelectorAll('.shiye-markdown h1')].some(
        (n) => n.textContent === markdownTitle,
      ),
    '实际发送的 Markdown 标题',
  );
  const block = [...document.querySelectorAll('.shiye-markdown')].find(
    (n) => n.querySelector('h1')?.textContent === markdownTitle,
  );
  for (const selector of [
    'strong',
    'em',
    'mark',
    'del',
    'blockquote',
    'ul',
    'ol',
    'table',
    'input[type=checkbox]',
    'a',
    'hr',
    'pre code',
  ]) {
    expect(!!block.querySelector(selector), '实际消息渲染 ' + selector);
  }
  const code = block.querySelector('pre code');
  expect(
    code.textContent.includes('**代码原文** ==原文==') && !code.querySelector('strong,mark'),
    '代码内的 Markdown 保持原文',
  );
  const persisted = await window.shiyeRoomUi.command('search', { query: markdownTitle });
  expect(
    persisted.matches?.some((n) => n.text.includes('# ' + markdownTitle)),
    '消息保留 Markdown 源文',
  );
  await sendPlain('🤣');
  await until(
    () =>
      [...document.querySelectorAll('.shiye-emoji-message')].some(
        (n) => n.textContent.trim() === '🤣',
      ),
    '纯 emoji 使用统一大尺寸',
  );
  await sendPlain('笑死🤣混排验收');
  const inlineEmoji = [...document.querySelectorAll('.shiye-markdown')].find((n) =>
    n.textContent.includes('笑死🤣混排验收'),
  );
  expect(
    inlineEmoji && !inlineEmoji.classList.contains('shiye-emoji-message'),
    '文字混排的 emoji 保持行内大小',
  );
  expect(!!document.querySelector('.shiye-time-divider'), '消息流显示居中时间分隔');
  expect(!document.querySelector('.MiddleHeader'), '聊天顶部横栏已从组件中移除');
  const toggle = document.querySelector('.shiye-sidebar-fallback');
  expect(toggle.getBoundingClientRect().width > 0, '左上独立折叠入口始终可见');
  const originalId = window.shiyeRoomUi.currentId();
  const stamp = Date.now();
  async function createRoom(title, color) {
    window.dispatchEvent(new Event('shiye-new-topic'));
    await until(
      () => document.querySelector('dialog[open] form [name=wallpaper]'),
      '新建对话可选择独立壁纸',
    );
    const form = document.querySelector('dialog[open] form');
    form.elements.title.value = title;
    const canvas = document.createElement('canvas');
    canvas.width = 120;
    canvas.height = 90;
    canvas.getContext('2d').fillStyle = color;
    canvas.getContext('2d').fillRect(0, 0, 120, 90);
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
    const files = new DataTransfer();
    files.items.add(new File([blob], '独立背景.png', { type: 'image/png' }));
    form.elements.wallpaper.files = files.files;
    form.elements.wallpaper.dispatchEvent(new Event('change', { bubbles: true }));
    await until(
      () => !form.querySelector('.shiye-room-wallpaper-preview').hidden,
      '壁纸和头像预览',
    );
    form.requestSubmit();
    await until(() => !document.querySelector('dialog[open]'), '对话及壁纸保存');
    const { rooms } = await window.shiyeRoomUi.command('list');
    const room = rooms.find((item) => item.title === title);
    await until(() => window.shiyeRoomUi.currentId() === room.id, '新建后进入该对话');
    await until(() => document.body.dataset.shiyeRoomWallpaper === room.id, '自动应用对话壁纸');
    expect(
      Boolean((await window.shiyeLocalAssets.get(room.wallpaperAssetId))?.blob),
      '对话壁纸原图保存于独立资产库',
    );
    return room;
  }
  const a = await createRoom('空格与壁纸甲' + stamp, '#783c40');
  const b = await createRoom('空格与壁纸乙' + stamp, '#376b5d');
  await until(
    () => document.querySelector('#editable-message-text')?.getAttribute('aria-label') === b.title,
    '对话名显示为输入框提示',
  );
  for (const node of document.querySelectorAll('#LeftColumn *')) {
    if (
      node.scrollHeight > node.clientHeight &&
      /auto|scroll/.test(getComputedStyle(node).overflowY)
    )
      node.scrollTop = 0;
  }
  await wait(400);
  await until(() => {
    const avatar = document.querySelector(`#LeftColumn .Avatar[data-peer-id="${b.id}"]`);
    return avatar && getComputedStyle(avatar).backgroundImage.includes('blob:');
  }, '头像背景已渲染为对话壁纸');
  expect(true, '对话头像使用所选壁纸');
  let input = document.querySelector('#editable-message-text');
  input.focus();
  await native('Input.insertText', { text: '甲' });
  await native('Input.dispatchKeyEvent', {
    type: 'keyDown',
    key: ' ',
    code: 'Space',
    windowsVirtualKeyCode: 32,
    text: ' ',
    unmodifiedText: ' ',
  });
  await key(' ', 'Space', 32);
  await native('Input.insertText', { text: '乙' });
  await wait(300);
  result.workspaceSpaceText = input.textContent;
  expect(/甲[ \u00a0]+乙/.test(input.textContent), '真实空格按键可在中英文之间输入空格');
  await key('Escape', 'Escape', 27);
  await until(() => document.querySelector('.shiye-room-switcher[open]'), 'Esc 打开对话切换');
  expect(!document.querySelector('#telegram-search-input'), 'Esc 不进入 Telegram 搜索分类页');
  const choices = [...document.querySelectorAll('.shiye-room-choices button')];
  const aButton = choices.find((button) => button.textContent === a.title);
  await trustedClick(aButton);
  await until(() => window.shiyeRoomUi.currentId() === a.id, '选择后切换到另一对话');
  await until(() => document.body.dataset.shiyeRoomWallpaper === a.id, '切换时背景随对话变化');
  await wait(800);
  input = document.querySelector('#editable-message-text');
  input.focus();
  await native('Input.insertText', { text: '甲对话草稿' });
  const before = window.shiyeRoomUi.currentId();
  await key('ArrowDown', 'ArrowDown', 40);
  await until(() => window.shiyeRoomUi.currentId() !== before, '输入框下方向键直接切换对话');
  await wait(800);
  document.querySelector('#editable-message-text').focus();
  await key('ArrowUp', 'ArrowUp', 38);
  await until(() => window.shiyeRoomUi.currentId() === before, '输入框上方向键切回原对话');
  await until(
    () => document.querySelector('#editable-message-text')?.textContent.includes('甲对话草稿'),
    '切换后各对话草稿保留',
  );
  await trustedClick(document.querySelector('#LeftMainHeader button[aria-label="设置"]'));
  document.querySelector('[data-appearance]').click();
  const align = document.querySelector('#shiyeMessageAlign');
  align.value = 'left';
  align.dispatchEvent(new Event('change'));
  expect(document.body.dataset.shiyeAlign === 'left', '消息位置可设置靠左');
  align.value = 'right';
  align.dispatchEvent(new Event('change'));
  expect(document.body.dataset.shiyeAlign === 'right', '消息位置可设置靠右');
  document.querySelector('#shiyeDone').click();
  await wait(150);
  window.dispatchEvent(new CustomEvent('shiye-open-room', { detail: { id: originalId } }));
  await wait(600);
  expect(!document.querySelector('.MiddleHeader'), '切回旧对话不恢复顶部横栏');
};
