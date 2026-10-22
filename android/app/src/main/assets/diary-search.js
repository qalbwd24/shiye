import { Decoration, DecorationSet, Plugin } from '/public/vendor/rich-editor.js';

const fold = (text) => {
  let value = '', starts = [], ends = [];
  for (let at = 0; at < text.length;) {
    const character = String.fromCodePoint(text.codePointAt(at));
    const end = at + character.length;
    const lower = character.toLowerCase();
    for (let i = 0; i < lower.length; i++) { starts.push(at); ends.push(end); }
    value += lower;
    at = end;
  }
  return { value, starts, ends };
};

export function parseSearchContext(raw) {
  try {
    if (!raw || raw.length > 16384) return null;
    const value = JSON.parse(raw);
    if (!value || !Array.isArray(value.w)) return null;
    const words = [...new Set(value.w.filter((word) => typeof word === 'string' && word.length > 0 && word.length <= 1024))];
    return { query: String(value.q || '').slice(0, 1024), day: String(value.d || '').slice(0, 10), words, limited: !!value.limited };
  } catch { return null; }
}

export function searchTerms(query) {
  const date = query.toLowerCase().match(/(?<![0-9])\d{4}-\d{2}-\d{2}(?![0-9])/u)?.[0] || '';
  // Java String.replace(exactDay, "") removes every matching date token.
  const text = date ? query.toLowerCase().split(date).join('').trim() : query.toLowerCase().trim();
  return { day: date, words: [...new Set(text.split(/\s+/u).filter(Boolean))] };
}

/** Positions use the actual ProseMirror doc, including separate marked text nodes. */
export function buildTextHits(doc, words) {
  const hits = [];
  const needles = [...new Set(words.map((word) => word.toLowerCase()).filter(Boolean))];
  doc.descendants((node, position) => {
    if (!node.isTextblock) return true;
    let text = '', offsets = [];
    node.forEach((child, offset) => {
      if (child.isText) {
        text += child.text;
        for (let i = 0; i < child.text.length; i++) offsets.push(position + 1 + offset + i);
      } else {
        // An image or inline atom is a boundary, never a phantom text match.
        text += '\ufffc'; offsets.push(position + 1 + offset);
      }
    });
    if (!text) return false;
    const source = fold(text);
    for (const needle of needles) {
      const target = fold(needle).value;
      if (!target || target.includes('\ufffc')) continue;
      let from = 0;
      while ((from = source.value.indexOf(target, from)) !== -1) {
        const start = source.starts[from], end = source.ends[from + target.length - 1];
        if (start !== undefined && end !== undefined && !text.slice(start, end).includes('\ufffc')) {
          hits.push({ from: offsets[start], to: offsets[end - 1] + 1, word: needle });
        }
        from += Math.max(1, target.length);
      }
    }
    return false;
  });
  hits.sort((a, b) => a.from - b.from || a.to - b.to);
  return hits.filter((hit, index) => !index || hit.from !== hits[index - 1].from || hit.to !== hits[index - 1].to);
}

