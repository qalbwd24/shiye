import { uploadMediaFile } from '../core/api.js';
import { compressUpload } from '../core/media-compression.js';
import { normalizeAvatarCrop, avatarStyle } from '../shared/profile.js';

/** Settings hub composes existing feature dialogs without cloning fields or event handlers. */
export function createWorkbench(c, actions) {
  const { $, $$ } = c;
  const profileValue = () => ({
    authorName: '我',
    motto: '把日子，收藏起来',
    authorAvatarId: null,
    authorAvatarCrop: normalizeAvatarCrop(),
    ...c.library.settings?.preferences?.profile,
  });
  function renderAvatar(host, profile) {
    const name = profile.authorName || '我';
    const media = c.library.media?.find(
      (item) => item.id === profile.authorAvatarId && item.type?.startsWith('image/'),
    );
    host.replaceChildren();
    if (!media) {
      host.textContent = Array.from(name)[0];
      return;
    }
    const image = document.createElement('img');
    image.src = '/media/' + encodeURIComponent(media.id);
    image.alt = name;
    image.draggable = false;
    image.style.cssText = avatarStyle(profile.authorAvatarCrop);
    image.onerror = () => {
      if (image.isConnected) host.textContent = Array.from(name)[0];
    };
    host.append(image);
  }
  function applyProfile() {
    const profile = profileValue();
    $('#profileBrandName').textContent = profile.authorName || '我';
    $('#profileBrandMotto').textContent = profile.motto ?? '把日子，收藏起来';
    $('#profileBrandMotto').hidden = !profile.motto;
    $('#profileButton').title = '编辑个人资料';
    renderAvatar($('#profileBrandAvatar'), profile);
  }
  function profilePage() {
    const draft = structuredClone(profileValue());
    try {
      draft.authorAvatarCrop = normalizeAvatarCrop(draft.authorAvatarCrop);
    } catch {
      draft.authorAvatarCrop = normalizeAvatarCrop();
    }
    let active = true,
      uploading = false;
    c.modal(
      '个人资料',
      `<div class="profile-form"><div class="profile-avatar-editor"><div id="profileAvatarPreview" class="profile-avatar-preview" aria-label="头像预览，可拖动调整位置"></div><div><button class="secondary" id="profileChooseAvatar">选择头像</button><button class="secondary" id="profileClearAvatar">清除头像</button><p>支持 GIF 动图。拖动预览调整位置，动画和原图保持完整。</p></div></div><input id="profileAvatarFile" type="file" accept="image/png,image/jpeg,image/webp,image/gif,image/avif" hidden><div class="profile-crop-controls"><label>水平位置<input id="profileCropX" type="range" min="0" max="100" step="1"></label><label>垂直位置<input id="profileCropY" type="range" min="0" max="100" step="1"></label><label>缩放<input id="profileCropZoom" type="range" min="1" max="3" step="0.05"></label><button class="secondary" id="profileCropReset">重置显示范围</button></div><label>用户名<input class="field" id="profileName" maxlength="80" placeholder="我"></label><label>座右铭<textarea class="field" id="profileMotto" maxlength="200" rows="2" placeholder="把日子，收藏起来"></textarea></label><p id="profileStatus" role="status"></p><div class="settings-save-row"><button class="secondary" id="profileCancel">取消</button><button class="primary" id="profileSave">保存资料</button></div></div>`,
    );
    $('#profileName').value = draft.authorName;
    $('#profileMotto').value = draft.motto;
    const dialog = $('#modal');
    const cleanup = () => {
      active = false;
      dialog.removeEventListener('close', cleanup);
      dialog.removeEventListener('modalreplace', cleanup);
    };
    dialog.addEventListener('close', cleanup);
    dialog.addEventListener('modalreplace', cleanup);
    function preview(rebuild = false) {
      const host = $('#profileAvatarPreview');
      if (rebuild || !host.querySelector('img')) renderAvatar(host, draft);
      else host.querySelector('img').style.cssText = avatarStyle(draft.authorAvatarCrop);
      for (const [id, key] of [
        ['profileCropX', 'x'],
        ['profileCropY', 'y'],
        ['profileCropZoom', 'zoom'],
      ]) {
        $('#' + id).value = draft.authorAvatarCrop[key];
        $('#' + id).disabled = !draft.authorAvatarId;
      }
      $('#profileClearAvatar').disabled = !draft.authorAvatarId || uploading;
    }
    for (const [id, key] of [
      ['profileCropX', 'x'],
      ['profileCropY', 'y'],
      ['profileCropZoom', 'zoom'],
    ])
      $('#' + id).oninput = () => {
        draft.authorAvatarCrop[key] = Number($('#' + id).value);
        preview();
      };
    $('#profileAvatarPreview').onpointerdown = (event) => {
      if (!draft.authorAvatarId || event.button !== 0) return;
      event.preventDefault();
      const host = event.currentTarget,
        crop = { ...draft.authorAvatarCrop },
        start = { x: event.clientX, y: event.clientY };
      host.setPointerCapture(event.pointerId);
      const move = (e) => {
        draft.authorAvatarCrop.x = Math.max(
          0,
          Math.min(100, crop.x - ((e.clientX - start.x) / host.clientWidth) * 100),
        );
        draft.authorAvatarCrop.y = Math.max(
          0,
          Math.min(100, crop.y - ((e.clientY - start.y) / host.clientHeight) * 100),
        );
        preview();
      };
      const finish = () => {
        host.removeEventListener('pointermove', move);
        host.removeEventListener('pointerup', finish);
        host.removeEventListener('pointercancel', finish);
      };
      host.addEventListener('pointermove', move);
      host.addEventListener('pointerup', finish);
      host.addEventListener('pointercancel', finish);
    };
    $('#profileCropReset').onclick = () => {
      draft.authorAvatarCrop = normalizeAvatarCrop();
      preview();
    };
    $('#profileChooseAvatar').onclick = () => $('#profileAvatarFile').click();
    $('#profileClearAvatar').onclick = () => {
      draft.authorAvatarId = null;
      draft.authorAvatarCrop = normalizeAvatarCrop();
      preview(true);
    };
    $('#profileName').oninput = () => {
      draft.authorName = $('#profileName').value || '我';
      if (!draft.authorAvatarId) preview(true);
    };
    $('#profileAvatarFile').onchange = async (event) => {
      const file = event.target.files?.[0];
      event.target.value = '';
      if (!file) return;
      if (
        !['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/avif'].includes(file.type) ||
        file.size > 20 * 1024 * 1024
      ) {
        $('#profileStatus').textContent = '请选择 20 MB 以内的 PNG、JPEG、WebP、GIF 或 AVIF 图片';
        return;
      }
      uploading = true;
      $('#profileSave').disabled = true;
      $('#profileChooseAvatar').disabled = true;
      $('#profileStatus').textContent = '正在准备头像…';
      try {
        const processed = await compressUpload(file, { quality: 'balanced' });
        const media = await uploadMediaFile(processed.file, () => {}, {
          ...processed,
          compression: processed.changed ? 'image-canvas' : null,
        });
        if (!c.library.media.some((item) => item.id === media.id)) c.library.media.push(media);
        if (!active) return;
        draft.authorAvatarId = media.id;
        draft.authorAvatarCrop = normalizeAvatarCrop();
        preview(true);
        $('#profileStatus').textContent = '头像已就绪，保存资料后生效。';
      } catch (error) {
        if (active) $('#profileStatus').textContent = error.message;
      } finally {
        uploading = false;
        if (active) {
          $('#profileSave').disabled = false;
          $('#profileChooseAvatar').disabled = false;
          preview();
        }
      }
    };
    $('#profileCancel').onclick = c.closeModal;
    $('#profileSave').onclick = async () => {
      if (uploading) return;
      const authorName = $('#profileName').value.trim();
      if (!authorName) {
        $('#profileStatus').textContent = '请填写用户名';
        return;
      }
      $('#profileSave').disabled = true;
      try {
        const profile = {
          authorName,
          motto: $('#profileMotto').value.trim(),
          authorAvatarId: draft.authorAvatarId,
          authorAvatarCrop: normalizeAvatarCrop(draft.authorAvatarCrop),
        };
        c.library.settings.preferences = await c.api('/api/preferences', {
          method: 'PUT',
          data: { profile },
        });
        applyProfile();
        document.dispatchEvent(new Event('shiye:profile-change'));
        if (active) c.closeModal();
        c.toast('个人资料已保存');
      } catch (error) {
        if (active) {
          $('#profileStatus').textContent = error.message;
          $('#profileSave').disabled = false;
        }
      }
    };
    preview(true);
  }
  let finishing = null;
  function applyInline(enabled, target = $('#bodyEditor')) {
    const top = target.getBoundingClientRect().top;
    const scroller = [$('.writing-scroll'), $('#entryColumns')].find(
      (pane) =>
        pane.clientHeight > 0 && ['auto', 'scroll'].includes(getComputedStyle(pane).overflowY),
    );
    $('#editorPanel').classList.toggle('inline-editing', enabled);
    document.body.classList.remove('writing-mode', 'focus-mode');
    $('#focusButton').classList.toggle('active', enabled);
    $('#writingModeButton').hidden = !enabled;
    $('#writingModeButton').textContent = '完成编辑';
    $('#writingModeButton').setAttribute('aria-pressed', String(enabled));
    $('#writingModeButton').title = '保存并更新图片展示';
    // The toolbar adds height above the body; keep the clicked text at its screen position.
    if (scroller) scroller.scrollTop += target.getBoundingClientRect().top - top;
  }
  function beginInline(target = $('#bodyEditor')) {
    if ($('#editorPanel').classList.contains('inline-editing')) return;
    applyInline(true, target);
    actions.beginEditing?.();
  }
  function finishInline() {
    if (finishing) return finishing;
    if (!$('#editorPanel').classList.contains('inline-editing')) return Promise.resolve();
    $('#writingModeButton').disabled = true;
    finishing = (async () => {
      try {
        await c.flush();
        applyInline(false);
        await actions.completeEditing?.();
      } finally {
        $('#writingModeButton').disabled = false;
        finishing = null;
      }
    })();
    return finishing;
  }
  function toggleWriting() {
    if ($('#editorPanel').classList.contains('inline-editing')) return finishInline();
    beginInline();
    if (c.editor) c.editor.focus();
    else $('#bodyEditor').focus({ preventScroll: true });
    return Promise.resolve();
  }
  $('#writingModeButton').hidden = true;
  $('#writingModeButton').onclick = () => finishInline().catch((error) => c.toast(error.message));
  for (const id of ['bodyEditor', 'entryTitle'])
    $('#' + id).addEventListener('focusin', (event) => beginInline(event.currentTarget));
  document.body.classList.remove('writing-mode', 'focus-mode');
  document.addEventListener('shiye:read-mode', () =>
    finishInline().catch((error) => c.toast(error.message)),
  );
  let generation = 0;
  const sections = [
    ['profile', '个人资料', '你的头像、名字和喜欢的一句话'],
    ['general', '常规', '打开方式、日历与日记列表'],
    ['writing', '编辑与记录', '文字排版、提醒和书写习惯'],
    ['layout', '工作区布局', '按你的屏幕安排导航、正文与媒体'],
    ['appearance', '外观与背景', '主题色、明暗模式和分区背景'],
    ['organization', '分类与标签', '整理内容，保留每一篇记录'],
    ['data', '数据与备份', '导入、备份、导出和冲突处理'],
    ['stickers', '表情包', '收藏常用图片与动态表情'],
    ['privacy', '隐私与锁定', '本地访问锁和自动锁定'],
    ['shortcuts', '快捷键', '为常用操作设置顺手的按键'],
    ['help', '帮助与关于', '使用说明与本地存储信息'],
  ];
  function wrap(section) {
    const dialog = $('#modal'),
      body = $('#modalBody');
    const content = document.createElement('section');
    content.className = 'settings-content';
    content.setAttribute('aria-label', sections.find(([id]) => id === section)[1]);
    const heading = document.createElement('h3');
    heading.textContent = sections.find(([id]) => id === section)[1];
    const subtitle = document.createElement('p');
    subtitle.className = 'settings-intro';
    subtitle.textContent = sections.find(([id]) => id === section)[2];
    content.append(heading, subtitle, ...body.childNodes);
    const nav = document.createElement('nav');
    nav.className = 'settings-nav';
    nav.setAttribute('aria-label', '设置分区');
    for (const [id, name] of sections) {
      const button = document.createElement('button');
      button.textContent = name;
      button.type = 'button';
      button.classList.toggle('active', id === section);
      if (id === section) button.setAttribute('aria-current', 'page');
      button.onclick = () => open(id);
      nav.append(button);
    }
    body.replaceChildren(nav, content);
    $('#modalTitle').textContent = '设置';
    dialog.classList.add('settings-dialog');
    const cleanup = () => {
      dialog.classList.remove('settings-dialog');
      dialog.removeEventListener('close', cleanup);
      dialog.removeEventListener('modalreplace', cleanup);
    };
    dialog.addEventListener('close', cleanup);
    dialog.addEventListener('modalreplace', cleanup);
    content.scrollTop = 0;
    nav.querySelector('.active').focus({ preventScroll: true });
  }
  function options(title, items) {
    c.modal(title, '<div class="settings-options"></div>');
    for (const [name, detail, fn] of items) {
      const button = document.createElement('button');
      button.className = 'option-button';
      const small = document.createElement('small');
      small.textContent = detail;
      button.append(name, small);
      button.onclick = () =>
        Promise.resolve()
          .then(fn)
          .catch((e) => c.toast(e.message));
      $('.settings-options').append(button);
    }
  }
  function mediaQualitySettings() {
    const section = document.createElement('section');
    section.className = 'media-quality-settings';
    section.innerHTML =
      '<label for="mediaQualityPreference">新增媒体的画质与大小</label><select class="field" id="mediaQualityPreference"><option value="balanced">均衡 · 推荐</option><option value="high">清晰 · 保留更多细节</option><option value="original">原件 · 不压缩</option></select><p>支持压缩的新增媒体按此偏好处理；已有附件不会自动重新压缩。此选择保存在当前浏览器。</p><small id="mediaQualityStatus" role="status"></small>';
    $('.settings-options').before(section);
    let quality = 'balanced';
    try {
      const saved = localStorage.getItem('shiye.media-quality');
      if (['original', 'balanced', 'high'].includes(saved)) quality = saved;
    } catch {
      /* Browser storage may be unavailable; the default remains usable. */
    }
    $('#mediaQualityPreference').value = quality;
    $('#mediaQualityPreference').onchange = () => {
      try {
        localStorage.setItem('shiye.media-quality', $('#mediaQualityPreference').value);
        $('#mediaQualityStatus').textContent = '已保存，将用于之后添加的媒体。';
      } catch {
        $('#mediaQualityStatus').textContent = '浏览器未能保存偏好，请检查是否允许本地存储。';
      }
    };
  }
  function layoutPage() {
    const state = actions.layout.read();
    c.modal(
      '工作区布局',
      `<div class="layout-preview" aria-hidden="true"><span>导航</span><span>列表</span><strong>正文</strong><span>图片与评论</span></div>
      <div class="settings-form"><label>媒体位置<select class="field" id="layoutMediaPosition"><option value="right">正文右侧</option><option value="left">正文左侧</option><option value="bottom">正文下方</option></select></label>
      <label>媒体面板宽度 <output id="layoutMediaValue"></output><input id="layoutMediaWidth" type="range" min="240" max="680" step="10"></label>
      <label>日记列表宽度 <output id="layoutListValue"></output><input id="layoutListWidth" type="range" min="220" max="440" step="10"></label>
      ${[
        ['sidebar', '显示导航栏'],
        ['list', '显示日记列表'],
        ['media', '显示媒体面板'],
      ]
        .map(
          ([key, name]) =>
            `<label class="check-row"><input type="checkbox" data-layout-panel="${key}" ${state[key] ? '' : 'checked'}>${name}</label>`,
        )
        .join('')}</div>
      <p>页边的「导航」「列表」「图评」可以单独收起或展开面板。拖动正文与媒体之间的分隔线调整宽度，松手自动记住；空间不足时自动上下排列。点击正文可就地编辑，面板位置保持不变。</p><div class="settings-save-row"><button class="secondary" id="layoutReset">恢复默认布局</button><button class="primary" id="layoutSave">保存布局</button></div><p id="layoutStatus" role="status"></p>`,
    );
    $('#layoutMediaPosition').value = state.mediaPosition;
    for (const [id, value, output] of [
      ['layoutMediaWidth', state.mediaWidth, 'layoutMediaValue'],
      ['layoutListWidth', state.listWidth, 'layoutListValue'],
    ]) {
      $('#' + id).value = value;
      $('#' + output).textContent = value + ' px';
      $('#' + id).oninput = () => ($('#' + output).textContent = $('#' + id).value + ' px');
    }
    async function save(value) {
      $('#layoutSave').disabled = true;
      try {
        await actions.layout.set(value);
        c.closeModal();
        c.toast('布局已保存');
      } catch (e) {
        if ($('#layoutStatus')) $('#layoutStatus').textContent = e.message;
        if ($('#layoutSave')) $('#layoutSave').disabled = false;
      }
    }
    $('#layoutSave').onclick = () =>
      save({
        mediaPosition: $('#layoutMediaPosition').value,
        mediaWidth: Number($('#layoutMediaWidth').value),
        listWidth: Number($('#layoutListWidth').value),
        ...Object.fromEntries(
          $$('[data-layout-panel]').map((el) => [el.dataset.layoutPanel, !el.checked]),
        ),
      });
    $('#layoutReset').onclick = () =>
      save({
        sidebar: false,
        list: false,
        media: false,
        categories: false,
        tags: false,
        mediaPosition: 'right',
        mediaWidth: 340,
        listWidth: 280,
      });
  }
  async function open(section = 'general') {
    const turn = ++generation;
    try {
      if (['general', 'writing', 'privacy'].includes(section)) {
        await actions.preferences();
        if (turn !== generation) return;
        const fields = {
          general: ['prefSort', 'prefPreview', 'prefOpen', 'prefWeek'],
          writing: [
            'prefSize',
            'prefLine',
            'prefFont',
            'prefYesterday',
            'prefIndent',
            'prefReminderText',
            'prefReminder',
          ],
          privacy: ['prefLock'],
        };
        for (const label of $$('#modalBody > label'))
          label.hidden = !fields[section].some((id) => label.querySelector('#' + id));
        $('#setupLock').hidden = section !== 'privacy';
        for (const p of $$('#modalBody > p')) p.hidden = section !== 'privacy';
        if (section === 'privacy') {
          const lockButton = document.createElement('button');
          lockButton.className = 'secondary';
          lockButton.textContent = '立即锁定';
          lockButton.onclick = () => actions.lock().catch((e) => c.toast(e.message));
          $('#modalBody').append(lockButton);
        }
      } else if (section === 'profile') profilePage();
      else if (section === 'stickers') {
        c.closeModal();
        await actions.stickers();
        return;
      } else if (section === 'appearance') actions.appearance();
      else if (section === 'layout') layoutPage();
      else if (section === 'shortcuts') $('#shortcutSettings').click();
      else if (section === 'help')
        options('帮助与关于', [
          ['使用帮助', '查看写作、媒体、快捷键和保存说明', () => $('#helpButton').click()],
          ['本地日记库', '查看存储位置与本地服务信息', () => $('#cloudStatus').click()],
        ]);
      else if (section === 'organization')
        options('分类与标签', [
          [
            '分类与标签管理',
            '排序、重命名、合并与批量整理',
            () => {
              c.closeModal();
              actions.manage();
            },
          ],
          [
            '回收站',
            '查看和恢复已删除的日记',
            () => {
              c.closeModal();
              c.changeView('trash');
            },
          ],
        ]);
      else if (section === 'data') {
        options('数据与备份', [
          ['完整备份与恢复', '包含正文、媒体与设置的加密备份', actions.backups],
          ['导入与原件归档', '导入旧格式备份，查看保留的原件', () => $('#exportLibrary').click()],
          [
            '重复与冲突管理',
            '逐项核对差异后决定保留方式',
            () => {
              c.closeModal();
              actions.conflicts();
            },
          ],
          ['导出日记', '导出可阅读或继续处理的日记文件', actions.exportMenu],
        ]);
        mediaQualitySettings();
      }
      if (turn === generation && $('#modal').open) wrap(section);
    } catch (e) {
      c.toast(e.message);
    }
  }
  $('#settingsButton').onclick = () => open();
  $('#profileButton').onclick = () => open('profile');
  $('.bottom-actions').hidden = true;
  $('#cloudStatus').hidden = true;
  $('#focusButton').hidden = true;
  $('#modal').addEventListener('close', () => {
    generation++;
  });
  return {
    settings: open,
    profile: () => open('profile'),
    applyProfile,
    toggleWriting,
    readingMode: finishInline,
  };
}
