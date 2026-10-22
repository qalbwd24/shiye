/* Runs only in the isolated native image verification window. */
(async () => {
  const result = { kind: 'image-verification', checks: [], errors: [] };
  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const post = (data) => window.chrome.webview.postMessage(data);
  async function until(read, label) {
    for (let i = 0; i < 100; i++) {
      if (read()) return;
      await wait(50);
    }
    throw Error(label);
  }
  function expect(value, name) {
    if (!value) throw Error(name);
    result.checks.push(name);
  }
  function request(data, response) {
    return new Promise((resolve, reject) => {
      const id = crypto.randomUUID();
      const timeout = setTimeout(() => reject(Error(response)), 6000);
      const receive = ({ data: reply }) => {
        if (reply.kind !== response || (reply.id && reply.id !== id)) return;
        clearTimeout(timeout);
        window.chrome.webview.removeEventListener('message', receive);
        resolve();
      };
      window.chrome.webview.addEventListener('message', receive);
      post({ ...data, id });
    });
  }
  const native = (method, parameters) =>
    request({ kind: 'image-verify-input', method, parameters }, 'image-verify-input-result');
  const key = (value, code) =>
    native('Input.dispatchKeyEvent', {
      type: 'keyDown',
      key: value,
      code: value,
      windowsVirtualKeyCode: code,
    }).then(() =>
      native('Input.dispatchKeyEvent', {
        type: 'keyUp',
        key: value,
        code: value,
        windowsVirtualKeyCode: code,
      }),
    );
  try {
    const image = document.querySelector('#image');
    const stage = document.querySelector('#stage');
    for (let attempt = 0; !image.naturalWidth && attempt < 100; attempt++) await wait(100);
    expect(image.naturalWidth === 960 && image.naturalHeight === 640, '查看器读取原图尺寸');
    await until(() => document.hasFocus() && document.activeElement === stage, '图片加载后焦点没有进入看图区域');
    expect(true, '图片打开后无需点击即可接收Esc和缩放按键');
    await request({ kind: 'image-verify-size' }, 'image-verify-sized');
    await wait(250);
    expect(
      document.querySelector('header').getBoundingClientRect().bottom <=
        stage.getBoundingClientRect().top + 1,
      '窄窗工具栏换行后不遮图片',
    );
    const fitted = image.getBoundingClientRect();
    expect(fitted.width < 960 && fitted.width <= stage.clientWidth, '适配窗口显示完整图片');
    const sx = stage.clientWidth / 2,
      sy = stage.getBoundingClientRect().top + stage.clientHeight / 2;
    await native('Input.dispatchMouseEvent', {
      type: 'mouseWheel',
      x: sx,
      y: sy,
      deltaX: 0,
      deltaY: -1100,
    });
    await wait(200);
    expect(image.getBoundingClientRect().width > fitted.width * 2, '普通滚轮放大图片');
    // High-DPI narrow fixtures may only just exceed the stage after the first wheel.
    // Zoom far enough to allow the requested pan, rather than mistaking edge clamping for a failure.
    for (
      let attempt = 0;
      attempt < 5 && image.getBoundingClientRect().width < stage.clientWidth + 240;
      attempt++
    ) {
      await native('Input.dispatchMouseEvent', {
        type: 'mouseWheel',
        x: sx,
        y: sy,
        deltaX: 0,
        deltaY: -500,
      });
      await wait(80);
    }
    const beforePan = image.getBoundingClientRect();
    const dx = Math.min(100, stage.clientWidth * 0.25);
    const dy = Math.min(60, stage.clientHeight * 0.2);
    await native('Input.dispatchMouseEvent', {
      type: 'mousePressed',
      x: sx,
      y: sy,
      button: 'left',
      buttons: 1,
      clickCount: 1,
    });
    for (let step = 1; step <= 4; step++) {
      await native('Input.dispatchMouseEvent', {
        type: 'mouseMoved',
        x: sx + (dx * step) / 4,
        y: sy + (dy * step) / 4,
        button: 'left',
        buttons: 1,
      });
      await wait(25);
    }
    await native('Input.dispatchMouseEvent', {
      type: 'mouseReleased',
      x: sx + dx,
      y: sy + dy,
      button: 'left',
      buttons: 0,
      clickCount: 1,
    });
    await wait(150);
    result.pan = {
      dx,
      dy,
      stageWidth: stage.clientWidth,
      stageHeight: stage.clientHeight,
      movedX: image.getBoundingClientRect().left - beforePan.left,
    };
    expect(result.pan.movedX > dx * 0.6, '放大后鼠标拖动平移');
    for (const type of ['mousePressed', 'mouseReleased'])
      await native('Input.dispatchMouseEvent', {
        type,
        x: sx,
        y: sy,
        button: 'right',
        clickCount: 1,
      });
    await wait(100);
    expect(!document.querySelector('#menu').hidden, '图片右键菜单直接打开');
    await key('Escape', 27);
    expect(document.querySelector('#menu').hidden, '图片菜单 Esc 只关闭菜单');
    await key('1', 49);
    expect(Math.abs(image.getBoundingClientRect().width - 960) < 1, '原尺寸显示');
    await key('0', 48);
    await wait(100);
    expect(image.getBoundingClientRect().width <= stage.clientWidth, '复位适配显示');
    let remembered;
    window.chrome.webview.addEventListener('message', ({ data }) => {
      if (data.kind === 'image-remembered') remembered = data;
    });
    post({ kind: 'image-verify-remember' });
    await until(() => remembered, '图片窗口设置写入');
    result.remembered = remembered;
    expect(remembered.width === 720 && remembered.height === 520, '图片窗口调整后的尺寸可保存');
    post(result);
    await key('Escape', 27);
  } catch (error) {
    result.errors.push(error.stack || error.message);
    post(result);
  }
})();
