/* WebView2 caret layout recovery after resize/zoom; never runs during IME composition. */
(() => {
  if (!window.chrome?.webview) return;
  let dirty = true;
  let composing = false;
  let timer;
  let generation = 0;
  function isEditor(element) {
    return element?.matches?.(
      '[contenteditable=true], textarea, input[type=text], input[type=search]',
    );
  }
  function schedule() {
    clearTimeout(timer);
    timer = setTimeout(reanchor, 140);
  }
  function reanchor() {
    const input = document.activeElement;
    if (!dirty || composing || !isEditor(input) || !document.hasFocus()) return;
    const ticket = ++generation;
    const selection = getSelection();
    const ranges =
      input.isContentEditable && selection?.rangeCount
        ? [...Array(selection.rangeCount)].map((_, index) =>
            selection.getRangeAt(index).cloneRange(),
          )
        : [];
    const textSelection = !input.isContentEditable
      ? {
          start: input.selectionStart,
          end: input.selectionEnd,
          direction: input.selectionDirection,
        }
      : undefined;
    const scroll = [];
    for (let node = input; node; node = node.parentElement)
      scroll.push({ node, x: node.scrollLeft, y: node.scrollTop });
    input.blur();
    // A synchronous blur/focus does not refresh WebView2's TSF text layout.
    setTimeout(() => {
      if (
        ticket !== generation ||
        composing ||
        !input.isConnected ||
        !document.hasFocus() ||
        (document.activeElement !== document.body && document.activeElement !== input)
      )
        return;
      input.focus({ preventScroll: true });
      if (textSelection && textSelection.start !== null)
        input.setSelectionRange(textSelection.start, textSelection.end, textSelection.direction);
      else if (
        ranges.length &&
        ranges.every((range) => input.contains(range.commonAncestorContainer))
      ) {
        selection.removeAllRanges();
        ranges.forEach((range) => selection.addRange(range));
      }
      scroll.forEach(({ node, x, y }) => {
        node.scrollLeft = x;
        node.scrollTop = y;
      });
      dirty = false;
    }, 65);
  }
  window.addEventListener('resize', () => {
    dirty = true;
    schedule();
  });
  window.addEventListener('shiye-resume', () => {
    dirty = true;
    schedule();
  });
  document.addEventListener('focusin', () => {
    if (dirty) schedule();
  });
  document.addEventListener(
    'pointerdown',
    () => {
      generation++;
      if (dirty) schedule();
    },
    true,
  );
  document.addEventListener(
    'keydown',
    () => {
      if (dirty) schedule();
    },
    true,
  );
  document.addEventListener(
    'compositionstart',
    () => {
      composing = true;
      generation++;
      clearTimeout(timer);
    },
    true,
  );
  document.addEventListener(
    'compositionend',
    () => {
      composing = false;
      if (dirty) schedule();
    },
    true,
  );
})();
