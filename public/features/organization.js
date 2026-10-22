import { sortedTaxonomy } from '../shared/taxonomy.js';
import { installDragSort } from '../core/drag-sort.js';
/** Workspace UI only; sorting and mutation rules have independent modules. */
export function createOrganization(c) {
  const { $, api, escape: esc, toast } = c;
  let kind = 'category',
    search = '',
    selected = null,
    busy = false,
    disposeSort = () => {};
  const label = () => (kind === 'category' ? '分类' : '标签');
  const manage = () => c.changeView('organization');
  async function mutate(action) {
    if (busy) return;
    busy = true;
    $('#taxonomyWorkspace').inert = true;
    try {
      await c.withLibraryMutation(async () => {
        await action();
        await c.refreshLibrary();
      });
      c.renderView();
    } catch (e) {
      toast(e.message);
    } finally {
      busy = false;
      if ($('#taxonomyWorkspace')) $('#taxonomyWorkspace').inert = false;
    }
  }
  function render(view, root) {
    if (view !== 'organization') {
      disposeSort();
      return false;
    }
    const scrollTop = $('#taxRows')?.scrollTop || 0;
    const outerScroll = root.scrollTop;
    disposeSort();
    const items = sortedTaxonomy(c.library, kind);
    const defaultCategory = c.library.settings?.preferences?.defaultCategory;
    if (selected && !items.some((i) => i.name === selected)) selected = null;
    root.innerHTML = `<section id="taxonomyWorkspace" class="taxonomy-workspace">
      <div class="alt-heading taxonomy-heading"><div><h2>分类与标签</h2><p>设置 → 分类与排序 → 分类与标签管理</p></div><div class="taxonomy-heading-actions"><button class="primary" id="taxNew">新建${label()}</button><button class="secondary" id="taxExit">返回日记</button></div></div>
      <div class="filter-row"><select id="taxKind" aria-label="管理类型"><option value="category">分类</option><option value="tag">标签</option></select><input class="field" id="taxSearch" placeholder="搜索名称" aria-label="搜索分类或标签" value="${esc(search)}"><select id="taxSort" aria-label="排列方式"><option value="manual">手动顺序</option><option value="name">按名称</option><option value="count">按日记篇数</option></select></div>
      <div class="taxonomy-columns"><div><p class="taxonomy-hint">拖动靠近列表上下边缘可自动滚动；也可点 ↑ ↓ 或按 Alt 加方向键，顺序自动保存。篇数排除隐藏、草稿和回收站。</p><div id="taxRows" tabindex="0" aria-label="分类与标签列表"></div></div><section class="taxonomy-detail" id="taxDetail" aria-label="管理详情"></section></div>
    </section>`;
    const exit = () => {
      if (busy) return;
      disposeSort();
      Promise.resolve(c.returnToEditor ? c.returnToEditor() : c.changeView('all')).catch((error) =>
        toast(error.message),
      );
    };
    $('#taxExit').onclick = exit;
    $('#taxonomyWorkspace').onkeydown = (event) => {
      if (
        event.key !== 'Escape' ||
        event.defaultPrevented ||
        event.isComposing ||
        event.keyCode === 229 ||
        event.target.closest('input,textarea,select') ||
        document.querySelector('dialog[open]')
      )
        return;
      event.preventDefault();
      exit();
    };
    $('#taxKind').value = kind;
    $('#taxSort').value = c.library.settings?.preferences?.[kind + 'Sort'] || 'manual';
    $('#taxKind').onchange = () => {
      kind = $('#taxKind').value;
      selected = null;
      search = '';
      render(view, root);
    };
    $('#taxSearch').oninput = () => {
      search = $('#taxSearch').value;
      rows();
    };
    $('#taxSort').onchange = () => {
      const value = $('#taxSort').value;
      mutate(() => api('/api/preferences', { method: 'PUT', data: { [kind + 'Sort']: value } }));
    };
    $('#taxNew').onclick = () => {
      selected = null;
      detail(true);
      $('#taxName').focus();
    };
    function rows() {
      const rowScroll = $('#taxRows').scrollTop;
      $('#taxRows').innerHTML =
        items
          .filter((i) => i.name.toLocaleLowerCase().includes(search.toLocaleLowerCase()))
          .map((i) => {
            const index = items.indexOf(i);
            return `<div class="taxonomy-row ${selected === i.name ? 'selected' : ''}" data-sort-name="${esc(i.name)}" draggable="true"><button class="gallery-drag-handle" data-sort-handle draggable="true" aria-label="拖动${esc(i.name)}调整顺序，或按 Alt 加方向键">⠿</button><button class="taxonomy-select" data-tax-index="${index}"><strong>${esc(i.name)}</strong><small>${i.count} 篇${kind === 'category' && i.name === defaultCategory ? ' · 默认' : ''}</small></button><button class="secondary" data-sort-step="-1" aria-label="上移${esc(i.name)}" ${index === 0 ? 'disabled' : ''}>↑</button><button class="secondary" data-sort-step="1" aria-label="下移${esc(i.name)}" ${index === items.length - 1 ? 'disabled' : ''}>↓</button></div>`;
          })
          .join('') || '<p class="empty">没有匹配的名称。</p>';
      $('#taxRows').onclick = (event) => {
        const select = event.target.closest('[data-tax-index]');
        if (select) {
          selected = items[Number(select.dataset.taxIndex)].name;
          rows();
          detail();
        }
      };
      disposeSort();
      disposeSort = installDragSort($('#taxRows'), {
        itemSelector: '[data-sort-name]',
        getId: (node) => node.dataset.sortName,
        getOrder: () => items.map((item) => item.name),
        label: label(),
        onReorder: async (order, name) => {
          selected = name;
          await mutate(() => api('/api/taxonomy/order', { method: 'PUT', data: { kind, order } }));
          Array.from($('#taxRows')?.querySelectorAll('[data-sort-name]') || [])
            .find((node) => node.dataset.sortName === name)
            ?.querySelector('[data-sort-handle]')
            ?.focus({ preventScroll: true });
          Array.from($('#taxRows')?.querySelectorAll('[data-sort-name]') || [])
            .find((node) => node.dataset.sortName === name)
            ?.scrollIntoView({ block: 'nearest' });
        },
        onError: (error) => toast(error.message),
      });
      $('#taxRows').scrollTop = rowScroll;
    }
    function detail(create = false) {
      const item = items.find((i) => i.name === selected);
      if (!item && !create) {
        $('#taxDetail').innerHTML =
          '<h3>选择一项开始管理</h3><p>可查看日记、重命名、合并或移除，也可以创建暂未使用的分类和标签。</p>';
        return;
      }
      $('#taxDetail').innerHTML =
        `<h3>${create ? '新建' + label() : esc(item.name)}</h3>${item ? `<p>共关联 ${item.total} 篇（包括隐藏、草稿与回收站）。</p><button class="secondary" id="taxBrowse">查看可见日记</button>` : ''}<label>名称<input class="field" id="taxName" maxlength="60" value="${create ? '' : esc(item.name)}"></label><button class="primary" id="taxSave">${create ? '创建' : '保存名称'}</button>${
          item
            ? `<label>合并到<select class="field" id="taxMergeTarget"><option value="">选择目标</option>${items
                .filter((i) => i !== item)
                .map((i) => `<option>${esc(i.name)}</option>`)
                .join(
                  '',
                )}</select></label><button class="secondary" id="taxMerge">合并关联日记</button><hr><p>移除${label()}不删除日记${kind === 'category' ? '，日记会归到“未分类”' : ''}。</p><button class="secondary" id="taxRemove">移除此${label()}</button><div id="taxConfirm"></div>`
            : ''
        }`;
      const submit = (action, to) =>
        mutate(async () => {
          await api('/api/taxonomy', {
            method: 'POST',
            data: { kind, action, from: selected || '', to },
          });
          selected = action === 'remove' ? null : to;
        });
      $('#taxSave').onclick = () => {
        const to = $('#taxName').value.trim();
        if (!to) return toast('请输入名称');
        if (items.some((i) => i.name === to && (create || to !== selected)))
          return toast('名称已存在，请使用合并功能');
        submit(create ? 'create' : 'rename', to);
      };
      if (!item) return;
      if (kind === 'category') {
        const explanation = document.createElement('p');
        explanation.textContent = '主页与思绪新建时预选此分类；默认标记不改变排列顺序。';
        const button = document.createElement('button');
        button.id = 'taxSetDefault';
        button.className = 'secondary';
        button.textContent = item.name === defaultCategory ? '当前默认分类' : '设为默认分类';
        button.disabled = item.name === defaultCategory;
        button.onclick = () =>
          mutate(() =>
            api('/api/preferences', { method: 'PUT', data: { defaultCategory: item.name } }),
          );
        $('#taxBrowse').after(explanation, button);
      }
      $('#taxBrowse').onclick = () => c.filterView({ [kind]: selected });
      const confirm = (message, action) => {
        $('#taxConfirm').innerHTML =
          `<p role="status">${esc(message)}</p><button class="primary" id="taxConfirmYes">确认执行</button><button class="secondary" id="taxConfirmNo">取消</button>`;
        $('#taxConfirmYes').onclick = action;
        $('#taxConfirmNo').onclick = () => {
          $('#taxConfirm').innerHTML = '';
        };
      };
      $('#taxMerge').onclick = () => {
        const to = $('#taxMergeTarget').value;
        if (!to) return toast('请选择合并目标');
        confirm(`将“${selected}”关联的 ${item.total} 篇日记合并到“${to}”。`, () =>
          submit('merge', to),
        );
      };
      $('#taxRemove').onclick = () =>
        confirm(`将移除“${selected}”的归类关系，涉及 ${item.total} 篇日记。`, () =>
          submit('remove', ''),
        );
    }
    rows();
    detail();
    $('#taxRows').scrollTop = scrollTop;
    root.scrollTop = outerScroll;
    return true;
  }
  return { manage, render };
}
