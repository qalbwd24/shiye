/** Navigation at editor boundaries, without changing content or swallowing IME input. */
export function installTitleNavigation(
  title,
  { focusBody, body, atBodyStart = () => false, canFocus = () => true, now = Date.now },
) {
  let composing = false;
  let compositionEndedAt = -Infinity;
  const listeners = [];
  const listen = (type, handler) => {
    title.addEventListener(type, handler);
    listeners.push(() => title.removeEventListener(type, handler));
  };
  listen('compositionstart', () => (composing = true));
  listen('compositionend', () => {
    composing = false;
    compositionEndedAt = now();
  });
  listen('keyup', (event) => {
    if (event.key === 'Enter' && !composing) compositionEndedAt = -Infinity;
  });
  listen('blur', () => {
    composing = false;
    compositionEndedAt = -Infinity;
  });
  listen('keydown', (event) => {
    if (
      !['Enter', 'ArrowDown'].includes(event.key) ||
      (event.key === 'ArrowDown' &&
        (title.selectionStart !== title.value.length ||
          title.selectionEnd !== title.value.length)) ||
      event.defaultPrevented ||
      event.repeat ||
      event.isComposing ||
      event.keyCode === 229 ||
      composing ||
      now() - compositionEndedAt <= 40 ||
      event.ctrlKey ||
      event.altKey ||
      event.metaKey ||
      event.shiftKey ||
      title.disabled ||
      title.readOnly ||
      !canFocus()
    )
      return;
    event.preventDefault();
    event.stopPropagation();
    focusBody();
  });
  if (body) {
    let bodyComposing = false,
      bodyEndedAt = -Infinity;
    const bodyStart = () => {
      bodyComposing = true;
    };
    const bodyEnd = () => {
      bodyComposing = false;
      bodyEndedAt = now();
    };
    body.addEventListener('compositionstart', bodyStart);
    body.addEventListener('compositionend', bodyEnd);
    listeners.push(() => {
      body.removeEventListener('compositionstart', bodyStart);
      body.removeEventListener('compositionend', bodyEnd);
    });
    const bodyKey = (event) => {
      if (
        event.key !== 'ArrowUp' ||
        event.defaultPrevented ||
        event.repeat ||
        event.isComposing ||
        event.keyCode === 229 ||
        bodyComposing ||
        now() - bodyEndedAt <= 40 ||
        event.ctrlKey ||
        event.altKey ||
        event.metaKey ||
        event.shiftKey ||
        !canFocus() ||
        !atBodyStart()
      )
        return;
      event.preventDefault();
      event.stopPropagation();
      title.focus({ preventScroll: true });
      title.setSelectionRange(title.value.length, title.value.length);
    };
    body.addEventListener('keydown', bodyKey, { capture: true });
    listeners.push(() => body.removeEventListener('keydown', bodyKey, { capture: true }));
  }
  return () => listeners.forEach((remove) => remove());
}