export function installDiarySearch(editor, nodes, initialContext) {
  const { bar, input, previous, next, status, close, scroller } = nodes;
  let words = initialContext?.words || [], day = initialContext?.day || '';
  let hits = [], current = -1, closed = false;
  let queryEdited = false, imeComposing = false, followCurrent = false, followGeneration = 0;
  const refreshKey = 'diary-search-refresh';
  const repaint = () => editor.view.dispatch(editor.state.tr.setMeta(refreshKey, true).setMeta('addToHistory', false));
  const label = () => {
    if (!words.length) status.textContent = day ? `日期 ${day} · 正文未指定关键词` : '输入词语查找正文';
    else if (!hits.length) status.textContent = initialContext && input.value === initialContext.query
      ? '正文 0 处 · 列表命中' : '正文 0 处';
    else status.textContent = `正文 ${current + 1} / ${hits.length}`;
    if (initialContext?.limited) status.textContent += ' · 列表搜索词过长';
    previous.disabled = next.disabled = !hits.length;
  };
  const recompute = (keepPosition = false, doc = editor.state.doc) => {
    const position = keepPosition && current >= 0 ? hits[current]?.from : null;
    hits = buildTextHits(doc, words);
    current = hits.length ? (position == null ? 0 : Math.max(0, hits.findIndex((hit) => hit.from >= position))) : -1;
    label();
  };
  const plugin = new Plugin({
    state: {
      init: (_, state) => { hits = buildTextHits(state.doc, words); current = hits.length ? 0 : -1; label(); return 0; },
      apply: (tr, value) => { if (tr.docChanged) recompute(true, tr.doc); return value; },
    },
    props: {
      decorations(state) {
        return DecorationSet.create(state.doc, hits.map((hit, index) => Decoration.inline(hit.from, hit.to, {
          class: index === current ? 'diary-search-hit diary-search-current' : 'diary-search-hit',
        })));
      },
    },
  });
  editor.registerPlugin(plugin);
  const scrollCurrent = (generation) => requestAnimationFrame(() => {
    const hit = hits[current];
    if (!hit || closed || !followCurrent || generation !== followGeneration || bar.hidden) return;
    // Decorations may span marked text nodes; the painted current span is
    // the reliable visual anchor after an image changes its decoded size.
    const rect = editor.view.dom.querySelector('.diary-search-current')?.getBoundingClientRect()
      || editor.view.coordsAtPos(hit.from);
    const area = scroller.getBoundingClientRect();
    if (rect.top < area.top + 36 || rect.bottom > area.bottom - 36)
      scroller.scrollTop += rect.top - area.top - Math.max(36, (area.height - rect.height) / 3);
  });
  const move = (direction, scroll = true) => {
    if (!hits.length || closed) return;
    current = (current + direction + hits.length) % hits.length;
    label(); repaint();
    if (scroll) { followCurrent = true; scrollCurrent(++followGeneration); }
  };
  const update = () => {
    queryEdited = true;
    const parsed = searchTerms(input.value);
    words = parsed.words; day = parsed.day;
    recompute(); repaint();
    if (hits.length) move(0);
  };
  input.addEventListener('compositionstart', () => { imeComposing = true; });
  input.addEventListener('compositionend', () => { imeComposing = false; update(); });
  input.addEventListener('input', () => { if (!imeComposing) update(); });
  input.addEventListener('keydown', (event) => {
    if (imeComposing || event.isComposing || event.keyCode === 229) return;
    if (event.key === 'Enter') { event.preventDefault(); move(event.shiftKey ? -1 : 1); }
    if (event.key === 'Escape') { event.preventDefault(); hide(); }
  });
  const userRead = () => { followCurrent = false; followGeneration++; };
  // Programmatic scroller.scrollTop also fires scroll; only input intent releases
  // the automatic image-load anchor. A later explicit navigation reacquires it.
  scroller.addEventListener('touchstart', userRead, { passive: true });
  scroller.addEventListener('pointerdown', userRead, { passive: true });
  scroller.addEventListener('wheel', userRead, { passive: true });
  document.addEventListener('keydown', (event) => {
    if (event.isComposing || event.keyCode === 229 ||
        !['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End', ' '].includes(event.key)) return;
    if (event.target === document.body || scroller.contains(event.target)) userRead();
  });
  // A toolbar tap must not replace the editor's saved selection or IME composition.
  for (const button of [previous, next, close]) button.addEventListener('pointerdown', (event) => event.preventDefault());
  previous.addEventListener('click', () => move(-1));
  next.addEventListener('click', () => move(1));
  const hide = () => { userRead(); bar.hidden = true; words = []; day = ''; hits = []; current = -1; label(); repaint(); };
  close.addEventListener('click', hide);
  const show = (focus = false) => {
    if (bar.hidden) {
      bar.hidden = false;
      const parsed = !queryEdited && initialContext && input.value === initialContext.query
        ? initialContext : searchTerms(input.value);
      words = parsed.words; day = parsed.day;
      recompute(); repaint();
    }
    if (focus) input.focus();
  };
  if (initialContext) {
    input.value = initialContext.query;
    show(false); recompute(); repaint();
    if (hits.length) move(0);
  }
  editor.view.dom.addEventListener('load', (event) => {
    if (event.target?.tagName === 'IMG' && !bar.hidden && hits.length && followCurrent)
      scrollCurrent(followGeneration);
  }, true);
  window.addEventListener('pagehide', () => { closed = true; }, { once: true });
  return { show, hide, move, get hits() { return hits; }, get current() { return current; } };
}
