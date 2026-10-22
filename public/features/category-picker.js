import { createCategoryPickerModel, categoryPickerKeyAction } from '../shared/category-picker.js';

let sequence = 0;

/**
 * Independent native dialog; mount styles/category-picker.css at integration time.
 * open(): Promise<string|null>. With getPrevious, also returns { action: 'previous' }.
 * getPrevious resolves availability only; callers own navigation after the dialog closes.
 * refresh(): reflect external category changes while open; destroy(): cancel/clean up.
 * This module never writes preferences, creates an entry, or mounts an editor.
 */
export function createCategoryPicker({ getLibrary, ownerDocument = document }) {
  let session = null;
  let destroyed = false;

  function open({ getPrevious } = {}) {
    if (destroyed) return Promise.resolve(null);
    if (session) return session.promise;
    const doc = ownerDocument;
    const prefix = `category-picker-${++sequence}`;
    const model = createCategoryPickerModel(getLibrary);
    const previousFocus = doc.activeElement;
    const selection = doc.getSelection();
    const previousRange = selection?.rangeCount ? selection.getRangeAt(0).cloneRange() : null;
    const inputSelection =
      typeof previousFocus?.selectionStart === 'number'
        ? [
            previousFocus.selectionStart,
            previousFocus.selectionEnd,
            previousFocus.selectionDirection,
          ]
        : null;
    const element = (tag, className, text) => {
      const node = doc.createElement(tag);
      if (className) node.className = className;
      if (text !== undefined) node.textContent = text;
      return node;
    };
    const dialog = element('dialog', 'category-picker');
    dialog.tabIndex = -1;
    dialog.setAttribute('aria-labelledby', `${prefix}-title`);
    dialog.setAttribute('aria-describedby', `${prefix}-hint`);
    const header = element('header', 'category-picker__header');
    const title = element('h2', '', '选择日记分类');
    title.id = `${prefix}-title`;
    const closeButton = element('button', 'category-picker__close', '×');
    closeButton.type = 'button';
    closeButton.setAttribute('aria-label', '取消新建');
    header.append(title, closeButton);
    const search = element('input', 'category-picker__search');
    search.type = 'search';
    search.placeholder = '搜索分类';
    search.autocomplete = 'off';
    search.setAttribute('aria-label', '搜索并选择分类');
    search.setAttribute('role', 'combobox');
    search.setAttribute('aria-autocomplete', 'list');
    search.setAttribute('aria-expanded', 'true');
    search.setAttribute('aria-controls', `${prefix}-list`);
    const list = element('div', 'category-picker__list');
    list.id = `${prefix}-list`;
    list.setAttribute('role', 'listbox');
    list.setAttribute('aria-label', '日记分类');
    const status = element('p', 'category-picker__status');
    status.setAttribute('role', 'status');
    const hint = element('p', 'category-picker__hint', '↑ ↓ 选择 · Enter 开始写作 · Esc 取消');
    hint.id = `${prefix}-hint`;
    const footer = element('footer', 'category-picker__footer');
    const hasPrevious = typeof getPrevious === 'function';
    if (hasPrevious) title.textContent = '继续记录，或选择分类新建';
    const cancelButton = element('button', 'secondary', '取消');
    cancelButton.type = 'button';
    const confirmButton = element('button', 'primary', '开始写作');
    confirmButton.type = 'button';
    footer.append(cancelButton, confirmButton);
    dialog.append(header, search, list, status, hint, footer);
    let resolve;
    const promise = new Promise((done) => (resolve = done));
    let composing = false;
    let compositionEndedAt = -Infinity;
    let settled = false;
    let displayedActive = null;
    let previousSelected = hasPrevious;
    let previousAvailable = null;
    let pendingPrevious = false;
    const showPrevious = () => hasPrevious && !search.value.trim();

    function finish(value) {
      if (settled) return;
      settled = true;
      session = null;
      if (dialog.open) dialog.close();
      dialog.remove();
      if (previousFocus?.isConnected) {
        previousFocus.focus({ preventScroll: true });
        if (inputSelection) previousFocus.setSelectionRange(...inputSelection);
        else if (previousRange?.commonAncestorContainer.isConnected) {
          selection.removeAllRanges();
          selection.addRange(previousRange);
        }
      }
      resolve(value);
    }

    function render() {
      const state = model.snapshot();
      displayedActive = state.active;
      list.replaceChildren();
      let activeNode = null;
      if (showPrevious()) {
        const option = element('div', 'category-picker__option category-picker__previous');
        option.id = `${prefix}-previous`;
        option.setAttribute('role', 'option');
        option.setAttribute('aria-selected', String(previousSelected));
        option.setAttribute('aria-disabled', String(previousAvailable !== true));
        option.append(element('span', 'category-picker__name', '上一篇'));
        option.append(
          element(
            'span',
            'category-picker__count',
            previousAvailable === null ? '查找中…' : previousAvailable ? '继续编辑' : '暂无记录',
          ),
        );
        option.addEventListener('pointerdown', (event) => event.preventDefault());
        option.addEventListener('click', () => {
          previousSelected = true;
          confirm();
        });
        if (previousSelected) activeNode = option;
        list.append(option);
      }
      state.items.forEach((item, index) => {
        const option = element('div', 'category-picker__option');
        option.id = `${prefix}-option-${index}`;
        option.setAttribute('role', 'option');
        option.setAttribute(
          'aria-selected',
          String(!previousSelected && item.name === state.active),
        );
        option.append(element('span', 'category-picker__name', item.name));
        if (item.name === state.defaultCategory)
          option.append(element('span', 'category-picker__default', '默认'));
        option.append(element('span', 'category-picker__count', `${item.count} 篇`));
        option.addEventListener('pointerdown', (event) => event.preventDefault());
        option.addEventListener('click', () => {
          const chosen = model.select(item.name);
          if (chosen !== null) finish(chosen);
          else render();
        });
        if (!previousSelected && item.name === state.active) activeNode = option;
        list.append(option);
      });
      confirmButton.disabled = previousSelected
        ? previousAvailable === null
        : state.active === null;
      confirmButton.textContent = previousSelected ? '打开上一篇' : '开始写作';
      status.textContent =
        previousSelected && previousAvailable === false
          ? '暂无上一篇，请用 ↓ 选择分类新建'
          : state.items.length
            ? `${state.items.length} 个分类`
            : state.query.trim()
              ? '没有匹配的分类，试试其他关键词'
              : '还没有分类，请先在分类管理中新建';
      if (activeNode) {
        search.setAttribute('aria-activedescendant', activeNode.id);
        activeNode.scrollIntoView({ block: 'nearest' });
      } else search.removeAttribute('aria-activedescendant');
    }

    function confirm() {
      if (previousSelected && showPrevious()) {
        if (previousAvailable === null) {
          pendingPrevious = true;
          status.textContent = '正在查找，完成后打开上一篇…';
          return;
        }
        if (previousAvailable === true) finish({ action: 'previous' });
        else render();
        return;
      }
      // Never silently substitute a different category if the displayed one was removed.
      const chosen = model.select(displayedActive);
      if (chosen !== null) finish(chosen);
      else render();
    }

    closeButton.addEventListener('click', () => finish(null));
    cancelButton.addEventListener('click', () => finish(null));
    confirmButton.addEventListener('click', confirm);
    dialog.addEventListener('close', () => finish(null));
    dialog.addEventListener('cancel', (event) => {
      event.preventDefault();
      if (!composing && Date.now() - compositionEndedAt > 40) finish(null);
    });
    search.addEventListener('compositionstart', () => (composing = true));
    search.addEventListener('blur', () => {
      // A native activation/input-language change can cancel composition
      // without delivering compositionend. Do not latch navigation off forever.
      composing = false;
      compositionEndedAt = -Infinity;
    });
    search.addEventListener('compositionend', () => {
      composing = false;
      compositionEndedAt = Date.now();
      model.setQuery(search.value);
      pendingPrevious = false;
      previousSelected = hasPrevious && !search.value.trim();
      render();
    });
    search.addEventListener('input', () => {
      if (composing) return;
      model.setQuery(search.value);
      pendingPrevious = false;
      previousSelected = hasPrevious && !search.value.trim();
      render();
    });
    dialog.addEventListener('keydown', (event) => {
      const action = categoryPickerKeyAction(
        event,
        composing || Date.now() - compositionEndedAt <= 40,
      );
      // Navigation belongs to the whole picker, including after Tab or native
      // activation moved focus to a footer button. Keep button Enter native.
      if (!action || (action === 'confirm' && event.target !== search && event.target !== dialog))
        return;
      event.preventDefault();
      event.stopPropagation();
      if (action === 'cancel') finish(null);
      else if (action === 'confirm') confirm();
      else {
        search.focus({ preventScroll: true });
        pendingPrevious = false;
        const state = model.snapshot();
        const step = action === 'previous' ? -1 : 1;
        const index = state.items.findIndex((item) => item.name === state.active);
        if (showPrevious() && previousSelected && state.items.length) {
          previousSelected = false;
          model.select(state.items[step > 0 ? 0 : state.items.length - 1].name);
        } else if (
          showPrevious() &&
          ((step < 0 && index === 0) || (step > 0 && index === state.items.length - 1))
        ) {
          previousSelected = true;
        } else model.move(step);
        render();
      }
    });
    session = { promise, finish, render };
    doc.body.append(dialog);
    try {
      dialog.showModal();
      render();
      search.focus({ preventScroll: true });
      if (hasPrevious) {
        Promise.resolve()
          .then(getPrevious)
          .then((available) => {
            if (settled) return;
            previousAvailable = !!available;
            if (pendingPrevious && previousAvailable && previousSelected && showPrevious()) {
              finish({ action: 'previous' });
              return;
            }
            pendingPrevious = false;
            render();
          })
          .catch(() => {
            if (settled) return;
            previousAvailable = false;
            render();
            status.textContent = '历史读取失败，可取消后重试，或选择分类新建';
          });
      }
    } catch (error) {
      finish(null);
      throw error;
    }
    return promise;
  }

  return {
    open,
    refresh: () => session?.render(),
    cancel: () => session?.finish(null),
    destroy() {
      destroyed = true;
      session?.finish(null);
    },
  };
}
