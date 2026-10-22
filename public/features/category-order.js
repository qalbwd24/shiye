import { sortedTaxonomy, taxonomyItems } from '../shared/taxonomy.js';

/** A draft order inside Settings; no entry/category rename and no per-step network write. */
export function createCategoryOrder(c) {
  return function settings() {
    let order = sortedTaxonomy(c.library, 'category').map((item) => item.name);
    const expectedOrder = taxonomyItems(c.library, 'category').map((item) => item.name);
    let selected = order[0] || null;
    let busy = false;
    let active = true;
    c.modal(
      '分类顺序',
      `<p>选择一个分类，用固定按钮调整顺序；保存前不会改变现有分类。</p>
      <div class="category-order"><input class="field" id="orderSearch" type="search" placeholder="搜索分类" aria-label="搜索要排序的分类">
      <div class="category-order__list" id="orderList" role="listbox" aria-label="分类顺序"></div>
      <div class="category-order__controls"><strong id="orderSelected"></strong><div class="category-order__buttons">
      <button class="secondary" id="orderUp">上移</button><button class="secondary" id="orderDown">下移</button><button class="secondary" id="orderFirst">最前</button><button class="secondary" id="orderLast">最后</button>
      <label>移到第 <input class="field" id="orderPosition" type="number" min="1" aria-label="目标序号"> 位</label><button class="secondary" id="orderMove">移动</button></div></div>
      <p id="orderStatus" role="status">搜索结果中的序号仍对应完整列表。Alt+↑/↓ 调整选中分类。</p>
      <div class="settings-save-row"><button class="secondary" id="orderCancel">取消</button><button class="primary" id="orderSave">保存顺序</button></div></div>`,
    );
    const $ = (query) => c.$(query);
    const dialog = $('#modal');
    const cleanup = () => {
      active = false;
      dialog.removeEventListener('close', cleanup);
      dialog.removeEventListener('modalreplace', cleanup);
    };
    dialog.addEventListener('close', cleanup);
    dialog.addEventListener('modalreplace', cleanup);
    function render() {
      const list = $('#orderList');
      const scroll = list.scrollTop;
      list.replaceChildren();
      const query = $('#orderSearch').value.trim().toLocaleLowerCase();
      order.forEach((name, index) => {
        if (!name.toLocaleLowerCase().includes(query)) return;
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'category-order__item';
        button.setAttribute('role', 'option');
        button.setAttribute('aria-selected', String(name === selected));
        button.textContent = `${index + 1}. ${name}`;
        button.onclick = () => {
          selected = name;
          render();
          $('#orderPosition').value = order.indexOf(selected) + 1;
          $('#orderList [aria-selected="true"]')?.focus({ preventScroll: true });
        };
        list.append(button);
      });
      list.scrollTop = scroll;
      const index = order.indexOf(selected);
      $('#orderSelected').textContent = selected
        ? `${selected} · 第 ${index + 1} / ${order.length} 位`
        : '暂无分类';
      $('#orderPosition').max = order.length;
      for (const id of ['orderUp', 'orderFirst']) $('#' + id).disabled = busy || index <= 0;
      for (const id of ['orderDown', 'orderLast'])
        $('#' + id).disabled = busy || index < 0 || index === order.length - 1;
      $('#orderMove').disabled = busy || index < 0;
      $('#orderSave').disabled = busy || !order.length;
      $('#orderCancel').disabled = busy;
    }
    function move(index) {
      if (busy || !selected) return;
      const from = order.indexOf(selected);
      const to = Math.max(0, Math.min(order.length - 1, index));
      if (!Number.isInteger(to) || from < 0) return;
      order = order.filter((name) => name !== selected);
      order.splice(to, 0, selected);
      render();
      $('#orderPosition').value = to + 1;
      $('#orderStatus').textContent = `“${selected}”已移到第 ${to + 1} 位，点击保存顺序生效`;
      $('#orderList [aria-selected="true"]')?.scrollIntoView({ block: 'nearest' });
    }
    $('#orderSearch').oninput = render;
    $('#orderUp').onclick = () => move(order.indexOf(selected) - 1);
    $('#orderDown').onclick = () => move(order.indexOf(selected) + 1);
    $('#orderFirst').onclick = () => move(0);
    $('#orderLast').onclick = () => move(order.length - 1);
    $('#orderMove').onclick = () => {
      const position = Number($('#orderPosition').value);
      if (!Number.isInteger(position) || position < 1 || position > order.length) {
        $('#orderStatus').textContent = `请输入 1–${order.length} 的序号`;
        return;
      }
      move(position - 1);
    };
    $('.category-order').addEventListener('keydown', (event) => {
      if (
        !busy &&
        event.target.closest?.('#orderList') &&
        !event.altKey &&
        !event.ctrlKey &&
        !event.metaKey &&
        !event.shiftKey &&
        !event.isComposing &&
        event.keyCode !== 229 &&
        ['ArrowUp', 'ArrowDown'].includes(event.key)
      ) {
        const visible = order.filter((name) =>
          name.toLocaleLowerCase().includes($('#orderSearch').value.trim().toLocaleLowerCase()),
        );
        const index = visible.indexOf(selected);
        selected =
          visible[
            Math.max(0, Math.min(visible.length - 1, index + (event.key === 'ArrowUp' ? -1 : 1)))
          ] || selected;
        event.preventDefault();
        render();
        const option = $('#orderList [aria-selected="true"]');
        option?.focus({ preventScroll: true });
        option?.scrollIntoView({ block: 'nearest' });
        return;
      }
      if (
        !event.altKey ||
        event.ctrlKey ||
        event.metaKey ||
        event.shiftKey ||
        event.isComposing ||
        event.keyCode === 229
      )
        return;
      if (!['ArrowUp', 'ArrowDown'].includes(event.key)) return;
      event.preventDefault();
      move(order.indexOf(selected) + (event.key === 'ArrowUp' ? -1 : 1));
    });
    $('#orderCancel').onclick = c.closeModal;
    $('#orderSave').onclick = async () => {
      if (busy) return;
      busy = true;
      render();
      try {
        await c.withLibraryMutation(async () => {
          await c.api('/api/taxonomy/order', {
            method: 'PUT',
            data: { kind: 'category', order, expectedOrder },
          });
          await c.refreshLibrary();
        });
        if (active) c.closeModal();
        c.renderView();
        c.toast('分类顺序已保存');
      } catch (error) {
        if (active) $('#orderStatus').textContent = error.message;
        else c.toast(error.message);
      } finally {
        busy = false;
        if (active && $('#orderList')) render();
      }
    };
    render();
    $('#orderPosition').value = 1;
  };
}
