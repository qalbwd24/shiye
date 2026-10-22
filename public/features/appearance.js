import { regions, fills, positions, defaults, normalizeAppearance } from '../shared/appearance.js';
import { LIMITS } from '../shared/limits.js';
import { applyTheme } from './theme.js';

/** Local draft previews; only Save commits preferences. Background files use media APIs. */
export function createAppearance(c) {
  const { $, $$, api, escape: esc } = c;
  const prefs = () => c.library.settings?.preferences || {};
  function current() {
    try {
      return normalizeAppearance(prefs().appearance || defaults());
    } catch {
      return defaults();
    }
  }
  function preview(a, theme) {
    const root = document.documentElement;
    applyTheme({ ...prefs(), theme });
    root.style.setProperty('--accent', a.accent);
    root.style.setProperty('--accent-dark', `color-mix(in srgb, ${a.accent}, black 24%)`);
    root.style.setProperty('--mint', `color-mix(in srgb, ${a.accent} 14%, var(--paper))`);
    document.body.classList.toggle(
      'global-background',
      a.backgrounds.some((b) => b.region === 'app'),
    );
    for (const [key] of regions) {
      const el = key === 'app' ? document.body : $(`[data-bg-region="${key}"]`);
      const b = a.backgrounds.find((b) => b.region === key);
      el.classList.toggle('custom-background', !!b);
      el.style.setProperty('--region-image', b ? `url("/media/${b.id}")` : 'none');
      el.style.setProperty('--region-opacity', String(b?.opacity ?? 0));
      el.style.setProperty('--region-size', b?.fill === 'tile' ? 'auto' : b?.fill || 'cover');
      el.style.setProperty('--region-repeat', b?.fill === 'tile' ? 'repeat' : 'no-repeat');
      el.style.setProperty('--region-position', b?.position || 'center');
    }
  }
  const apply = () => preview(current(), prefs().theme || 'system');

  function settings() {
    let draft = current(),
      theme = prefs().theme || 'system',
      region = 'app',
      active = true,
      pending = false;
    const swatches = ['#05a6b2', '#4a78c2', '#8066b5', '#b86f87', '#ac8343', '#548866'];
    c.modal(
      '外观与背景',
      `<div id="appearanceSettings">
      <p class="appearance-intro">让书写空间更像自己。调整会即时预览，保存后生效。</p>
      <div class="appearance-columns"><section class="appearance-controls">
        <label>界面主题<select id="appearanceTheme" class="field"><option value="light">浅色</option><option value="dark">深色</option><option value="system">跟随系统</option></select></label>
        <label>主题色</label><div class="swatch-row">${swatches.map((s) => `<button type="button" class="swatch" data-accent="${s}" style="--swatch:${s}" aria-label="主题色 ${s}"></button>`).join('')}<input type="color" id="appearanceAccent" value="${draft.accent}" aria-label="自定义主题色"></div>
        <label>背景区域<select id="bgRegion" class="field">${regions.map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select></label>
        <div id="bgControls"></div>
      </section><section class="appearance-preview"><div id="bgPreview"></div><p>图片不透明度：0% 完全透明，100% 完全显示。文字与按钮保持清晰。</p><p>整体背景可透过各区域显示；分区背景可单独覆盖。</p></section></div>
      <input id="bgFileInput" type="file" accept="image/png,image/jpeg,image/webp,image/gif" hidden>
      <p id="appearanceStatus" role="status"></p>
      <div class="appearance-actions"><button id="appearanceReset" class="secondary">恢复默认</button><span></span><button id="appearanceCancel" class="secondary">取消</button><button id="appearanceSave" class="primary">保存设置</button></div>
    </div>`,
    );
    $('#modal').classList.add('appearance-dialog');
    const cleanup = () => {
      active = false;
      $('#modal').classList.remove('appearance-dialog');
      $('#modal').removeEventListener('close', cleanup);
      $('#modal').removeEventListener('modalreplace', cleanup);
      apply();
    };
    $('#modal').addEventListener('close', cleanup);
    $('#modal').addEventListener('modalreplace', cleanup);
    function render() {
      const b = draft.backgrounds.find((b) => b.region === region);
      $('#bgControls').innerHTML =
        `<button class="secondary" id="bgUpload">${b ? '更换图片' : '选择背景图片'}</button><small class="appearance-hint">PNG / JPG / WebP / GIF，最大 20 MiB</small>${
          b
            ? `
        <label>图片不透明度 <output id="bgOpacityValue">${Math.round(b.opacity * 100)}%</output><input id="bgOpacity" type="range" min="0" max="100" step="1" value="${Math.round(b.opacity * 100)}"></label>
        <label>填充方式<select id="bgFill" class="field">${fills.map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select></label>
        <label>图片位置<select id="bgPosition" class="field">${positions.map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select></label>
        <button class="danger" id="bgRemove">移除此区域背景</button>`
            : ''
        }`;
      $('#bgPreview').innerHTML = b
        ? `<img src="/media/${b.id}" alt="${esc(regions.find(([r]) => r === region)[1])}背景预览">`
        : '<div class="background-placeholder">一张图片，一种心情<br><small>选择图片后在此预览</small></div>';
      $('#bgUpload').disabled = pending;
      $('#bgUpload').onclick = () => $('#bgFileInput').click();
      if (b) {
        $('#bgFill').value = b.fill;
        $('#bgPosition').value = b.position;
        $('#bgOpacity').oninput = (e) => {
          b.opacity = Number(e.target.value) / 100;
          $('#bgOpacityValue').textContent = e.target.value + '%';
          preview(draft, theme);
        };
        $('#bgFill').onchange = (e) => {
          b.fill = e.target.value;
          preview(draft, theme);
        };
        $('#bgPosition').onchange = (e) => {
          b.position = e.target.value;
          preview(draft, theme);
        };
        $('#bgRemove').onclick = () => {
          draft.backgrounds = draft.backgrounds.filter((b) => b.region !== region);
          render();
          preview(draft, theme);
        };
      }
      $$('.swatch').forEach((el) =>
        el.setAttribute('aria-pressed', String(el.dataset.accent === draft.accent)),
      );
    }
    $('#appearanceTheme').value = theme;
    $('#appearanceTheme').onchange = (e) => {
      theme = e.target.value;
      preview(draft, theme);
    };
    $('#bgRegion').onchange = (e) => {
      region = e.target.value;
      render();
    };
    $('#appearanceAccent').oninput = (e) => {
      draft.accent = e.target.value;
      preview(draft, theme);
    };
    $$('.swatch').forEach((el) => {
      el.onclick = () => {
        draft.accent = el.dataset.accent;
        $('#appearanceAccent').value = draft.accent;
        render();
        preview(draft, theme);
      };
    });
    $('#bgFileInput').onchange = async (e) => {
      const file = e.target.files[0],
        uploadRegion = region;
      e.target.value = '';
      if (!file) return;
      if (file.size > LIMITS.backgroundBytes) {
        $('#appearanceStatus').textContent = '图片超过 20 MiB，请缩小后重试';
        return;
      }
      pending = true;
      $('#appearanceSave').disabled = true;
      render();
      $('#appearanceStatus').textContent = '正在导入图片…';
      try {
        const item = await api('/api/backgrounds', {
          method: 'POST',
          raw: file,
          headers: { 'Content-Type': file.type, 'X-File-Name': encodeURIComponent(file.name) },
        });
        if (!active) return;
        const old = draft.backgrounds.find((b) => b.region === uploadRegion);
        draft.backgrounds = draft.backgrounds.filter((b) => b.region !== uploadRegion);
        draft.backgrounds.push({
          region: uploadRegion,
          opacity: 0.2,
          fill: 'cover',
          position: 'center',
          ...old,
          id: item.id,
        });
        $('#appearanceStatus').textContent = '图片已就绪，点击“保存设置”应用。';
        preview(draft, theme);
      } catch (err) {
        if (active) $('#appearanceStatus').textContent = err.message;
      } finally {
        if (active) {
          pending = false;
          $('#appearanceSave').disabled = false;
          render();
        }
      }
    };
    $('#appearanceCancel').onclick = c.closeModal;
    $('#appearanceReset').onclick = () => {
      draft = defaults();
      theme = 'system';
      $('#appearanceTheme').value = theme;
      $('#appearanceAccent').value = draft.accent;
      render();
      preview(draft, theme);
    };
    $('#appearanceSave').onclick = async () => {
      $('#appearanceSave').disabled = true;
      try {
        const value = await api('/api/preferences', {
          method: 'PUT',
          data: { appearance: normalizeAppearance(draft), theme },
        });
        c.library.settings.preferences = value;
        c.closeModal();
        c.toast('外观已保存');
      } catch (e) {
        if (active) {
          $('#appearanceStatus').textContent = e.message;
          $('#appearanceSave').disabled = false;
        }
      }
    };
    render();
  }
  return { apply, settings };
}
