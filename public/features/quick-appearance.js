import { fills, positions } from '../shared/appearance.js';
import { LIMITS } from '../shared/limits.js';
import { applyTheme } from './theme.js';
import {
  normalizeQuickAppearance,
  quickAppearanceDefaults,
  quickFontFamilies,
  quickFontStack,
} from '../shared/quick-appearance.js';

/** Scoped view preferences only: no editor reconstruction or diary changes. */
export function createQuickAppearance(c) {
  const { $, api, escape: esc } = c;
  const enabled = document.body.classList.contains('quick-capture');
  const signalKey = 'shiye.quick-appearance.v1';
  let editing = false;
  const prefs = () => c.library.settings?.preferences || {};
  function current() {
    try {
      return normalizeQuickAppearance(prefs().quickAppearance);
    } catch {
      return quickAppearanceDefaults();
    }
  }
  function preview(value) {
    if (!enabled) return;
    applyTheme(prefs(), value.theme);
    const root = document.body;
    root.dataset.quickBackground = value.backgroundMode;
    root.dataset.quickTypography = String(!value.inheritTypography);
    const b = value.background;
    for (const [key, setting] of Object.entries({
      '--quick-image': b ? `url("/media/${b.id}")` : 'none',
      '--quick-opacity': b?.opacity ?? 0,
      '--quick-size': b?.fill === 'tile' ? 'auto' : b?.fill || 'cover',
      '--quick-repeat': b?.fill === 'tile' ? 'repeat' : 'no-repeat',
      '--quick-position': b?.position || 'center',
      '--quick-blur': value.blur + 'px',
      '--quick-font': quickFontStack(value.fontFamily),
      '--quick-font-size': value.fontSize + 'px',
      '--quick-font-weight': value.fontWeight,
      '--quick-line-height': value.lineHeight,
      '--quick-title-size': value.titleSize + 'px',
      '--quick-title-weight': value.titleWeight,
    }))
      root.style.setProperty(key, String(setting));
  }
  const apply = () => {
    if (!editing) preview(current());
  };
  if (enabled)
    window.addEventListener('storage', (event) => {
      if (event.key !== signalKey || !event.newValue) return;
      try {
        const value = normalizeQuickAppearance(JSON.parse(event.newValue).value);
        c.library.settings.preferences = { ...prefs(), quickAppearance: value };
        apply();
      } catch {
        /* A stale or malformed local notification is not authoritative. */
      }
    });

  function settings() {
    if (!enabled) return;
    let draft = current(),
      active = true,
      pending = false,
      initializeTypography = !prefs().quickAppearance;
    editing = true;
    c.modal(
      '思绪外观',
      `<div id="quickAppearanceSettings">
      <p class="appearance-intro">只调整思绪窗口。新开的思绪窗口也会使用这些设置；主页保持原来的外观。</p>
      <label>深浅色<select class="field" id="quickTheme"><option value="inherit">跟随主页</option><option value="system">跟随系统</option><option value="light">浅色</option><option value="dark">深色</option></select></label>
      <label>壁纸来源<select class="field" id="quickBgMode"><option value="inherit">跟随主页</option><option value="custom">独立壁纸</option><option value="none">不使用壁纸</option></select></label>
      <section id="quickBgControls"><button class="secondary" id="quickBgUpload">选择／更换壁纸</button><input id="quickBgFile" type="file" accept="image/png,image/jpeg,image/webp,image/gif" hidden><small class="appearance-hint">PNG / JPG / WebP / GIF，最大 20 MiB；不会作为日记附件。</small><div id="quickBgPreview"></div>
      <label>不透明度 <output id="quickOpacityValue"></output><input id="quickOpacity" type="range" min="0" max="100" step="1"></label>
      <label>填充方式<select id="quickFill" class="field">${fills.map(([key, label]) => `<option value="${key}">${label}</option>`).join('')}</select></label>
      <label>位置<select id="quickPosition" class="field">${positions.map(([key, label]) => `<option value="${key}">${label}</option>`).join('')}</select></label>
      <label>模糊 <output id="quickBlurValue"></output><input id="quickBlur" type="range" min="0" max="20" step="1"></label></section>
      <label class="check-row"><input type="checkbox" id="quickInheritFont">字体跟随主页</label>
      <section id="quickFontControls"><label>字体<select id="quickFontFamily" class="field">${quickFontFamilies.map(([key, label]) => `<option value="${key}">${label}</option>`).join('')}</select></label>
      <div class="quick-appearance-grid">${[
        ['fontSize', '正文字号', 12, 32, 1],
        ['fontWeight', '正文字重', 300, 800, 100],
        ['lineHeight', '正文行距', 1.2, 2.5, 0.1],
        ['titleSize', '标题字号', 20, 56, 1],
        ['titleWeight', '标题字重', 300, 800, 100],
      ]
        .map(
          ([key, label, min, max, step]) =>
            `<label>${label}<input class="field" type="number" data-quick-font="${key}" min="${min}" max="${max}" step="${step}"></label>`,
        )
        .join('')}</div></section>
      <p id="quickAppearanceStatus" role="status">调整会即时预览，保存后记住。</p>
      <div class="appearance-actions"><button class="secondary" id="quickAppearanceReset">全部跟随主页</button><span></span><button class="secondary" id="quickAppearanceCancel">取消</button><button class="primary" id="quickAppearanceSave">保存设置</button></div>
    </div>`,
    );
    const dialog = $('#modal');
    dialog.classList.add('quick-appearance-dialog');
    function cleanup() {
      active = false;
      editing = false;
      dialog.classList.remove('quick-appearance-dialog');
      dialog.removeEventListener('close', cleanup);
      dialog.removeEventListener('modalreplace', cleanup);
      apply();
    }
    dialog.addEventListener('close', cleanup);
    dialog.addEventListener('modalreplace', cleanup);
    const status = (text) => {
      if (active) $('#quickAppearanceStatus').textContent = text;
    };
    function render() {
      $('#quickTheme').value = draft.theme;
      $('#quickBgMode').value = draft.backgroundMode;
      $('#quickBgControls').hidden = draft.backgroundMode !== 'custom';
      $('#quickInheritFont').checked = draft.inheritTypography;
      $('#quickFontControls').hidden = draft.inheritTypography;
      $('#quickFontFamily').value = draft.fontFamily;
      document.querySelectorAll('[data-quick-font]').forEach((input) => {
        input.value = draft[input.dataset.quickFont];
      });
      const b = draft.background;
      $('#quickBgPreview').innerHTML = b
        ? `<img src="/media/${esc(b.id)}" alt="思绪壁纸预览">`
        : '<p>选择一张图片作为思绪独立壁纸。</p>';
      $('#quickOpacity').value = Math.round((b?.opacity ?? 0.2) * 100);
      $('#quickOpacityValue').textContent = $('#quickOpacity').value + '%';
      $('#quickFill').value = b?.fill || 'cover';
      $('#quickPosition').value = b?.position || 'center';
      $('#quickBlur').value = draft.blur;
      $('#quickBlurValue').textContent = draft.blur + ' px';
      $('#quickBgUpload').disabled = pending;
      $('#quickAppearanceSave').disabled = pending || (draft.backgroundMode === 'custom' && !b);
      preview(draft);
    }
    $('#quickTheme').onchange = (event) => {
      draft.theme = event.target.value;
      preview(draft);
    };
    $('#quickBgMode').onchange = (event) => {
      draft.backgroundMode = event.target.value;
      render();
    };
    $('#quickInheritFont').onchange = (event) => {
      if (!event.target.checked && initializeTypography) {
        const p = prefs();
        draft.fontFamily = p.fontFamily || 'sans';
        draft.fontSize = p.fontSize || 16;
        draft.lineHeight = p.lineHeight || 2;
        initializeTypography = false;
      }
      draft.inheritTypography = event.target.checked;
      render();
    };
    $('#quickFontFamily').onchange = (event) => {
      draft.fontFamily = event.target.value;
      preview(draft);
    };
    document.querySelectorAll('[data-quick-font]').forEach((input) => {
      input.oninput = () => {
        if (!input.checkValidity() || input.value === '') return;
        draft[input.dataset.quickFont] = Number(input.value);
        preview(draft);
      };
    });
    for (const [id, key] of [
      ['quickFill', 'fill'],
      ['quickPosition', 'position'],
    ])
      $('#' + id).onchange = (event) => {
        if (draft.background) draft.background[key] = event.target.value;
        preview(draft);
      };
    $('#quickOpacity').oninput = (event) => {
      if (draft.background) draft.background.opacity = Number(event.target.value) / 100;
      $('#quickOpacityValue').textContent = event.target.value + '%';
      preview(draft);
    };
    $('#quickBlur').oninput = (event) => {
      draft.blur = Number(event.target.value);
      $('#quickBlurValue').textContent = draft.blur + ' px';
      preview(draft);
    };
    $('#quickBgUpload').onclick = () => $('#quickBgFile').click();
    $('#quickBgFile').onchange = async (event) => {
      const file = event.target.files[0];
      event.target.value = '';
      if (!file) return;
      if (file.size > LIMITS.backgroundBytes) return status('图片超过 20 MiB，请缩小后重试');
      pending = true;
      render();
      status('正在导入壁纸…');
      try {
        const item = await api('/api/backgrounds', {
          method: 'POST',
          raw: file,
          headers: { 'Content-Type': file.type, 'X-File-Name': encodeURIComponent(file.name) },
        });
        if (!active) return;
        draft.background = {
          region: 'app',
          opacity: 0.2,
          fill: 'cover',
          position: 'center',
          ...draft.background,
          id: item.id,
        };
        draft.backgroundMode = 'custom';
        status('壁纸已就绪，保存设置后应用。');
      } catch (error) {
        status(error.message);
      } finally {
        if (active) {
          pending = false;
          render();
        }
      }
    };
    $('#quickAppearanceCancel').onclick = c.closeModal;
    $('#quickAppearanceReset').onclick = () => {
      draft = quickAppearanceDefaults();
      render();
    };
    $('#quickAppearanceSave').onclick = async () => {
      const invalid = [...document.querySelectorAll('[data-quick-font]')].find(
        (input) => !input.checkValidity() || input.value === '',
      );
      if (!draft.inheritTypography && invalid) {
        invalid.reportValidity();
        return status('请填写范围内的字号、字重和行距');
      }
      pending = true;
      $('#quickAppearanceSave').disabled = true;
      try {
        const value = normalizeQuickAppearance(draft);
        const saved = await api('/api/preferences', {
          method: 'PUT',
          data: { quickAppearance: value },
        });
        c.library.settings.preferences = saved;
        try {
          localStorage.setItem(signalKey, JSON.stringify({ value, at: Date.now() }));
        } catch {
          /* Settings are persisted by the server even if storage is unavailable. */
        }
        if (active) c.closeModal();
        apply();
        c.toast('思绪外观已保存');
      } catch (error) {
        status(error.message);
      } finally {
        if (active) {
          pending = false;
          render();
        }
      }
    };
    render();
  }
  return { apply, settings };
}
