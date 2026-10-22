import { richAssetFromBlob } from '../shared/rich-document-archive.js';

const MAX_BACKGROUND_BYTES = 20 * 1024 * 1024;
const DEFAULT_HINT = 'PNG / JPG / WebP / GIF / AVIF，最大 20 MiB。';
const clamp = (value, min, max, fallback) =>
  Number.isFinite(Number(value)) ? Math.min(max, Math.max(min, Number(value))) : fallback;

/** Wallpaper belongs to this preview workspace, never to a diary or its attachment list. */
export function createNotesBackground({
  getWorkspace,
  registerAsset,
  resolveAsset,
  onChange,
  onError,
  onPending = () => {},
}) {
  const $ = (id) => document.getElementById(id);
  let bound = false;
  let uploadSequence = 0;
  let pending = false;
  let reportedMissing;

  function status(message, error = false) {
    $('background-status').textContent = message;
    $('background-status').dataset.error = String(error);
  }

  function apply() {
    const background = getWorkspace()?.background;
    const opacity = clamp(background?.opacity, 0, 1, 0.2);
    const blur = clamp(background?.blur, 0, 20, 0);
    const fill = ['cover', 'contain', 'tile'].includes(background?.fill)
      ? background.fill
      : 'cover';
    const position = ['center', 'top', 'bottom'].includes(background?.position)
      ? background.position
      : 'center';
    const url = background?.assetId ? resolveAsset(background.assetId) : null;
    const available = typeof url === 'string' && url.startsWith('blob:');
    const root = document.body;
    for (const [name, value] of Object.entries({
      '--notes-background-image': available ? `url(${JSON.stringify(url)})` : 'none',
      '--notes-background-opacity': available ? opacity : 0,
      '--notes-background-blur': `${blur}px`,
      '--notes-background-size': fill === 'tile' ? 'auto' : fill,
      '--notes-background-repeat': fill === 'tile' ? 'repeat' : 'no-repeat',
      '--notes-background-position': position,
    }))
      root.style.setProperty(name, String(value));
    root.dataset.notesBackground = String(available);

    const preview = $('background-preview');
    if (available) {
      let image = preview.querySelector('img');
      if (!image) {
        image = document.createElement('img');
        image.alt = '便签背景预览';
        preview.replaceChildren(image);
      }
      if (image.getAttribute('src') !== url) image.src = url;
      image.style.objectFit = fill === 'tile' ? 'cover' : fill;
      image.style.objectPosition = position;
    } else {
      const message = background?.assetId ? '背景原图缺失，请重新选择图片。' : '未设置背景';
      if (preview.textContent !== message) preview.textContent = message;
    }

    $('background-opacity').value = String(Math.round(opacity * 100));
    $('background-opacity-value').textContent = `${Math.round(opacity * 100)}%`;
    $('background-blur').value = String(blur);
    $('background-blur-value').textContent = `${blur} px`;
    $('background-fill').value = fill;
    $('background-position').value = position;
    for (const name of ['opacity', 'blur', 'fill', 'position'])
      $(`background-${name}`).disabled = !background?.assetId;
    $('background-remove').disabled = !background?.assetId && !pending;
    $('background-upload').textContent = pending
      ? '正在读取…'
      : background?.assetId
        ? '更换图片'
        : '选择图片';

    if (background?.assetId && !available) {
      const error = new Error('便签背景原图缺失，已保留背景引用，请重新选择图片或移除背景。');
      status(error.message, true);
      if (reportedMissing !== background.assetId) {
        reportedMissing = background.assetId;
        onError?.(error);
      }
    } else {
      reportedMissing = null;
      status(pending ? '正在读取背景图片…' : DEFAULT_HINT);
    }
  }

  function change(key, value) {
    const workspace = getWorkspace();
    if (!workspace?.background) return;
    workspace.background[key] = value;
    apply();
    onChange();
  }

  function bind() {
    if (bound) return;
    bound = true;
    $('background-upload').addEventListener('click', () => $('background-file').click());
    $('background-file').addEventListener('change', async (event) => {
      const file = event.target.files[0];
      event.target.value = '';
      if (!file) return;
      const sequence = ++uploadSequence;
      pending = true;
      onPending(true);
      apply();
      let failure;
      try {
        if (file.size > MAX_BACKGROUND_BYTES)
          throw new Error('背景图片超过 20 MiB，请缩小后重新选择。');
        const asset = await richAssetFromBlob(file, file.name);
        if (sequence !== uploadSequence) return;
        registerAsset(asset);
        const workspace = getWorkspace();
        if (!workspace) throw new Error('便签尚未准备好，请稍后选择背景。');
        workspace.background = {
          opacity: 0.2,
          blur: 0,
          fill: 'cover',
          position: 'center',
          ...workspace.background,
          assetId: asset.id,
        };
        onChange();
      } catch (error) {
        if (sequence !== uploadSequence) return;
        failure = error;
        status(error.message, true);
        onError?.(error);
      } finally {
        if (sequence === uploadSequence) {
          pending = false;
          onPending(false);
          apply();
          if (failure) status(failure.message, true);
        }
      }
    });
    $('background-remove').addEventListener('click', () => {
      ++uploadSequence;
      if (pending) onPending(false);
      pending = false;
      const workspace = getWorkspace();
      if (!workspace) return;
      workspace.background = null;
      apply();
      onChange();
    });
    $('background-opacity').addEventListener('input', (event) =>
      change('opacity', clamp(event.target.value, 0, 100, 20) / 100),
    );
    $('background-blur').addEventListener('input', (event) =>
      change('blur', clamp(event.target.value, 0, 20, 0)),
    );
    $('background-fill').addEventListener('change', (event) => {
      if (['cover', 'contain', 'tile'].includes(event.target.value))
        change('fill', event.target.value);
    });
    $('background-position').addEventListener('change', (event) => {
      if (['center', 'top', 'bottom'].includes(event.target.value))
        change('position', event.target.value);
    });
  }

  return { apply, bind };
}
