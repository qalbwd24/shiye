import { sortedTaxonomy } from './taxonomy.js';

/** Pure selection state. The getter is read on every operation, never cached. */
export function createCategoryPickerModel(getLibrary) {
  let query = '';
  let active = null;
  const normalize = (value) => String(value).normalize('NFKC').toLocaleLowerCase().trim();

  function snapshot() {
    const library = getLibrary() || {};
    const defaultCategory = library.settings?.preferences?.defaultCategory || null;
    const items = sortedTaxonomy(library, 'category').filter((item) =>
      normalize(item.name).includes(normalize(query)),
    );
    if (!items.some((item) => item.name === active)) {
      active = items.some((item) => item.name === defaultCategory)
        ? defaultCategory
        : items[0]?.name || null;
    }
    return { query, items, active, defaultCategory };
  }

  return {
    snapshot,
    setQuery(value) {
      query = String(value);
      return snapshot();
    },
    move(direction) {
      const state = snapshot();
      if (state.items.length) {
        const index = state.items.findIndex((item) => item.name === active);
        const next = (index + (direction < 0 ? -1 : 1) + state.items.length) % state.items.length;
        active = state.items[next].name;
      }
      return snapshot();
    },
    select(name) {
      const state = snapshot();
      if (!state.items.some((item) => item.name === name)) return null;
      active = name;
      return active;
    },
  };
}

/** Do not interpret IME candidate navigation/commit as picker commands. */
export function categoryPickerKeyAction(event, composing = false) {
  if (composing || event.isComposing || event.keyCode === 229) return null;
  if (event.ctrlKey || event.altKey || event.metaKey || event.shiftKey) return null;
  return (
    { ArrowUp: 'previous', ArrowDown: 'next', Enter: 'confirm', Escape: 'cancel' }[event.key] ||
    null
  );
}
