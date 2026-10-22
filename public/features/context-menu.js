import { createEntryActions } from './entry-actions.js';
import { sortedTaxonomy } from '../shared/taxonomy.js';

/** Owns menu DOM, keyboard navigation and prompts; business writes stay in entry-actions. */
export function createContextMenu(c, { exportMenu }) {
  const { $, escape: esc, modal, closeModal, toast } = c;
  const actions = createEntryActions(c);
  const menu = document.createElement('div');
  menu.id = 'contextMenu';
  menu.className = 'context-menu';
  menu.hidden = true;
  menu.setAttribute('role', 'menu');
  menu.setAttribute('aria-label', '快捷操作');
  document.body.append(menu);
  let items = [],
    anchor = null;
  function hide(restoreFocus = false) {
    menu.hidden = true;
    if (restoreFocus && anchor?.isConnected) anchor.focus();
    items = [];
  }
  function show(x, y, options, element) {
    items = options;
    anchor = element;
    menu.innerHTML = options
      .map(
        (item, i) =>
          `<button role="menuitem" type="button" data-menu-index="${i}" class="${item.danger ? 'danger' : ''}">${esc(item.label)}</button>`,
      )
      .join('');
    menu.hidden = false;
    const rect = menu.getBoundingClientRect();
    menu.style.left = Math.max(8, Math.min(x, innerWidth - rect.width - 8)) + 'px';
    menu.style.top = Math.max(8, Math.min(y, innerHeight - rect.height - 8)) + 'px';
    menu.querySelector('button')?.focus();
  }
  function prompt(title, html, submit, danger = false) {
    modal(
      title,
      `${html}<p id="actionStatus" role="status"></p><div class="appearance-actions"><button id="actionCancel" class="secondary">取消</button><button id="actionSubmit" class="${danger ? 'danger' : 'primary'}">${danger ? '确认移除' : '保存'}</button></div>`,
    );
    $('#actionCancel').onclick = closeModal;
    $('#actionSubmit').onclick = async () => {
      const button = $('#actionSubmit');
      button.disabled = true;
      try {
        await submit();
        closeModal();
      } catch (e) {
        $('#actionStatus').textContent = e.message;
        button.disabled = false;
      }
    };
    $('#actionValue')?.focus();
    $('#actionValue')?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.isComposing) {
        e.preventDefault();
        $('#actionSubmit').click();
      }
    });
  }
  function taxPrompt(kind, action, name = '') {
    const label = kind === 'category' ? '分类' : '标签';
    if (action === 'remove')
      return prompt(
        '移除' + label,
        `<p>移除“${esc(name)}”${kind === 'category' ? '后，日记归入“未分类”' : '，仅解除它与日记的关联'}。日记正文和媒体仍保留。</p>`,
        async () => {
          await actions.taxonomy(kind, action, name);
          await c.filterView();
        },
        true,
      );
    prompt(
      (action === 'create' ? '新建' : '重命名／合并') + label,
      `<label>${label}名称<input id="actionValue" class="field" maxlength="60" value="${esc(name)}"></label>${action === 'rename' ? '<p>若名称已存在，将合并到同名项目。</p>' : ''}`,
      async () => {
        const value = $('#actionValue').value.trim();
        if (!value) throw Error('请输入名称');
        await actions.taxonomy(kind, action, name, value);
        await c.filterView({ [kind]: value });
      },
    );
  }
  function taxItems(kind, name) {
    const label = kind === 'category' ? '分类' : '标签';
    return [
      { label: '只看此' + label, run: () => c.filterView({ [kind]: name }) },
      {
        label: '在此' + label + '下新建日记',
        run: () =>
          c.newEntry(new Date(), {
            [kind === 'tag' ? 'tags' : 'category']: kind === 'tag' ? [name] : name,
          }),
      },
      { label: '新建' + label, run: () => taxPrompt(kind, 'create') },
      { label: '重命名／合并' + label, run: () => taxPrompt(kind, 'rename', name) },
      { label: '移除' + label, run: () => taxPrompt(kind, 'remove', name), danger: true },
    ];
  }
  function entryItems(entry) {
    const id = entry.id;
    const result = [
      { label: '打开日记', run: () => c.selectEntry(id) },
      {
        label: '重命名日记',
        run: () =>
          prompt(
            '重命名日记',
            `<label>标题<input class="field" id="actionValue" value="${esc(entry.title)}" maxlength="200"></label>`,
            () => actions.update(id, () => ({ title: $('#actionValue').value })),
          ),
      },
      {
        label: entry.pinned ? '取消置顶' : '置顶日记',
        run: () => actions.update(id, (e) => ({ pinned: !e.pinned })),
      },
      {
        label: '修改分类与标签',
        run: () =>
          prompt(
            '修改分类与标签',
            `<label>分类<input class="field" id="actionCategory" list="actionCategories" value="${esc(entry.category)}" maxlength="60"></label><datalist id="actionCategories">${sortedTaxonomy(
              c.library,
              'category',
            )
              .map((item) => `<option value="${esc(item.name)}"></option>`)
              .join(
                '',
              )}</datalist><label>标签（逗号分隔）<input id="actionValue" class="field" value="${esc(entry.tags.join('，'))}"></label>`,
            () =>
              actions.update(id, () => ({
                category: $('#actionCategory').value.trim() || '未分类',
                tags: [
                  ...new Set(
                    $('#actionValue')
                      .value.split(/[,，]/)
                      .map((v) => v.trim())
                      .filter(Boolean),
                  ),
                ],
              })),
          ),
      },
      { label: '复制为新日记', run: () => actions.duplicate(id) },
      { label: '导出日记…', run: () => exportMenu(id) },
      {
        label: entry.deleted ? '从回收站恢复' : '移入回收站',
        danger: !entry.deleted,
        run: () => actions.update(id, (e) => ({ deleted: !e.deleted })),
      },
    ];
    return entry.deleted ? result.filter((_, i) => [0, 5, 6].includes(i)) : result;
  }
  function openFor(target, x, y) {
    if (
      $('#modal').open ||
      !(target instanceof Element) ||
      target.closest('input, textarea, [contenteditable="true"]')
    )
      return false;
    const entryEl = target.closest('[data-entry]'),
      cat = target.closest('[data-category]'),
      tag = target.closest('[data-tag]');
    let options, element;
    if (entryEl) {
      const e = c.library.entries.find((e) => e.id === entryEl.dataset.entry);
      if (!e) return false;
      options = entryItems(e);
      element = entryEl;
    } else if (cat || tag) {
      element = cat || tag;
      options = taxItems(cat ? 'category' : 'tag', cat ? cat.dataset.category : tag.dataset.tag);
    } else if (target.closest('#section-categories-head, #categories')) {
      options = [{ label: '新建分类', run: () => taxPrompt('category', 'create') }];
    } else if (target.closest('#section-tags-head, #tagCloud')) {
      options = [{ label: '新建标签', run: () => taxPrompt('tag', 'create') }];
    } else if (target.closest('#entryPanel')) {
      options = [{ label: '新建日记', run: () => c.newEntry() }];
    } else return false;
    show(x, y, options, element || target);
    return true;
  }
  menu.onclick = async (e) => {
    const button = e.target.closest('[data-menu-index]');
    if (!button) return;
    const item = items[Number(button.dataset.menuIndex)]; // Capture before hide clears menu state.
    hide();
    try {
      await item.run();
    } catch (err) {
      toast(err.message);
    }
  };
  document.addEventListener('contextmenu', (e) => {
    if (openFor(e.target, e.clientX, e.clientY)) e.preventDefault();
    else hide();
  });
  document.addEventListener('pointerdown', (e) => {
    if (!menu.contains(e.target)) hide();
  });
  document.addEventListener(
    'keydown',
    (e) => {
      if (!menu.hidden) {
        const buttons = [...menu.querySelectorAll('button')];
        const index = buttons.indexOf(document.activeElement);
        if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key)) {
          e.preventDefault();
          e.stopImmediatePropagation();
          const next =
            e.key === 'Home'
              ? 0
              : e.key === 'End'
                ? buttons.length - 1
                : (index + (e.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length;
          buttons[next].focus();
        } else if (e.key === 'Escape' || e.key === 'Tab') {
          hide(true);
          if (e.key === 'Escape') {
            e.preventDefault();
            e.stopImmediatePropagation();
          }
        }
      } else if (e.key === 'ContextMenu' || (e.shiftKey && e.key === 'F10')) {
        const rect = e.target.getBoundingClientRect();
        if (openFor(e.target, rect.left, rect.bottom)) e.preventDefault();
      }
    },
    true,
  );
  window.addEventListener('blur', () => hide());
  window.addEventListener('resize', () => hide());
  document.addEventListener(
    'scroll',
    (e) => {
      if (!menu.contains(e.target)) hide();
    },
    true,
  );
  $('#addCategory').onclick = () => taxPrompt('category', 'create');
  $('#addTag').onclick = () => taxPrompt('tag', 'create');
  return { hide };
}
