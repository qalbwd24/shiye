/* Trusted pointer/wheel regression over the isolated synthetic composer. */
window.shiyeVerifyComposer = async ({
  input,
  replace,
  native,
  wait,
  expect,
  result,
  chooseRoom,
  nextRoomLabel,
}) => {
  let handle = document.querySelector('.shiye-input-resizer');
  const manualExpected = () =>
    Math.max(
      64,
      Math.min(
        Number(localStorage.getItem('shiye-input-manual-height-v1')),
        innerHeight * 0.55 - 56,
      ),
    );
  async function resetAuto() {
    handle.focus();
    for (const type of ['rawKeyDown', 'keyUp'])
      await native('Input.dispatchKeyEvent', {
        type,
        key: 'Home',
        code: 'Home',
        windowsVirtualKeyCode: 36,
      });
    await wait(100);
  }
  async function capture(stage) {
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(Error('输入高度截图超时')), 4000);
      const receive = ({ data }) => {
        if (data.kind === 'composer-capture-ready' && data.stage === stage) {
          clearTimeout(timer);
          window.chrome.webview.removeEventListener('message', receive);
          resolve();
        }
      };
      window.chrome.webview.addEventListener('message', receive);
      window.chrome.webview.postMessage({ kind: 'verify-composer-capture', stage });
    });
  }
  await resetAuto();
  // Legacy fields must no longer force a tall minimum, including after reload.
  localStorage.setItem('shiye-input-height', '280');
  document.body.style.setProperty('--shiye-input-height', '280px');
  document.body.style.setProperty('--shiye-input-min-height', '280px');
  await replace('');
  const viewport = () => input().closest('.input-scroller');
  const compact = viewport().clientHeight;
  result.composerAutoRuns ||= [];
  const run = { width: innerWidth, compact };
  result.composerAutoRuns.push(run);
  expect(compact < 84, '旧版280px偏好不再强制撑高空输入框');
  await capture('compact');
  const messages =
    document.querySelector('#MiddleColumn .Transition_slide-active > .MessageList') ||
    document.querySelector('#MiddleColumn .MessageList');
  messages.scrollTop = messages.scrollHeight;
  await replace('第一行输入');
  const first = viewport().clientHeight;
  await native('Input.insertText', { text: '\n第二行输入\n第三行输入' });
  await wait(200);
  const three = viewport().clientHeight;
  expect(three > first + 25, '真实连续输入使一行到三行自动向上增高');
  await native('Input.insertText', { text: '\n继续输入内容'.repeat(30) });
  await wait(250);
  const capped = viewport().clientHeight;
  expect(capped <= 161 && capped > three, '长文字自动增高至160px上限');
  await native('Input.insertText', { text: '\n超过上限继续输入'.repeat(40) });
  await wait(250);
  expect(
    Math.abs(viewport().clientHeight - capped) < 2 && viewport().scrollHeight > capped * 3,
    '超过上限继续输入只在框内滚动、不再增高',
  );
  expect(
    messages.scrollHeight - messages.scrollTop - messages.clientHeight < 5,
    '输入框自动增高时保持最新消息可见',
  );
  const latest = [...messages.querySelectorAll('.Message')].at(-1);
  expect(
    latest.getBoundingClientRect().bottom <=
      document.querySelector('#MiddleColumn .middle-column-footer').getBoundingClientRect().top + 4,
    '最后一条消息末尾不被自动增高的输入框压住',
  );
  await capture('capped');
  run.first = first;
  run.three = three;
  run.capped = capped;
  await replace('');
  await wait(150);
  expect(viewport().clientHeight < 84, '清空长草稿后自动收回紧凑高度');
  // Real wheel history navigation must cancel message following before resizing.
  const mb = messages.getBoundingClientRect();
  await native('Input.dispatchMouseEvent', {
    type: 'mouseWheel',
    x: mb.left + mb.width / 2,
    y: mb.top + mb.height / 2,
    deltaX: 0,
    deltaY: -800,
  });
  await wait(200);
  await replace('历史回看时的新草稿\n'.repeat(30));
  await wait(200);
  expect(
    messages.scrollHeight - messages.scrollTop - messages.clientHeight > 100,
    '浏览历史时输入框增高不拉回最新消息',
  );
  await replace('');
  messages.scrollTop = messages.scrollHeight;
  result.composerTextGeometry = [];
  const oldFont = document.body.style.getPropertyValue('--shiye-input-size');
  for (const font of [16, 19.84, 32]) {
    document.body.style.setProperty('--shiye-input-size', font + 'px');
    await replace('');
    const s = input().closest('.input-scroller');
    expect(
      Math.abs(parseFloat(getComputedStyle(input()).fontSize) - font) < 0.1,
      font + 'px输入矩阵实际字号生效',
    );
    const fontPlaceholder = input().parentElement.querySelector('.placeholder-text');
    expect(
      Math.abs(parseFloat(getComputedStyle(fontPlaceholder).fontSize) - font) < 0.1,
      font + 'px输入矩阵空提示字号一致',
    );
    expect(
      getComputedStyle(fontPlaceholder).lineHeight === getComputedStyle(input()).lineHeight,
      font + 'px输入矩阵空提示行高一致',
    );
    const p = input().parentElement.querySelector('.placeholder-text');
    const pb = p.getBoundingClientRect(),
      sb = s.getBoundingClientRect();
    result.composerTextGeometry.push({ font, placeholder: pb.toJSON(), scroller: sb.toJSON() });
    expect(
      Math.abs(pb.top + pb.height / 2 - (sb.top + sb.height / 2)) < 5,
      font + 'px字号空提示垂直居中',
    );
    const symbol = document
      .querySelector('.Composer.is-chat-composer .shiye-symbol-button')
      .getBoundingClientRect();
    expect(
      Math.abs(symbol.top + symbol.height / 2 - (pb.top + pb.height / 2)) < 5,
      font + 'px字号表情图标与空提示垂直对齐',
    );
    await replace('说g中文文本');
    const pill = input().closest('.Composer').getBoundingClientRect();
    expect(
      input().getBoundingClientRect().left >= pill.left + 14,
      font + 'px字号简化工具后仍保留左侧圆角内边距',
    );
    for (const selector of ['.ai-composer-button', '.rich-editor-button', '.AttachMenu']) {
      const buttons = [...document.querySelectorAll('.Composer.is-chat-composer ' + selector)];
      expect(
        buttons.every((button) => !button.getClientRects().length),
        font + 'px字号移除控件不占位：' + selector,
      );
    }
    const range = document.createRange();
    range.selectNodeContents(input());
    const text = range.getBoundingClientRect();
    expect(
      text.top >= s.getBoundingClientRect().top &&
        text.bottom <= s.getBoundingClientRect().bottom + 1,
      font + 'px字号首行文字完整显示',
    );
  }
  document.body.style.setProperty('--shiye-input-size', oldFont);
  await replace('');
  await wait(200);
  // Exercise the soft-wrap boundary that formerly oscillated between a narrow
  // three-line row and a wide two-line editor even after typing had stopped.
  document.body.style.setProperty('--shiye-input-size', '17.28px');
  await replace('');
  const editorStyle = getComputedStyle(input());
  const canvas = document.createElement('canvas');
  const context = canvas.getContext('2d');
  context.font = editorStyle.font;
  const available =
    input().clientWidth -
    parseFloat(editorStyle.paddingLeft) -
    parseFloat(editorStyle.paddingRight);
  const criticalLength = Math.ceil((available / context.measureText('1').width) * 2.4);
  await replace('1'.repeat(criticalLength));
  await wait(150);
  const softWrapSamples = [];
  for (let sample = 0; sample < 24; sample++) {
    await new Promise(requestAnimationFrame);
    const rect = viewport().getBoundingClientRect();
    softWrapSamples.push({ height: rect.height, width: rect.width });
  }
  result.composerSoftWrap = { criticalLength, samples: softWrapSamples };
  expect(
    Math.max(...softWrapSamples.map((item) => item.height)) -
      Math.min(...softWrapSamples.map((item) => item.height)) <
      1 &&
      Math.max(...softWrapSamples.map((item) => item.width)) -
        Math.min(...softWrapSamples.map((item) => item.width)) <
        1,
    '软折临界文本停止输入后高度宽度保持稳定',
  );
  await replace('1');
  await wait(100);
  expect(viewport().clientHeight < 84, '临界文本删回单行可恢复紧凑输入');
  document.body.style.setProperty('--shiye-input-size', oldFont);
  await replace('');
  await wait(150);
  const box = handle.getBoundingClientRect();
  const x = box.x + box.width / 2,
    y = box.y + box.height / 2;
  const hit = document.elementFromPoint(x, y);
  const scroll = input().closest('.input-scroller');
  result.composerPointer = {
    handle: box.toJSON(),
    hit: hit?.outerHTML.slice(0, 220),
    inputHeight: input().clientHeight,
    scrollerHeight: scroll.clientHeight,
  };
  expect(hit === handle || handle.contains(hit), '输入高度拖动条可被真实鼠标命中');
  const before = scroll.clientHeight;
  await native('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y });
  await native('Input.dispatchMouseEvent', {
    type: 'mousePressed',
    x,
    y,
    button: 'left',
    buttons: 1,
    clickCount: 1,
  });
  for (let step = 1; step <= 8; step++) {
    await native('Input.dispatchMouseEvent', {
      type: 'mouseMoved',
      x,
      y: y - step * 12,
      button: 'left',
      buttons: 1,
    });
    await wait(20);
  }
  await native('Input.dispatchMouseEvent', {
    type: 'mouseReleased',
    x,
    y: y - 96,
    button: 'left',
    buttons: 0,
    clickCount: 1,
  });
  await wait(200);
  expect(scroll.clientHeight > before + 50, '真实鼠标向上拖动增高可见输入区');
  const enlarged = scroll.clientHeight;
  const moved = handle.getBoundingClientRect(),
    downX = moved.left + moved.width / 2,
    downY = moved.top + moved.height / 2;
  await native('Input.dispatchMouseEvent', {
    type: 'mousePressed',
    x: downX,
    y: downY,
    button: 'left',
    buttons: 1,
    clickCount: 1,
  });
  await native('Input.dispatchMouseEvent', {
    type: 'mouseMoved',
    x: downX,
    y: downY + 32,
    button: 'left',
    buttons: 1,
  });
  await native('Input.dispatchMouseEvent', {
    type: 'mouseReleased',
    x: downX,
    y: downY + 32,
    button: 'left',
    buttons: 0,
    clickCount: 1,
  });
  await wait(150);
  expect(scroll.clientHeight < enlarged - 20, '真实鼠标向下拖动可缩小当前输入区');
  await capture('manual');
  await replace('回看长文\n'.repeat(50) + '底部完整文字');
  window.dispatchEvent(new Event('shiye-focus-end'));
  await wait(300);
  const bottom = scroll.scrollTop;
  result.composerPointer.after = {
    inputHeight: input().clientHeight,
    scrollerHeight: scroll.clientHeight,
    scrollHeight: scroll.scrollHeight,
    scrollTop: bottom,
  };
  const rect = scroll.getBoundingClientRect();
  await native('Input.dispatchMouseEvent', {
    type: 'mouseWheel',
    x: rect.left + rect.width / 2,
    y: rect.top + rect.height / 2,
    deltaX: 0,
    deltaY: -500,
  });
  await wait(300);
  expect(bottom > 100 && scroll.scrollTop < bottom - 100, '真实滚轮可向上回看长草稿');
  await native('Input.dispatchMouseEvent', {
    type: 'mouseWheel',
    x: rect.left + rect.width / 2,
    y: rect.top + rect.height / 2,
    deltaX: 0,
    deltaY: 10000,
  });
  await wait(300);
  expect(
    scroll.scrollHeight - scroll.clientHeight - scroll.scrollTop < 3,
    '真实滚轮可看见最后一行与底部留白',
  );
  await replace('');
  await wait(150);
  // U51 supersedes the former clear/send/room reset: manual mode is a preference.
  expect(
    Math.abs(viewport().clientHeight - manualExpected()) < 2,
    '手动调整后清空仍保持选择的高度',
  );
  const remembered = Number(localStorage.getItem('shiye-input-manual-height-v1'));
  await replace('保持手动高度\n'.repeat(40));
  await wait(150);
  expect(Math.abs(viewport().clientHeight - manualExpected()) < 2, '重新输入不覆盖手动高度');
  const footer = input().closest('.middle-column-footer');
  const pill = input().closest('.Composer').getBoundingClientRect();
  expect(input().getBoundingClientRect().width >= pill.width - 64, '手动高输入正文使用整行宽度');
  const tools = [
    ...footer.querySelectorAll('.shiye-symbol-button, .Composer > .main-button'),
  ].filter((button) => button.getClientRects().length);
  expect(tools.length > 0, '高输入底部工具行有实际按钮');
  expect(
    tools.every(
      (button) =>
        button.getBoundingClientRect().top >= viewport().getBoundingClientRect().bottom - 1,
    ),
    '符号和发送位于正文下方不遮最后一行',
  );
  result.composerManualPreference = {
    requested: remembered,
    effective: viewport().clientHeight,
    editorWidth: input().getBoundingClientRect().width,
    pillWidth: pill.width,
  };
  handle.focus();
  for (const type of ['rawKeyDown', 'keyUp'])
    await native('Input.dispatchKeyEvent', {
      type,
      key: 'ArrowUp',
      code: 'ArrowUp',
      windowsVirtualKeyCode: 38,
    });
  const beforeRoomEditor = input();
  const beforeRoomHeight = viewport().clientHeight;
  await chooseRoom(nextRoomLabel);
  await wait(150);
  expect(Math.abs(viewport().clientHeight - beforeRoomHeight) < 2, '切到其他会话仍保持手动高度');
  await chooseRoom('随手记');
  await wait(200);
  handle = input().closest('.middle-column-footer').querySelector('.shiye-input-resizer');
  expect(
    Math.abs(viewport().clientHeight - manualExpected()) < 2 &&
      Number(localStorage.getItem('shiye-input-manual-height-v1')) > 80,
    '切回会话及编辑器重新绑定不清除手动高度',
  );
  result.composerManualPreference.editorRebound = input() !== beforeRoomEditor;
  expect(input().textContent.includes('保持手动高度'), '高度调整后换会话仍恢复长草稿');
  await replace('手动高度发送保持验收' + Date.now());
  handle.focus();
  for (const type of ['rawKeyDown', 'keyUp'])
    await native('Input.dispatchKeyEvent', {
      type,
      key: 'ArrowUp',
      code: 'ArrowUp',
      windowsVirtualKeyCode: 38,
    });
  input().focus();
  for (const type of ['rawKeyDown', 'keyUp'])
    await native('Input.dispatchKeyEvent', {
      type,
      key: 'Enter',
      code: 'Enter',
      windowsVirtualKeyCode: 13,
    });
  for (let attempt = 0; attempt < 40 && input().textContent; attempt++) await wait(100);
  await wait(150);
  expect(
    !input().textContent && Math.abs(viewport().clientHeight - manualExpected()) < 2,
    '手动增高后真实Enter发送清空但保持高度',
  );
  await replace('');
  await resetAuto();
  expect(
    viewport().clientHeight < 84 && !localStorage.getItem('shiye-input-manual-height-v1'),
    'Home明确恢复自动高度并清除manual偏好',
  );
};

