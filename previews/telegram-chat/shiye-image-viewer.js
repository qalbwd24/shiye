(() => {
  const stage = document.querySelector('#stage');
  stage.tabIndex = -1;
  const focusImage = () => stage.focus({ preventScroll: true });
  window.addEventListener('focus', focusImage);
  const image = document.querySelector('#image');
  image.addEventListener('load', () => window.chrome.webview.postMessage({ kind: 'image-ready' }), {
    once: true,
  });
  image.addEventListener(
    'error',
    () => window.chrome.webview.postMessage({ kind: 'image-load-failed' }),
    { once: true },
  );
  if (image.complete && image.naturalWidth)
    window.chrome.webview.postMessage({ kind: 'image-ready' });
  const menu = document.querySelector('#menu');
  let scale = 1;
  let x = 0;
  let y = 0;
  let fitted = true;
  let drag;
  function constrainPan() {
    if (!image.naturalWidth) return;
    const width = image.naturalWidth * scale;
    const height = image.naturalHeight * scale;
    x =
      width <= stage.clientWidth
        ? (stage.clientWidth - width) / 2
        : Math.min(0, Math.max(stage.clientWidth - width, x));
    y =
      height <= stage.clientHeight
        ? (stage.clientHeight - height) / 2
        : Math.min(0, Math.max(stage.clientHeight - height, y));
  }
  function paint() {
    image.style.transform = `translate(${x}px, ${y}px) scale(${scale})`;
    document.querySelector('#percent').textContent = `${Math.round(scale * 100)}%`;
  }
  function center(value) {
    scale = value;
    x = (stage.clientWidth - image.naturalWidth * scale) / 2;
    y = (stage.clientHeight - image.naturalHeight * scale) / 2;
    paint();
  }
  function fit() {
    if (!image.naturalWidth) return;
    fitted = true;
    center(
      Math.min(
        1,
        (stage.clientWidth - 32) / image.naturalWidth,
        (stage.clientHeight - 32) / image.naturalHeight,
      ),
    );
  }
  function zoom(value, anchorX = stage.clientWidth / 2, anchorY = stage.clientHeight / 2) {
    fitted = false;
    const next = Math.max(0.01, Math.min(16, value));
    const ratio = next / scale;
    x = anchorX - (anchorX - x) * ratio;
    y = anchorY - (anchorY - y) * ratio;
    scale = next;
    constrainPan();
    paint();
  }
  const actions = {
    fit,
    actual: () => {
      fitted = false;
      center(1);
    },
    in: () => zoom(scale * 1.2),
    out: () => zoom(scale / 1.2),
    copy: () => window.chrome.webview.postMessage({ kind: 'image-copy' }),
    save: () => window.chrome.webview.postMessage({ kind: 'image-save' }),
  };
  document.addEventListener('click', (event) => {
    const action = event.target.closest('[data-action]')?.dataset.action;
    if (action) actions[action]();
    menu.hidden = true;
  });
  stage.addEventListener(
    'wheel',
    (event) => {
      event.preventDefault();
      const rect = stage.getBoundingClientRect();
      zoom(
        scale * Math.exp(-event.deltaY * 0.0015),
        event.clientX - rect.left,
        event.clientY - rect.top,
      );
    },
    { passive: false },
  );
  stage.onpointerdown = (event) => {
    if (event.button !== 0) return;
    menu.hidden = true;
    drag = { startX: event.clientX, startY: event.clientY, x, y };
    stage.setPointerCapture(event.pointerId);
    stage.classList.add('dragging');
  };
  stage.onpointermove = (event) => {
    if (!drag) return;
    x = drag.x + event.clientX - drag.startX;
    y = drag.y + event.clientY - drag.startY;
    constrainPan();
    paint();
  };
  stage.onlostpointercapture = () => {
    drag = undefined;
    stage.classList.remove('dragging');
  };
  stage.onpointerup = (event) => {
    if (stage.hasPointerCapture(event.pointerId)) stage.releasePointerCapture(event.pointerId);
  };
  stage.ondblclick = () => {
    if (fitted) actions.actual();
    else fit();
  };
  stage.oncontextmenu = (event) => {
    event.preventDefault();
    menu.hidden = false;
    menu.style.left = `${Math.max(0, Math.min(event.clientX, innerWidth - menu.offsetWidth - 8))}px`;
    menu.style.top = `${Math.max(0, Math.min(event.clientY, innerHeight - menu.offsetHeight - 8))}px`;
  };
  window.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      if (!menu.hidden) menu.hidden = true;
      else window.chrome.webview.postMessage({ kind: 'image-close' });
    } else if (event.key === '+' || event.key === '=') actions.in();
    else if (event.key === '-') actions.out();
    else if (event.key === '0') fit();
    else if (event.key === '1') actions.actual();
    else return;
    event.preventDefault();
  });
  image.onload = () => { fit(); focusImage(); };
  image.onerror = () => {
    const status = document.querySelector('#status');
    status.textContent = '无法解码这张图片，请关闭后重试或另存原文件。';
    status.hidden = false;
  };
  image.src = 'https://shiye-image.local/image';
  new ResizeObserver(() => {
    if (fitted) fit();
    else {
      constrainPan();
      paint();
    }
  }).observe(stage);
  new ResizeObserver(() => {
    document.documentElement.style.setProperty(
      '--toolbar-height',
      `${document.querySelector('header').getBoundingClientRect().height}px`,
    );
  }).observe(document.querySelector('header'));
  window.chrome.webview.addEventListener('message', ({ data }) => {
    const status = document.querySelector('#status');
    status.textContent = data.message;
    status.hidden = false;
    setTimeout(() => {
      status.hidden = true;
    }, 4000);
  });
})();
