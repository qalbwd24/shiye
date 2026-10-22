/* Inject only into --verify's isolated synthetic profile. openImage must create a generated File. */
window.shiyeVerifyClipboardFocus = async ({
  openImage,
  input,
  native,
  trustedClick,
  wait,
  until,
  expect,
}) => {
  const caption = () => document.querySelector('.Modal.open #editable-message-text-modal');
  await openImage();
  await until(caption, '生成图片的说明输入框');
  await wait(800);
  const inherited = caption().textContent;
  expect(document.activeElement === caption(), '图片预览稳定后默认聚焦说明输入框');
  // Emulate the host Activated callback after Windows clipboard history returns.
  document.querySelector('.Modal.open .modal-absolute-close-button')?.focus();
  window.dispatchEvent(new Event('shiye-resume'));
  expect(document.activeElement === caption(), 'Win+V返回事件将自动关闭按钮焦点恢复到说明框');
  await native('Input.insertText', { text: '说明框继续输入验收' });
  await wait(150);
  expect(caption().textContent.endsWith('说明框继续输入验收'), '图片确认说明框直接接收原生输入');
  expect(
    caption().textContent === inherited + '说明框继续输入验收',
    '已有说明保留并从文字末尾继续输入',
  );
  for (const type of ['rawKeyDown', 'keyUp'])
    await native('Input.dispatchKeyEvent', {
      type,
      key: 'ArrowLeft',
      code: 'ArrowLeft',
      windowsVirtualKeyCode: 37,
    });
  const selection = getSelection();
  const anchor = selection.anchorNode;
  const offset = selection.anchorOffset;
  window.dispatchEvent(new Event('shiye-resume'));
  await wait(700);
  expect(
    selection.anchorNode === anchor && selection.anchorOffset === offset,
    '用户说明文字中的光标位置不被恢复事件或迟到计时器覆盖',
  );
  await trustedClick(document.querySelector('.Modal.open [aria-label="确认发送"]'));
  await until(() => !caption(), '生成图片发送后关闭确认窗');
  await wait(1000);
  expect(document.activeElement === input(), '图片发出后仍恢复聊天输入框');
  await openImage();
  await until(caption, '再次生成图片预览');
  const cancel = document.querySelector('.Modal.open .shiye-media-cancel');
  cancel.focus();
  cancel.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }));
  await wait(800);
  window.dispatchEvent(new Event('shiye-resume'));
  expect(document.activeElement === cancel, '用户主动切到取消后不被初始计时器或恢复事件抢走焦点');
  await trustedClick(cancel);
  await until(() => !caption(), '取消生成图片预览');
  await wait(1000);
  expect(document.activeElement === input(), '图片取消后仍恢复聊天输入框');
};
