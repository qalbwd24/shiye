/** Low-frequency quick-window actions share one settings entry. */
export function createQuickWindowSettings(c) {
  const doc = document;
  function update(state) {
    const resumeStatus = doc.querySelector('#quickResumeStatus');
    if (state.type === 'window-settings-error') {
      if (resumeStatus) resumeStatus.textContent = state.message;
      return;
    }
    const value = doc.querySelector('#quickZoomValue');
    if (value) value.textContent = `${Math.round(state.factor * 100)}%`;
    const pin = doc.querySelector('#quickWindowPin');
    if (pin) pin.checked = !!state.topMost;
    const hours = doc.querySelector('#quickResumeHours');
    if (hours && Number.isFinite(state.resumeHours)) {
      if (hours !== doc.activeElement) hours.value = state.resumeHours;
      if (resumeStatus)
        resumeStatus.textContent =
          state.resumeHours > 0
            ? `保存并收起后 ${state.resumeHours} 小时内恢复原篇和位置；到期重新选择。`
            : '关闭后不保留后台窗口，下次重新选择。';
      const close = doc.querySelector('#quickSaveClose');
      if (close)
        close.textContent = state.resumeHours > 0 ? '保存并退到后台' : '保存并关闭当前窗口';
    }
  }
  function show() {
    c.modal(
      '思绪设置',
      `<p id="quickEditorInfo"></p><div class="quick-settings-actions">
      <button class="option-button" id="quickAddAttachment" ${c.editor?.isReadingDocument ? 'disabled' : ''}>${c.editor?.isRichDocument ? '插入图片或视频' : '添加附件'}</button>
      ${c.readingDocument && !c.editor?.isRichDocument ? '<button class="option-button" id="quickReadingDocument">' + (c.editor?.isReadingDocument ? '继续编辑原文' : '图文阅读旧日记') + '</button>' : ''}
      ${c.editor?.isRichDocument ? '<button class="option-button" id="quickImageLayout">图片排版</button><button class="option-button" id="quickInsertAttachedImage">插入已有图片</button>' : ''}
      <button class="option-button" id="quickAppearanceSettings">思绪外观与字体</button>
      <button class="option-button" id="quickCategorySettings">分类与排序</button>
      <button class="option-button" id="quickWritingSettings">编辑与记录</button>
      <button class="option-button" id="quickAllSettings">完整设置</button>
      ${
        c.native
          ? `<button class="option-button" id="quickHostSettings">热键与输入</button>
      <div class="quick-settings-zoom" aria-label="观看比例">
        <span>观看比例</span><output id="quickZoomValue">读取中…</output>
        <button class="secondary" id="quickZoomOut" aria-label="缩小 4%">−4%</button>
        <button class="secondary" id="quickZoomReset">恢复 100%</button>
        <button class="secondary" id="quickZoomIn" aria-label="放大 4%">＋4%</button>
      </div><label class="check-row"><input type="checkbox" id="quickWindowPin">窗口置顶</label>
      <div class="quick-resume-setting"><label>关闭后恢复时限（小时）<input class="field" id="quickResumeHours" type="number" min="0" max="168" step="0.25" value="5"></label><button class="secondary" id="quickResumeSave">保存时限</button><small id="quickResumeStatus" role="status">默认 5 小时；0 表示关闭后不保留。</small></div>
      <button class="option-button" id="quickNewWindow">新开独立窗口</button>`
          : ''
      }
      <button class="option-button" id="quickSaveClose">${c.native ? '保存并退到后台' : '保存并关闭当前窗口'}</button>
      ${c.native ? '<button class="option-button" id="quickDestroyWindow">彻底关闭当前窗口（不保留位置）</button>' : ''}
    </div>`,
    );
    const version = /^\d+\.\d+\.\d+$/.test(c.version || '') ? ` · ${c.version}` : '';
    const info = doc.querySelector('#quickEditorInfo');
    info.textContent = `${c.editor?.isReadingDocument ? '图文阅读：旧日记原件保留' : c.editor?.isRichDocument ? '图文正文：图片和视频插入光标位置' : '兼容正文：当前篇保持原格式'}${version}`;
    const on = (id, action) => doc.querySelector('#' + id).addEventListener('click', action);
    const leave = (action) => () => {
      c.closeModal();
      return action();
    };
    if (c.readingDocument && doc.querySelector('#quickReadingDocument'))
      on(
        'quickReadingDocument',
        leave(() =>
          c.editor?.isReadingDocument ? c.readingDocument.editOriginal() : c.readingDocument.show(),
        ),
      );
    on(
      'quickAddAttachment',
      leave(() => doc.querySelector('#mediaInput').click()),
    );
    if (c.editor?.isRichDocument) {
      on(
        'quickImageLayout',
        leave(() => c.editor.imageLayout()),
      );
      on(
        'quickInsertAttachedImage',
        leave(() => c.editor.attachedImages()),
      );
    }
    for (const [id, section] of [
      ['quickAppearanceSettings', 'quickAppearance'],
      ['quickCategorySettings', 'organization'],
      ['quickWritingSettings', 'writing'],
      ['quickAllSettings', 'general'],
    ])
      on(id, () => c.settings(section));
    on('quickSaveClose', leave(c.close));
    if (c.native) {
      on('quickResumeSave', () => {
        const hours = doc.querySelector('#quickResumeHours').valueAsNumber;
        if (!Number.isFinite(hours) || hours < 0 || hours > 168) {
          doc.querySelector('#quickResumeStatus').textContent = '请输入 0–168 小时。';
          return;
        }
        c.post('set-resume-hours', { hours });
      });
      on(
        'quickNewWindow',
        leave(() => c.post('new-window')),
      );
      on(
        'quickDestroyWindow',
        leave(() => c.post('close-permanently')),
      );
      on(
        'quickHostSettings',
        leave(() => c.post('host-settings')),
      );
      for (const [id, step] of [
        ['quickZoomOut', -1],
        ['quickZoomReset', 0],
        ['quickZoomIn', 1],
      ])
        on(id, () => c.post('zoom-step', { step }));
      doc.querySelector('#quickWindowPin').onchange = (event) =>
        c.post('set-topmost', { value: event.target.checked });
      c.post('get-window-state');
    }
  }
  return { show, update };
}
