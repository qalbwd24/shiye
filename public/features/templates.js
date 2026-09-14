/** Feature-local state; c.library is a live getter, never a cached snapshot. */
export function createTemplates(c) {
  const { $, $$, api, escape: esc, modal, closeModal, toast, sanitize, command } = c;

  function templates() {
    modal(
      '写作模板',
      `<p>模板插入当前光标，不替换已有正文。可将当前日记保存为模板，并绑定分类。</p>${(
        c.library.templates || []
      )
        .filter((t) => !t.deleted)
        .map(
          (t) =>
            `<div class="template-row"><button class="option-button" data-use-template="${t.id}">${esc(t.name)}<small>${esc(t.category || '所有分类')}</small></button><button class="secondary" data-edit-template="${t.id}">编辑</button></div>`,
        )
        .join(
          '',
        )}<button class="primary" id="saveAsTemplate">当前日记存为模板</button><button class="secondary" id="blankTemplate">新模板</button><button class="secondary" id="restoreTemplates">恢复已移除的模板</button>`,
    );
    $('#saveAsTemplate').onclick = () => editTemplate(null, c.current()?.content || '');
    $('#blankTemplate').onclick = () => editTemplate(null, '');
    $('#restoreTemplates').onclick = async () => {
      for (const t of c.library.templates.filter((t) => t.deleted))
        await api('/api/templates/' + t.id, { method: 'PUT', data: { deleted: false } });
      await c.refreshLibrary();
      templates();
    };
    $$('[data-use-template]').forEach(
      (b) =>
        (b.onclick = () => {
          const t = c.library.templates.find((t) => t.id === b.dataset.useTemplate);
          closeModal();
          command('insertHTML', sanitize(t.content));
        }),
    );
    $$('[data-edit-template]').forEach(
      (b) =>
        (b.onclick = () =>
          editTemplate(c.library.templates.find((t) => t.id === b.dataset.editTemplate))),
    );
  }
  function editTemplate(t, content = '') {
    modal(
      t ? '编辑模板' : '新模板',
      `<label>名称<input class="field" id="templateName" value="${esc(t?.name || '')}"></label><label>绑定分类<select class="field" id="templateCategory"><option value="">不自动套用</option>${c.library.categories.map((c) => `<option>${esc(c)}</option>`).join('')}</select></label><label>正文（HTML 或普通文本）<textarea class="field" id="templateContent" rows="8">${esc(t?.content || content)}</textarea></label><button class="primary" id="saveTemplate">保存</button>${t ? '<button class="secondary" id="deleteTemplate">移到模板回收站</button>' : ''}`,
    );
    $('#templateCategory').value = t?.category || '';
    $('#saveTemplate').onclick = async () => {
      try {
        await api('/api/templates' + (t ? '/' + t.id : ''), {
          method: t ? 'PUT' : 'POST',
          data: {
            name: $('#templateName').value,
            category: $('#templateCategory').value,
            content: sanitize($('#templateContent').value),
          },
        });
        await c.refreshLibrary();
        templates();
      } catch (e) {
        toast(e.message);
      }
    };
    if (t)
      $('#deleteTemplate').onclick = async () => {
        await api('/api/templates/' + t.id, { method: 'PUT', data: { deleted: true } });
        await c.refreshLibrary();
        templates();
      };
  }

  return { templates };
}
