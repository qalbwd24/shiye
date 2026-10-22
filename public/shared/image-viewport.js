/** Image-only zoom; never changes browser or native window scale. */
export function installImageViewport(root) {
  const stage = root.querySelector('[data-image-stage]');
  const image = stage.querySelector('img');
  const label = root.querySelector('[data-image-scale]');
  let scale = 1,
    x = 0,
    y = 0,
    drag;
  function render() {
    image.style.transform = `translate(${x}px, ${y}px) scale(${scale})`;
    label.textContent = `${Math.round(scale * 100)}%`;
    stage.dataset.zoomed = String(scale > 1);
  }
  function zoom(next) {
    scale = Math.max(0.1, Math.min(16, next));
    if (scale <= 1) x = y = 0;
    render();
  }
  const step = (direction) => zoom(direction ? scale * (direction > 0 ? 1.2 : 1 / 1.2) : 1);
  root.querySelectorAll('[data-image-zoom]').forEach((button) => {
    button.onclick = () => step(Number(button.dataset.imageZoom));
  });
  root.querySelector('[data-image-original]').onclick = () => {
    const fit = Math.min(
      stage.clientWidth / image.naturalWidth,
      stage.clientHeight / image.naturalHeight,
      1,
    );
    if (fit > 0 && Number.isFinite(fit)) zoom(1 / fit);
  };
  stage.ondblclick = () => step(scale > 1 ? 0 : 3);
  const controller = new AbortController();
  const options = { capture: true, signal: controller.signal };
  // Capture at the window before desktop-wide document hotkeys.
  root.ownerDocument.defaultView.addEventListener(
    'keydown',
    (event) => {
      if (!root.open || event.isComposing || event.altKey) return;
      const direction = ['+', '=', 'Add'].includes(event.key)
        ? 1
        : ['-', '_', 'Subtract'].includes(event.key)
          ? -1
          : event.key === '0'
            ? 0
            : undefined;
      if (direction === undefined) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      step(direction);
    },
    options,
  );
  root.addEventListener(
    'wheel',
    (event) => {
      if (!event.deltaY) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      step(event.deltaY < 0 ? 1 : -1);
    },
    { ...options, passive: false },
  );
  stage.onpointerdown = (event) => {
    if (event.button !== 0 || scale <= 1) return;
    drag = { id: event.pointerId, x: event.clientX - x, y: event.clientY - y };
    stage.setPointerCapture(event.pointerId);
    event.preventDefault();
  };
  stage.onpointermove = (event) => {
    if (!drag || event.pointerId !== drag.id) return;
    x = event.clientX - drag.x;
    y = event.clientY - drag.y;
    render();
  };
  stage.onpointerup = stage.onpointercancel = () => {
    drag = undefined;
  };
  render();
  return () => controller.abort();
}

export const imageZoomControls =
  '<div class="image-zoom-controls" aria-label="图片缩放"><button class="secondary" data-image-zoom="-1" aria-label="缩小图片">−</button><output data-image-scale aria-live="polite">100%</output><button class="secondary" data-image-zoom="1" aria-label="放大图片">＋</button><button class="secondary" data-image-zoom="0">适应窗口</button><button class="secondary" data-image-original>原始像素</button></div>';