/* Exercise actual DOM media handlers with generated files; never touch OS clipboard. */
window.shiyeVerifyMediaInput = async ({
  blob,
  input,
  replace,
  key,
  wait,
  until,
  expect,
  result,
}) => {
  expect(Boolean(window.shiyeVerifyVideoBase64), '原生验收载入隔离生成的MP4样本');
  const bytes = Uint8Array.from(atob(window.shiyeVerifyVideoBase64), (char) => char.charCodeAt(0));
  const video = new File([bytes], '合成粘贴拖入验收.mp4', { type: 'video/mp4' });
  result.mediaInput = [];
  for (const [kind, file] of [
    ['图片', new File([blob], '粘贴拖入验收.png', { type: 'image/png' })],
    ['视频', video],
  ]) {
    for (const route of ['粘贴', '拖入']) {
      const draft = kind + route + '前的已有文字';
      await replace(draft);
      input().focus();
      const transfer = new DataTransfer();
      transfer.items.add(file);
      if (route === '粘贴') {
        input().dispatchEvent(
          new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: transfer }),
        );
      } else {
        const layout = document.querySelector('#MiddleColumn .messages-layout');
        const enter = () =>
          layout.dispatchEvent(
            new DragEvent('dragenter', { bubbles: true, cancelable: true, dataTransfer: transfer }),
          );
        enter();
        const hover = setInterval(() => {
          layout.dispatchEvent(
            new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: transfer }),
          );
          if (
            !document.body.dataset.shiyeMediaDrag &&
            !document.querySelector('.DropArea .DropTarget')
          )
            enter();
        }, 100);
        try {
          await until(
            () =>
              document.body.dataset.shiyeMediaDrag ||
              document.querySelector('.DropArea .DropTarget'),
            '媒体拖入区域出现',
          );
        } finally {
          clearInterval(hover);
        }
        const target = document.body.dataset.shiyeMediaDrag
          ? layout
          : [...document.querySelectorAll('.DropArea .DropTarget')].at(-1);
        target.dispatchEvent(
          new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: transfer }),
        );
      }
      await until(
        () => document.querySelector('.Modal.open [aria-label="确认发送"]'),
        kind + route + '进入发送确认',
      );
      if (kind === '视频') {
        await until(
          () => [...document.querySelectorAll('.Modal.open video')].some((el) => el.videoWidth > 0),
          '视频确认预览可解码',
        );
      } else {
        await until(
          () =>
            [...document.querySelectorAll('.Modal.open img')].some((el) => el.naturalWidth === 960),
          '图片确认预览可解码',
        );
      }
      expect(true, kind + route + '可正常预览且不依赖附件按钮');
      await key('Escape', 'Escape', 27);
      await until(() => !document.querySelector('.Modal.open'), '取消媒体确认');
      await wait(400);
      expect(input().textContent.includes(draft), kind + route + '取消后保留已有草稿');
      result.mediaInput.push({
        kind,
        route,
        bytes: file.size,
        preview: true,
        draftPreserved: true,
      });
    }
  }
  await replace('');
};
