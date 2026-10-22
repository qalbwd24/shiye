/* Shiye-only controls over the pinned Telegram Web A client. GPL-3.0-or-later. */
(() => {
  window.shiyeFrameUiVersion = '20261021-ui57';
  let bubbleSpacing = 'comfortable';
  let bubblePadding = 12;
  try {
    if (localStorage.getItem('shiye-bubble-spacing') === 'compact') bubbleSpacing = 'compact';
    const stored = localStorage.getItem('shiye-bubble-padding');
    const value = Number(stored);
    if (stored !== null && stored.trim() && Number.isFinite(value))
      bubblePadding = Math.max(6, Math.min(24, Math.round(value)));
  } catch {
    /* Defaults remain available when storage is unavailable. */
  }
  function applyBubbleSpacing() {
    document.body.dataset.shiyeBubbleSpacing = bubbleSpacing;
    document.body.style.setProperty('--shiye-bubble-padding', bubblePadding + 'px');
  }
  applyBubbleSpacing();
  function installBubbleSpacingSettings(container, anchor) {
    const spacingLabel = document.createElement('label');
    spacingLabel.textContent = '气泡留白';
    const spacing = document.createElement('select');
    spacing.id = 'shiyeBubbleSpacing';
    spacing.add(new Option('均匀留白（可调）', 'comfortable'));
    spacing.add(new Option('原有紧凑', 'compact'));
    spacing.value = bubbleSpacing;
    spacingLabel.append(spacing);
    const paddingLabel = document.createElement('label');
    const value = document.createElement('span');
    const padding = document.createElement('input');
    padding.id = 'shiyeBubblePadding';
    padding.type = 'range';
    padding.min = '6';
    padding.max = '24';
    padding.step = '1';
    padding.value = String(bubblePadding);
    paddingLabel.append(value, padding);
    const help = document.createElement('p');
    help.textContent = '文字气泡四周使用相同留白，应用于所有对话；图片和纯表情保留原布局。';
    const reset = document.createElement('button');
    reset.type = 'button';
    reset.id = 'shiyeBubbleSpacingReset';
    reset.textContent = '恢复默认留白';
    function refresh() {
      value.textContent = '四周留白：' + bubblePadding + ' px';
      padding.disabled = bubbleSpacing === 'compact';
    }
    function save() {
      bubbleSpacing = spacing.value === 'compact' ? 'compact' : 'comfortable';
      bubblePadding = Math.max(6, Math.min(24, Math.round(Number(padding.value) || 12)));
      try {
        localStorage.setItem('shiye-bubble-spacing', bubbleSpacing);
        localStorage.setItem('shiye-bubble-padding', String(bubblePadding));
      } catch {
        /* Keep this session's appearance even if persistence is unavailable. */
      }
      applyBubbleSpacing();
      refresh();
      window.dispatchEvent(new Event('resize'));
    }
    spacing.onchange = save;
    padding.oninput = save;
    reset.onclick = () => {
      spacing.value = 'comfortable';
      padding.value = '12';
      save();
    };
    refresh();
    anchor.after(spacingLabel, paddingLabel, help, reset);
  }

  const post = (message) => window.chrome?.webview?.postMessage(message);
  // Migrate the old default once; preserve every other explicit preference.
  if (!localStorage.getItem('shiye-switch-timing-v2')) {
    if (localStorage.getItem('shiye-switch-delay') === '800')
      localStorage.setItem('shiye-switch-delay', '1200');
    localStorage.setItem('shiye-switch-timing-v2', '1');
  }
  window.shiyeSwitchDelay = {
    get() {
      const value = Number(localStorage.getItem('shiye-switch-delay'));
      return Number.isFinite(value) && value > 0 ? Math.max(400, Math.min(5000, value)) : 1200;
    },
    set(value) {
      const number = Number(value);
      const delay =
        Number.isFinite(number) && number > 0 ? Math.max(400, Math.min(5000, number)) : 1200;
      localStorage.setItem('shiye-switch-delay', String(delay));
      return delay;
    },
  };
  let lastEditor;
  let inputMode = 'chinese';
  let textScale = 1;
  let hasWindowState = false;
  let desktopState = { confirmHide: false, topmost: false };
  let desktopStatus;
  const interactedMediaModals = new WeakSet();
  const positionedMediaModals = new WeakSet();
  const mediaFocusIntents = new WeakMap();
  function rememberMediaFocus(modal, element) {
    const target = element?.closest?.('button,input,textarea,select,[contenteditable=true]');
    if (!target || !modal.contains(target)) return;
    const selection = window.getSelection();
    const range =
      !composing &&
      selection?.rangeCount &&
      target.contains(selection.anchorNode) &&
      target.contains(selection.focusNode)
        ? selection.getRangeAt(0).cloneRange()
        : undefined;
    mediaFocusIntents.set(modal, {
      target,
      range,
      startNode: range?.startContainer,
      startOffset: range?.startOffset,
      endNode: range?.endContainer,
      endOffset: range?.endOffset,
    });
  }
  function modalFocusTarget(modal) {
    const intent = mediaFocusIntents.get(modal);
    // A later MessageInput autofocus is not a new user choice.
    if (!composing && intent?.target.isConnected && modal.contains(intent.target))
      return intent.target;
    const caption = modal.querySelector('#editable-message-text-modal[contenteditable=true]');
    // Activation after Win+V can leave a framework-selected close/send button active.
    // Until the user interacts with this modal, keep the caption ready for typing.
    if (caption && !interactedMediaModals.has(modal) && !composing) return caption;
    return modal.contains(document.activeElement)
      ? document.activeElement
      : modal.querySelector(
          '[contenteditable=true],textarea,input[type=text],input[type=search],select',
        ) || modal.querySelector('button');
  }
  function focusTarget(target) {
    if (!target?.isConnected) return;
    if (document.activeElement !== target) target.focus({ preventScroll: true });
    if (target.id !== 'editable-message-text-modal' || composing) return;
    const modal = target.closest('.Modal');
    const intent = modal && mediaFocusIntents.get(modal);
    if (
      intent?.target === target &&
      intent.range &&
      target.contains(intent.startNode) &&
      target.contains(intent.endNode) &&
      intent.range.startContainer === intent.startNode &&
      intent.range.startOffset === intent.startOffset &&
      intent.range.endContainer === intent.endNode &&
      intent.range.endOffset === intent.endOffset
    ) {
      const selection = window.getSelection();
      const current = selection?.rangeCount ? selection.getRangeAt(0) : undefined;
      if (
        selection &&
        (!current ||
          current.compareBoundaryPoints(Range.START_TO_START, intent.range) !== 0 ||
          current.compareBoundaryPoints(Range.END_TO_END, intent.range) !== 0)
      ) {
        selection.removeAllRanges();
        selection.addRange(intent.range.cloneRange());
      }
      return;
    }
    if (!modal || interactedMediaModals.has(modal) || positionedMediaModals.has(modal)) return;
    positionedMediaModals.add(modal);
    // Only the initial, untouched caption starts at the end of an inherited draft.
    // Later activation must preserve the user's caret/selection and IME composition.
    const selection = window.getSelection();
    if (selection && target.textContent) {
      const range = document.createRange();
      range.selectNodeContents(target);
      range.collapse(false);
      selection.removeAllRanges();
      selection.addRange(range);
    }
  }
  document.addEventListener('focusin', (event) => {
    if (event.target.matches?.('[contenteditable=true], textarea, input[type=text]')) {
      lastEditor = event.target;
      post({ kind: 'input-ready' });
    }
  });
  // The native host opens its fixed scenario URL rather than the previous hash.
  const lastRoomKey = 'shiye-last-room-v1';
  let startupRoomId;
  try {
    const value = localStorage.getItem(lastRoomKey);
    if (value && /^-?\d+$/.test(value)) startupRoomId = value;
  } catch { /* Existing first-room fallback remains available. */ }
  window.addEventListener('shiye-room-view-ready', () => {
    const id = currentRoomId();
    if (!id || !/^-?\d+$/.test(id)) return;
    try { localStorage.setItem(lastRoomKey, id); }
    catch { /* Room navigation remains usable when storage is unavailable. */ }
  });
  let resumeTimer;
  let startupRequested = false;
  let userInteracted = false;
  for (const type of ['pointerdown', 'keydown', 'input', 'compositionstart'])
    document.addEventListener(
      type,
      () => {
        userInteracted = true;
        cancelRoomSelectionRestore();
        clearInterval(resumeTimer);
      },
      true,
    );
  function hasManualSelection(input) {
    const selection = window.getSelection();
    return (
      selection &&
      !selection.isCollapsed &&
      input?.contains(selection.anchorNode) &&
      input.contains(selection.focusNode)
    );
  }
  // Hot-room text selection is local view state, bounded independently of draft data.
  const roomSelections = new Map();
  let roomSelectionOwner;
  let roomSelectionIntent = 0;
  let roomSwitchIntent = 0;
  let pendingRoomSelection;
  function cancelRoomSelectionRestore() {
    roomSelectionIntent++;
    pendingRoomSelection = undefined;
  }
  function draftSignature(input) {
    const html = input.innerHTML;
    if (!html || html.length > 262144 || input.querySelector('img,video,audio,[data-upload-id]'))
      return undefined;
    let a = 2166136261;
    let b = 5381;
    for (let i = 0; i < html.length; i++) {
      const code = html.charCodeAt(i);
      a = Math.imul(a ^ code, 16777619);
      b = Math.imul(b, 33) ^ code;
    }
    return html.length + ':' + (a >>> 0) + ':' + (b >>> 0);
  }
  function textPath(input, node) {
    if (node?.nodeType !== Node.TEXT_NODE || !input.contains(node)) return undefined;
    const path = [];
    for (let current = node; current !== input; current = current.parentNode) {
      if (!current.parentNode || path.length >= 16) return undefined;
      path.unshift(Array.prototype.indexOf.call(current.parentNode.childNodes, current));
    }
    return path;
  }
  function rememberRoomSelection(input, selection) {
    if (!roomSelectionOwner || pendingRoomSelection || document.activeElement !== input
      || !roomSelectionOwner.startsWith(currentRoomId() + '_')
      || input.closest('.Composer')?.querySelector(':scope > .main-button.edit, .ComposerEmbeddedMessage.open .icon-forward')
      || document.querySelector('dialog[open], .Modal.open')) return;
    const signature = draftSignature(input);
    const anchor = textPath(input, selection.anchorNode);
    const focus = textPath(input, selection.focusNode);
    if (!signature || !anchor || !focus) return;
    roomSelections.delete(roomSelectionOwner);
    roomSelections.set(roomSelectionOwner, {
      signature, anchor, anchorOffset: selection.anchorOffset,
      focus, focusOffset: selection.focusOffset,
      top: input.closest('.input-scroller')?.scrollTop || 0,
    });
    if (roomSelections.size > 64) roomSelections.delete(roomSelections.keys().next().value);
  }
  function restoreRoomSelection() {
    const pending = pendingRoomSelection;
    if (!pending || composing || pending.intent !== roomSelectionIntent
      || pending.key !== roomSelectionOwner
      || !pending.key.startsWith(currentRoomId() + '_')) return;
    const input = document.querySelector('#editable-message-text[contenteditable=true]');
    if (!input?.isConnected || !input.closest('.Transition_slide-active')) return;
    if (document.querySelector('dialog[open], .Modal.open')
      || input.closest('.Composer')?.querySelector(':scope > .main-button.edit, .ComposerEmbeddedMessage.open .icon-forward')) {
      pendingRoomSelection = undefined;
      return;
    }
    const saved = pending.saved;
    if (draftSignature(input) !== saved.signature) {
      pendingRoomSelection = undefined;
      return;
    }
    const find = (path) => path.reduce((node, index) => node?.childNodes[index], input);
    const anchor = find(saved.anchor);
    const focus = find(saved.focus);
    if (anchor?.nodeType !== Node.TEXT_NODE || focus?.nodeType !== Node.TEXT_NODE
      || saved.anchorOffset > anchor.length || saved.focusOffset > focus.length) {
      pendingRoomSelection = undefined;
      return;
    }
    // Restore once after this room's unchanged draft mounts; a new user intent cancels the lease.
    pendingRoomSelection = undefined;
    window.getSelection()?.setBaseAndExtent(anchor, saved.anchorOffset, focus, saved.focusOffset);
    const scroller = input.closest('.input-scroller');
    if (scroller) scroller.scrollTop = saved.top;
  }
  window.addEventListener('pointerdown', rememberComposerSelection, true);
  window.addEventListener('shiye-room-switch-start', () => {
    rememberComposerSelection();
    pendingRoomSelection = undefined;
    roomSelectionOwner = undefined;
    roomSwitchIntent = roomSelectionIntent;
  });
  window.addEventListener('shiye-room-view-ready', ({ detail }) => {
    roomSelectionOwner = typeof detail?.key === 'string' ? detail.key : undefined;
    const saved = roomSelections.get(roomSelectionOwner);
    pendingRoomSelection = saved && roomSwitchIntent === roomSelectionIntent
      ? { key: roomSelectionOwner, saved, intent: roomSelectionIntent } : undefined;
    restoreRoomSelection();
  });
  const composerSelections = new WeakMap();
  function rememberComposerSelection() {
    const input = document.querySelector('#editable-message-text[contenteditable=true]');
    const selection = window.getSelection();
    if (
      composing || !input || !selection?.rangeCount ||
      !input.contains(selection.anchorNode) || !input.contains(selection.focusNode)
    ) return;
    composerSelections.set(input, {
      text: input.textContent,
      anchorNode: selection.anchorNode, anchorOffset: selection.anchorOffset,
      focusNode: selection.focusNode, focusOffset: selection.focusOffset,
    });
    rememberRoomSelection(input, selection);
  }
  document.addEventListener('selectionchange', rememberComposerSelection);
  function restoreInput({ startup = false, preservePosition = false, selectChat = true, hover = false } = {}) {
    clearInterval(resumeTimer);
    if (startup && userInteracted) return;
    let attempts = 0;
    let selected = false;
    let positioned = false;
    let stable = 0;
    const originalInput = document.querySelector('#editable-message-text[contenteditable=true]');
    const keepPosition = hover ||
      (preservePosition && document.activeElement === originalInput) ||
      hasManualSelection(originalInput);
    rememberComposerSelection();
    const position = hover && originalInput && composerSelections.get(originalInput);
    const started = performance.now();
    function focusInput() {
      if (
        ++attempts > 100 ||
        composing ||
        document.querySelector('#MediaViewer, .Menu .bubble.open, #shiye-commands') ||
        (document.body.dataset.shiyeSidebar === 'expanded' &&
          document.activeElement?.closest?.('#LeftColumn'))
      ) {
        clearInterval(resumeTimer);
        return;
      }
      const modal = document.querySelector('dialog[open], .Modal.open');
      const activeEditor = document.activeElement?.matches?.(
        '[contenteditable=true],textarea,input[type=text],input[type=search]',
      )
        ? document.activeElement
        : undefined;
      if (hover && (modal || (activeEditor && activeEditor !== originalInput))) {
        clearInterval(resumeTimer);
        return;
      }
      const input = modal
        ? modalFocusTarget(modal)
        : (!startup && activeEditor) ||
          document.querySelector('#editable-message-text[contenteditable=true]') ||
          (lastEditor?.isConnected ? lastEditor : undefined);
      if (input?.isConnected) {
        if (document.activeElement !== input) {
          focusTarget(input);
          stable = 0;
        } else stable++;
        if (input.id === 'editable-message-text-modal') focusTarget(input);
        if (!positioned && hover && input === originalInput) {
          // Native activation can blur the DOM editor. Restore both caret and selection direction
          // from this same mounted composer, never an unloaded room's node or an old text boundary.
          if (position && position.text === input.textContent &&
              input.contains(position.anchorNode) && input.contains(position.focusNode)) {
            try {
              window.getSelection()?.setBaseAndExtent(
                position.anchorNode, position.anchorOffset, position.focusNode, position.focusOffset,
              );
            } catch { /* The draft changed while hidden; keep its current valid position. */ }
          }
          positioned = true;
        }
        if (!positioned && input.id === 'editable-message-text' && !keepPosition) {
          window.dispatchEvent(new Event('shiye-focus-end'));
          positioned = true;
        }
        post({ kind: 'input-ready' });
        // Teact transitions and WebView activation can restore root focus after our first focus.
        if (stable >= 3 && performance.now() - started >= 700) {
          clearInterval(resumeTimer);
          post({
            kind: 'resume-focused',
            activeElement: document.activeElement?.id || '',
            pageFocused: document.hasFocus(),
          });
        }
        return;
      }
      if (selectChat && !selected) {
        // Wait for an existing room/draft to mount; only choose the first room if none is active.
        const rememberedRoom = startup && startupRoomId && !window.shiyeRoomUi?.currentId()
          ? Array.from(document.querySelectorAll('#LeftColumn .ListItem.Chat .Avatar[data-peer-id]'))
            .find((avatar) => avatar.dataset.peerId === startupRoomId)
          : undefined;
        const chat = rememberedRoom?.closest('.ListItem-button') ||
          document.querySelector('.ListItem.Chat.selected .ListItem-button') ||
          (!window.shiyeRoomUi?.currentId() &&
            document.querySelector('.ListItem.Chat .ListItem-button'));
        if (chat) {
          press(chat);
          selected = true;
        }
      }
    }
    resumeTimer = setInterval(focusInput, 100);
    focusInput();
  }
  window.addEventListener('shiye-resume', () => {
    restoreInput({ preservePosition: true, selectChat: false });
  });
  window.addEventListener('shiye-hotkey-resume', () => restoreInput());
  window.addEventListener('shiye-hover-resume', () => {
    restoreInput({ preservePosition: true, selectChat: false, hover: true });
  });
  window.addEventListener('shiye-startup-focus', () => {
    if (startupRequested) return;
    startupRequested = true;
    restoreInput({ startup: true });
  });
  window.addEventListener('shiye-before-hide', async (event) => {
    try {
      await new Promise((resolve) => setTimeout(resolve, 120));
      window.dispatchEvent(new Event('shiye-flush-draft'));
      await new Promise((resolve) => setTimeout(resolve, 500));
      await roomCommand('flush');
      post({ kind: 'hide-ready', id: event.detail });
    } catch {
      post({ kind: 'hide-ready', id: event.detail, error: '草稿保存未完成' });
    }
  });
  document.addEventListener(
    'keydown',
    (event) => {
      if (document.getElementById('MediaViewer')) {
        if (!event.ctrlKey || event.isComposing) return;
        const label = ['+', '='].includes(event.key)
          ? '放大图片'
          : event.key === '-'
            ? '缩小图片'
            : undefined;
        if (label) {
          event.preventDefault();
          event.stopImmediatePropagation();
          const button = document.querySelector(`#MediaViewer button[aria-label="${label}"]`);
          if (button) press(button);
        }
        return;
      }
      if (!event.ctrlKey || event.altKey || event.isComposing || event.keyCode === 229) return;
      const step = ['+', '=', 'Add'].includes(event.key)
        ? 1
        : ['-', '_', 'Subtract'].includes(event.key)
          ? -1
          : event.key === '0'
            ? 0
            : undefined;
      if (step === undefined) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      post({ kind: 'zoom-step', step });
    },
    true,
  );
  document.addEventListener(
    'wheel',
    (event) => {
      // Telegram's own zoom buttons dispatch Ctrl+wheel on the image stage.
      if (document.getElementById('MediaViewer')) return;
      if (!event.ctrlKey || !event.deltaY) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      post({ kind: 'zoom-step', step: event.deltaY < 0 ? 1 : -1 });
    },
    { capture: true, passive: false },
  );
  window.chrome?.webview?.addEventListener('message', (event) => {
    if (event.data.kind === 'window-state') {
      inputMode = event.data.inputMode;
      desktopState = event.data;
      textScale = Math.max(0.5, Math.min(2.5, Number(event.data.textScale) || 1));
      hasWindowState = true;
      document.documentElement.style.setProperty('--shiye-ui-zoom', '1');
      apply();
    }
    if (event.data.kind === 'desktop-setting-result') {
      window.dispatchEvent(new CustomEvent('shiye-desktop-setting-result', { detail: event.data }));
      if (desktopStatus?.isConnected)
        desktopStatus.textContent = event.data.error || '后台设置已保存';
      if (!event.data.error)
        desktopState = {
          ...desktopState,
          confirmHide: event.data.confirmHide,
        };
    }
  });
  post({ kind: 'get-window-state' });
  const press = (element) => {
    element.dispatchEvent(
      new MouseEvent('mousedown', { bubbles: true, cancelable: true, button: 0 }),
    );
    element.dispatchEvent(
      new MouseEvent('mouseup', { bubbles: true, cancelable: true, button: 0 }),
    );
    element.click();
  };
  let composing = false;
  window.addEventListener(
    'keydown',
    (event) => {
      if (event.key !== 'Escape' || composing || event.isComposing || event.keyCode === 229) return;
      const ownDialog = [...document.querySelectorAll('.shiye-dialog[open]')].at(-1);
      if (ownDialog && !ownDialog.classList.contains('shiye-room-switcher')) {
        event.preventDefault();
        event.stopImmediatePropagation();
        if (ownDialog.dataset.shiyeSettingsPage) {
          if (ownDialog.settingsParent?.isConnected) ownDialog.close('back');
          else requestSettingsClose();
        } else ownDialog.close();
        return;
      }
      const cancel = document.querySelector('.Modal.open .shiye-media-cancel');
      if (cancel) {
        event.preventDefault();
        event.stopImmediatePropagation();
        cancel.click();
      }
    },
    true,
  );
  document.addEventListener(
    'compositionstart',
    () => {
      composing = true;
    },
    true,
  );
  document.addEventListener(
    'compositionend',
    () => {
      composing = false;
    },
    true,
  );
  const mediaObserver = new MutationObserver(() => {
    restoreRoomSelection();
    const wrapper = document.querySelector('[class*=AttachmentModal-module__send-wrapper]');
    if (!wrapper || wrapper.querySelector('.shiye-media-cancel')) return;
    const send = wrapper.querySelector('button');
    const modal = wrapper.closest('.Modal');
    if (!send || !modal) return;
    const cancel = document.createElement('button');
    cancel.type = 'button';
    cancel.className = 'shiye-media-cancel';
    cancel.textContent = '取消';
    cancel.onclick = () => {
      const close = modal.querySelector(
        'button[aria-label="Cancel attachments"], button[aria-label="取消附件"], .modal-absolute-close-button',
      );
      if (close) press(close);
    };
    wrapper.prepend(cancel);
    send.setAttribute('aria-label', '确认发送');
    let attempts = 0;
    let readySince = 0;
    const markInteracted = (event) => {
      interactedMediaModals.add(modal);
      rememberMediaFocus(modal, event.target);
    };
    for (const type of [
      'pointerdown',
      'pointerup',
      'input',
      'keydown',
      'keyup',
      'compositionstart',
      'compositionend',
    ])
      modal.addEventListener(type, markInteracted, true);
    const focus = setInterval(() => {
      if (!send.isConnected || attempts++ > 40) {
        clearInterval(focus);
        return;
      }
      const caption = modal.querySelector('#editable-message-text-modal[contenteditable=true]');
      if (!send.disabled && !composing && caption) {
        if (!readySince) readySince = Date.now();
        if (!interactedMediaModals.has(modal)) focusTarget(caption);
        if (Date.now() - readySince < 500) return;
        clearInterval(focus);
      } else readySince = 0;
    }, 100);
    modal.addEventListener(
      'keydown',
      (event) => {
        if (composing || event.isComposing || event.keyCode === 229) return;
        const onButtons = event.target === send || event.target === cancel;
        if (onButtons && ['ArrowLeft', 'ArrowRight'].includes(event.key)) {
          event.preventDefault();
          event.stopImmediatePropagation();
          const target = event.key === 'ArrowLeft' ? cancel : send;
          target.focus();
          rememberMediaFocus(modal, target);
        } else if (
          event.key === 'Enter' &&
          !event.shiftKey &&
          !event.altKey &&
          !event.ctrlKey &&
          !event.metaKey &&
          (onButtons || event.target.closest?.('#editable-message-text-modal'))
        ) {
          event.preventDefault();
          event.stopImmediatePropagation();
          if (event.target === cancel) cancel.click();
          else if (!send.disabled) press(send);
        } else if (event.key === 'Escape') {
          event.preventDefault();
          event.stopImmediatePropagation();
          cancel.click();
        }
      },
      true,
    );
  });
  mediaObserver.observe(document.body, { childList: true, subtree: true });
  const diagnostics = new BroadcastChannel('shiye-preview-diagnostics');
  diagnostics.onmessage = (event) =>
    window.chrome?.webview?.postMessage({ kind: 'local-api', ...event.data });
  const key = 'shiye-preview-appearance-v1';
  let saved = {};
  try {
    saved = JSON.parse(localStorage.getItem(key) || '{}');
  } catch {
    /* Keep defaults. */
  }
  const settings = {
    theme: 'dark',
    shade: 0.9,
    bubble: 0.98,
    radius: 14,
    messageGap: 10,
    timeZone: 'Asia/Shanghai',
    sidebarCollapsed: false,
    ...saved,
  };
  const roomAppearanceKey = 'shiye-room-appearance-v1';
  let roomAppearances = {};
  try {
    roomAppearances = JSON.parse(localStorage.getItem(roomAppearanceKey) || '{}') || {};
  } catch {
    /* Inherit global defaults. */
  }
  const appearanceFields = {
    shade: [0.1, 1],
    bubble: [0.25, 1],
    radius: [4, 24],
    messageGap: [4, 28],
    fontSize: [14, 24],
    inputFontSize: [7, 60],
  };
  const appearanceChoices = {
    theme: ['dark', 'light'],
    font: ['yahei', 'system', 'serif', 'mono'],
    messageAlign: ['right', 'left'],
    messageRenderMode: ['instant', 'smooth', 'legacy'],
  };
  let globalMessageRenderMode = 'instant';
  try {
    const value = localStorage.getItem('shiye-message-render-mode');
    if (appearanceChoices.messageRenderMode.includes(value)) globalMessageRenderMode = value;
  } catch { /* Keep the original global default when storage is unavailable. */ }
  function globalAppearance() {
    return { font: 'yahei', fontSize: 16, messageAlign: 'right', ...settings,
      inputFontSize: globalInputFontSize(), messageRenderMode: globalMessageRenderMode };
  }
  function effectiveAppearance(id = currentRoomId()) {
    const raw = roomAppearances[id] || {};
    const effective = globalAppearance();
    for (const [field, [min, max]] of Object.entries(appearanceFields))
      if (Number.isFinite(raw[field])) effective[field] = Math.max(min, Math.min(max, raw[field]));
    for (const [field, choices] of Object.entries(appearanceChoices))
      if (choices.includes(raw[field])) effective[field] = raw[field];
    return effective;
  }
  function globalInputFontSize() {
    const stored = Number(settings.inputFontSize);
    if (Number.isFinite(stored) && stored >= 7 && stored <= 60) return stored;
    const base = Number(settings.fontSize) || 16;
    const migrated = Math.max(7, Math.min(60, base * textScale));
    if (!window.chrome?.webview || hasWindowState) {
      settings.inputFontSize = migrated;
      persist();
    }
    return migrated;
  }
  const inputFontSize = () => globalInputFontSize();
  function apply() {
    const appearance = effectiveAppearance();
    document.documentElement.lang = 'zh-CN';
    document.body.dataset.shiyeTheme = appearance.theme;
    document.body.dataset.shiyeAlign = appearance.messageAlign === 'left' ? 'left' : 'right';
    document.body.dataset.shiyeShowSendButton = String(settings.showSendButton !== false);
    document.body.dataset.shiyeSidebar = settings.sidebarCollapsed ? 'collapsed' : 'expanded';
    const toggle = document.querySelector('.shiye-sidebar-fallback');
    if (toggle) {
      toggle.setAttribute('aria-expanded', String(!settings.sidebarCollapsed));
      toggle.setAttribute(
        'aria-label',
        settings.sidebarCollapsed ? '展开会话列表' : '折叠会话列表',
      );
      toggle.title = toggle.getAttribute('aria-label');
    }
    const fonts = {
      yahei: '"Microsoft YaHei UI", "PingFang SC", sans-serif',
      system: 'system-ui, "Microsoft YaHei UI", sans-serif',
      serif: '"Noto Serif CJK SC", SimSun, serif',
      mono: 'Consolas, "Microsoft YaHei UI", monospace',
    };
    document.body.style.setProperty('--font-family', fonts[appearance.font || 'yahei']);
    document.body.style.setProperty(
      '--shiye-message-size',
      appearance.fontSize * textScale + 'px',
    );
    document.body.style.setProperty('--shiye-input-size', appearance.inputFontSize + 'px');
    document.body.style.setProperty('--shiye-shade', appearance.shade);
    document.body.style.setProperty('--shiye-bubble', appearance.bubble);
    document.body.style.setProperty('--shiye-radius', appearance.radius + 'px');
    document.body.style.setProperty('--shiye-message-gap', (appearance.messageGap ?? 10) + 'px');
    window.dispatchEvent(new CustomEvent('shiye-message-render-mode-changed', {
      detail: appearance.messageRenderMode,
    }));
    for (const page of settingsSession?.pages.values() || []) page.settingsAppearanceRefresh?.();
    if (!document.body.dataset.shiyeRoomWallpaper && (wallpaperUrl || settings.wallpaper))
      document.body.style.setProperty(
        '--shiye-wallpaper',
        `url("${wallpaperUrl || settings.wallpaper}")`,
      );
    else if (!document.body.dataset.shiyeRoomWallpaper)
      document.body.style.removeProperty('--shiye-wallpaper');
  }
  let wallpaperUrl;
  function persist() {
    localStorage.setItem(key, JSON.stringify(settings));
  }
  async function restoreWallpaper() {
    try {
      if (settings.wallpaper?.startsWith('data:')) {
        const blob = await (await fetch(settings.wallpaper)).blob();
        await window.shiyeLocalAssets.put({ id: 'wallpaper', blob });
        delete settings.wallpaper;
        persist();
      }
      const asset = await window.shiyeLocalAssets.get('wallpaper');
      if (asset?.blob) {
        if (wallpaperUrl) URL.revokeObjectURL(wallpaperUrl);
        wallpaperUrl = URL.createObjectURL(asset.blob);
        apply();
      }
    } catch {
      /* Keep the legacy background if migration cannot be committed. */
    }
  }
  let settingsSession;
  function dialog(title, content, options) {
    if (options?.page) return settingsPage(title, content, options);
    const element = document.createElement('dialog');
    element.className = 'shiye-dialog';
    element.setAttribute('data-stricterdom-ignore', '');
    element.innerHTML = `<header><h2>${title}</h2><button aria-label="关闭">×</button></header>${content}`;
    element.querySelector('header button').onclick = () => element.close();
    element.addEventListener('close', () => element.remove(), { once: true });
    document.body.append(element);
    element.showModal();
    return element;
  }
  function activateSettingsPage(element) {
    const session = settingsSession;
    if (!session) return;
    const ancestors = new Set();
    for (let page = element; page; page = page.settingsParent) ancestors.add(page);
    for (const page of session.pages.values())
      if (page.open && !ancestors.has(page)) page.close('route');
    for (const page of session.pages.values())
      page.dataset.settingsActive = String(page === element);
    session.active = element;
    if (!element.open) element.showModal();
  }
  function settingsPage(title, content, options) {
    settingsSession ||= {
      pages: new Map(),
      active: undefined,
      disposing: false,
      saving: false,
      previous: document.activeElement,
      sidebarContext: document.body.dataset.shiyeSidebar === 'expanded'
        ? {
            roomId: currentRoomId(),
            list: document.querySelector('#LeftColumn .chat-list.custom-scroll'),
            scrollTop: document.querySelector('#LeftColumn .chat-list.custom-scroll')?.scrollTop,
          }
        : undefined,
    };
    const session = settingsSession;
    const cached = session.pages.get(options.page);
    if (cached) {
      if (
        options.parent !== undefined ||
        (options.page.startsWith('room-') && session.active !== cached)
      )
        cached.settingsParent =
          options.parent === undefined ? session.active : options.parent || undefined;
      cached.dataset.settingsRestored = 'true';
      activateSettingsPage(cached);
      cached.settingsResume?.();
      return cached;
    }
    const parent = options.parent === undefined ? session.active : options.parent || undefined;
    const previous = document.activeElement;
    const element = document.createElement('dialog');
    element.settingsParent = parent;
    element.className = 'shiye-dialog shiye-settings-dialog';
    element.dataset.shiyeSettingsPage = options.page;
    element.dataset.settingsRestored = 'false';
    element.setAttribute('aria-label', title);
    element.setAttribute('data-stricterdom-ignore', '');
    element.innerHTML = `<header><h2>${title}</h2><button type="button" aria-label="关闭设置">×</button></header><div data-settings-body>${content}</div><footer data-settings-actions></footer>`;
    const header = element.querySelector('header');
    const body = element.querySelector('[data-settings-body]');
    const actions = element.querySelector('[data-settings-actions]');
    if (parent) {
      const back = document.createElement('button');
      back.type = 'button';
      back.dataset.settingsBack = '';
      back.className = 'shiye-settings-back';
      back.textContent = '‹ 返回';
      back.onclick = () => element.close('back');
      header.prepend(back);
    } else if (session.sidebarContext) {
      const back = document.createElement('button');
      back.type = 'button';
      back.dataset.settingsBack = '';
      back.className = 'shiye-settings-back';
      back.textContent = '‹ 返回会话列表';
      back.onclick = requestSettingsClose;
      header.prepend(back);
    }
    header.querySelector('button[aria-label]').onclick = requestSettingsClose;
    const existing = body.querySelector(':scope > .shiye-actions');
    if (existing)
      queueMicrotask(() => {
        if (element.isConnected && settingsSession === session) actions.prepend(existing);
      });
    if (options.page !== 'root' && !existing && !options.explicit) {
      const done = document.createElement('button');
      done.type = 'button';
      done.textContent = '完成返回';
      done.onclick = () => (parent ? element.close('back') : requestSettingsClose());
      actions.append(done);
    }
    if (options.page !== 'root' && !options.explicit && options.autosave !== false) {
      const note = document.createElement('span');
      note.className = 'shiye-settings-autosave';
      note.textContent = '更改自动保存';
      actions.prepend(note);
    }
    const close = document.createElement('button');
    close.type = 'button';
    close.dataset.settingsClose = '';
    close.textContent = '关闭设置';
    close.onclick = requestSettingsClose;
    actions.append(close);
    element.addEventListener('cancel', (event) => {
      event.preventDefault();
      if (parent) element.close('back');
      else requestSettingsClose();
    });
    element.addEventListener('close', () => {
      if (session.disposing || session.saving || element.returnValue === 'route') return;
      element.querySelector('[data-settings-leave-confirm]')?.remove();
      if (element.returnValue === 'discard' || element.returnValue === 'saved') {
        session.pages.delete(options.page);
        element.remove();
      }
      const returnParent = element.settingsParent;
      if (returnParent?.isConnected) {
        activateSettingsPage(returnParent);
        if (previous?.isConnected && returnParent.contains(previous))
          previous.focus({ preventScroll: true });
      } else requestSettingsClose();
    });
    session.pages.set(options.page, element);
    document.body.append(element);
    activateSettingsPage(element);
    return element;
  }
  function markSettingsSaved(element) {
    element.dataset.settingsDirty = 'false';
    const form = element.querySelector('form');
    if (form) form.dataset.dirty = 'false';
  }
  function bindSettingsForm(element, form, roomLayout = false) {
    form.id ||= 'shiye-settings-form-' + element.dataset.shiyeSettingsPage;
    const original = form.onsubmit;
    form.onsubmit = (event) => {
      element.settingsSavePromise = Promise.resolve(original.call(form, event));
      return element.settingsSavePromise;
    };
    element.settingsSave = async () => {
      activateSettingsPage(element);
      if (!form.reportValidity()) return false;
      element.settingsSavePromise = undefined;
      form.requestSubmit();
      await element.settingsSavePromise;
      return element.dataset.settingsDirty !== 'true' && form.dataset.dirty !== 'true';
    };
    form.addEventListener('input', () => {
      element.dataset.settingsDirty = 'true';
    });
    form.addEventListener('change', (event) => {
      if (event.target.name !== 'id') element.dataset.settingsDirty = 'true';
    });
    if (roomLayout) {
      const outerBody = element.querySelector('[data-settings-body]');
      const outerActions = element.querySelector('[data-settings-actions]');
      const parameters = form.querySelector('.shiye-room-settings-parameters');
      const actions = form.querySelector('.shiye-room-settings-actions');
      parameters.dataset.settingsBody = '';
      actions.dataset.settingsActions = '';
      actions.append(outerActions.querySelector('[data-settings-close]'));
      element.insertBefore(form, outerBody);
      outerBody.remove();
      outerActions.remove();
    } else {
      const actions = element.querySelector('[data-settings-actions]');
      for (const button of form.querySelectorAll('.shiye-actions button[type="submit"]')) {
        button.setAttribute('form', form.id);
        actions.prepend(button);
      }
    }
  }
  function disposeSettings() {
    const session = settingsSession;
    if (!session) return;
    session.disposing = true;
    for (const page of session.pages.values()) {
      page.settingsCleanup?.();
      if (page.open) page.close('session-close');
      page.remove();
    }
    session.pages.clear();
    settingsSession = undefined;
    if (desktopStatus?.closest('.shiye-settings-dialog')) desktopStatus = undefined;
    const sidebar = session.sidebarContext;
    if (sidebar && sidebar.roomId === currentRoomId()) {
      setSidebar(false);
      if (sidebar.list?.isConnected && Number.isFinite(sidebar.scrollTop))
        sidebar.list.scrollTop = sidebar.scrollTop;
    }
    if (session.previous?.isConnected) session.previous.focus({ preventScroll: true });
  }
  function requestSettingsClose() {
    const session = settingsSession;
    if (!session || session.disposing || session.saving) return;
    const dirty = [...session.pages.values()].filter(
      (page) =>
        page.dataset.settingsDirty === 'true' || page.querySelector('form[data-dirty="true"]'),
    );
    if (!dirty.length) return disposeSettings();
    const current = session.active;
    if (!current.open) activateSettingsPage(current);
    if (current.querySelector('[data-settings-leave-confirm]')) return;
    const confirm = document.createElement('section');
    confirm.dataset.settingsLeaveConfirm = '';
    confirm.setAttribute('role', 'alert');
    confirm.innerHTML =
      '<p>有未保存的更改。关闭前请选择：</p><button type="button" data-save-close>保存并关闭</button><button type="button" data-discard-close>放弃更改</button><button type="button" data-continue>继续编辑</button><p role="status"></p>';
    current.querySelector('[data-settings-actions]').append(confirm);
    confirm.querySelector('[data-continue]').onclick = () => confirm.remove();
    confirm.querySelector('[data-discard-close]').onclick = disposeSettings;
    confirm.querySelector('[data-save-close]').onclick = async () => {
      if (session.saving) return;
      session.saving = true;
      for (const button of confirm.querySelectorAll('button')) button.disabled = true;
      try {
        for (const page of dirty) {
          if (!page.settingsSave || !(await page.settingsSave())) {
            activateSettingsPage(page);
            confirm.remove();
            return;
          }
        }
        disposeSettings();
      } catch {
        confirm.querySelector('[role=status]').textContent = '保存未完成，请继续编辑后重试';
      } finally {
        session.saving = false;
        for (const button of confirm.querySelectorAll('button')) button.disabled = false;
      }
    };
  }
  window.shiyeSettingsUi = {
    open: (options) => settingsPage(options.title, options.content, options),
    bindForm: bindSettingsForm,
    saved: markSettingsSaved,
    active: () => settingsSession?.active,
  };

  const roomChannel = new BroadcastChannel('shiye-local-rooms');
  const requests = new Map();
  let localStoreReady = false;
  window.shiyeLocalStoreReady = false;
  let rooms = [];
  roomChannel.onmessage = ({ data }) => {
    const pending = requests.get(data.requestId);
    if (!pending) return;
    requests.delete(data.requestId);
    clearTimeout(pending.timer);
    clearInterval(pending.retry);
    if (data.error) pending.reject(Error(data.error));
    else {
      if (data.rooms) {
        if (!localStoreReady) {
          localStoreReady = true;
          window.shiyeLocalStoreReady = true;
          post({ kind: 'local-store-ready' });
        }
        rooms = data.rooms;
        window.dispatchEvent(new CustomEvent('shiye-rooms-changed', { detail: rooms }));
      }
      pending.resolve(data);
    }
  };
  function roomCommand(action, fields = {}) {
    return new Promise((resolve, reject) => {
      const requestId = crypto.randomUUID();
      const timer = setTimeout(() => {
        clearInterval(requests.get(requestId)?.retry);
        requests.delete(requestId);
        reject(Error('本地话题尚未就绪，请稍后再试'));
      }, 10000);
      const retry = ['list', 'flush', 'program-feed', 'program-bindings'].includes(action)
        ? setInterval(() => roomChannel.postMessage({ action, requestId, ...fields }), 500)
        : undefined;
      requests.set(requestId, { resolve, reject, timer, retry });
      roomChannel.postMessage({ action, requestId, ...fields });
    });
  }
  function currentRoomId() {
    let id;
    const listener = (event) => {
      id = event.detail.id;
    };
    window.addEventListener('shiye-current-room-result', listener, { once: true });
    window.dispatchEvent(new Event('shiye-current-room'));
    window.removeEventListener('shiye-current-room-result', listener);
    return id;
  }
  function openMessageSearch(scope = 'all') {
    if (document.querySelector('.shiye-search-dialog[open]')) return;
    const element = dialog(
      '搜索聊天记录',
      '<form class="shiye-search-form"><label>关键词<input name="query" type="search" maxlength="300" placeholder="搜索消息中的文字" autocomplete="off"></label><label>搜索范围<select name="scope"><option value="all">全部话题</option><option value="current">当前话题</option></select></label><button type="submit">搜索</button></form><p role="status">输入文字，查找之前的消息。</p><div class="shiye-search-results"></div><button data-search-more hidden>加载更多</button>',
    );
    element.classList.add('shiye-search-dialog');
    const form = element.querySelector('form');
    const queryInput = form.elements.query;
    const status = element.querySelector('[role=status]');
    const results = element.querySelector('.shiye-search-results');
    const more = element.querySelector('[data-search-more]');
    const currentId = currentRoomId();
    if (scope === 'current' && currentId) form.elements.scope.value = 'current';
    let offset = 0,
      sequence = 0,
      timer;
    async function search(append = false) {
      const query = queryInput.value.trim();
      const ticket = ++sequence;
      if (!append) {
        offset = 0;
        results.replaceChildren();
      }
      more.hidden = true;
      if (!query) {
        status.textContent = '输入文字，查找之前的消息。';
        return;
      }
      if (form.elements.scope.value === 'current' && !currentId) {
        status.textContent = '请先打开一个话题。';
        return;
      }
      status.textContent = '正在搜索本地记录…';
      try {
        const found = await roomCommand('search', {
          query,
          offset,
          chatId: form.elements.scope.value === 'current' ? currentId : undefined,
        });
        if (ticket !== sequence || !element.open) return;
        status.textContent = found.total ? `找到 ${found.total} 条相关消息` : '没有找到相关消息';
        for (const message of found.matches) {
          const button = document.createElement('button');
          button.className = 'shiye-search-result';
          const meta = document.createElement('small');
          meta.textContent = `${message.title} · ${message.author} · ${new Intl.DateTimeFormat('zh-CN', { dateStyle: 'short', timeStyle: 'short', timeZone: settings.timeZone === 'system' ? undefined : settings.timeZone }).format(new Date(message.date * 1000))}`;
          const text = document.createElement('p');
          text.textContent = message.text;
          button.append(meta, text);
          button.onclick = () => {
            element.close();
            window.dispatchEvent(
              new CustomEvent('shiye-focus-message', {
                detail: { chatId: message.chatId, messageId: message.messageId },
              }),
            );
          };
          results.append(button);
        }
        offset += found.matches.length;
        more.hidden = offset >= found.total;
      } catch (error) {
        if (ticket === sequence) status.textContent = error.message;
      }
    }
    form.onsubmit = (event) => {
      event.preventDefault();
      clearTimeout(timer);
      search();
    };
    queryInput.oninput = () => {
      clearTimeout(timer);
      timer = setTimeout(() => search(), 250);
    };
    form.elements.scope.onchange = () => search();
    more.onclick = () => {
      more.disabled = true;
      search(true).finally(() => {
        more.disabled = false;
      });
    };
    element.addEventListener(
      'close',
      () => {
        clearTimeout(timer);
        sequence++;
      },
      { once: true },
    );
    queryInput.focus();
  }
  window.addEventListener('shiye-open-search', () => openMessageSearch());
  document.addEventListener(
    'keydown',
    (event) => {
      if (
        (event.ctrlKey || event.metaKey) &&
        !event.altKey &&
        !event.shiftKey &&
        event.key.toLowerCase() === 'f' &&
        !composing &&
        !event.isComposing &&
        event.keyCode !== 229
      ) {
        event.preventDefault();
        event.stopImmediatePropagation();
        if (!document.querySelector('.shiye-search-dialog[open]')) openMessageSearch();
      }
    },
    true,
  );
  async function openRoomSettings(isNew = false, requestedId) {
    const previousId = currentRoomId();
    const targetId = requestedId || previousId;
    const element = dialog(
      isNew ? '新建话题' : '对话设置',
      '<p role="status">正在读取本地话题…</p>',
      { page: isNew ? 'room-new' : 'room-' + (targetId || 'current'), explicit: true },
    );

    if (element.dataset.settingsRestored === 'true') return;
    try {
      await roomCommand('list');
      const journalStatus = await window.shiyeJournal.status();
      if (!element.isConnected) return;
      const selectedId = targetId;
      const current =
        rooms.find((room) => room.id === selectedId) || (requestedId ? undefined : rooms[0]);
      if (requestedId && !current) throw Error('这个对话已不存在，请重新选择');
      const form = document.createElement('form');
      form.innerHTML = `${isNew ? '' : '<label>选择话题<select name="id"></select></label>'}<label>对话壁纸（同时作为头像）<input name="wallpaper" type="file" accept="image/png,image/jpeg,image/webp,image/gif"></label><img class="shiye-room-wallpaper-preview" alt="壁纸与头像预览" hidden><p class="shiye-wallpaper-hint">不选则沿用默认背景；可以之后在对话设置中更换。</p><label>话题名称<input name="title" required maxlength="80" placeholder="例如：随手记、工作想法"></label><label>记录形式<select name="kind"><option value="session">个人记录 · 自己的空间</option><option value="group">群聊式记录 · 可接入机器人和服务</option></select></label><label>拾页分类<select name="category"><option value="">请选择分类</option></select></label><label><input name="archiveEnabled" type="checkbox">自动归入拾页日记</label><label>话题说明<textarea name="description" maxlength="2000" rows="3"></textarea></label><label>机器人与服务接入计划<textarea name="servicePlan" maxlength="1000" rows="2" placeholder="例如：往日回顾、倒计时提醒、AI 写作助手"></textarea></label><p>这里先保存接入计划。后端服务尚未连接，不会发送内容或执行任务。</p><label>无新消息的归篇间隔（小时）<input name="idleHours" type="number" min="0.1" max="8760" step="0.1" value="5" required></label><p>消息立即保存在本机，再自动写入拾页。持续发送接在同一篇，空闲满此时限后截断；下次消息另起一篇。默认 5 小时，修改时限从下一篇生效。</p><fieldset><legend>参与者</legend><p>我 · 当前记录者</p><p>机器人、往日回顾、提醒程序：后续接入。目前不会自动发送消息。</p></fieldset><p>分类读取拾页现有列表。首次启用会归档本对话已有的实际消息（排除内置演示）；关闭自动归档不会删除已保存日记。改变分类从下一条消息另起一篇。</p><p role="status" class="shiye-form-status"></p><div class="shiye-actions"><button type="button" data-cancel>取消</button><button type="submit">${isNew ? '创建话题' : '保存设置'}</button></div>`;
      const field = (name) => form.elements.namedItem(name);
      const plan = field('servicePlan').closest('label');
      plan.firstChild.textContent = '程序接入备注（可选）';
      plan.nextElementSibling.textContent =
        '这里只保存备注；实际程序开关与规则在上方“程序与服务”中设置。';
      const participantsHint = form.querySelector('fieldset p:last-child');
      participantsHint.textContent = '本会话接入的程序及参数在“程序与服务”中管理。';
      const appearanceSection = document.createElement('fieldset');
      appearanceSection.className = 'shiye-room-appearance';
      appearanceSection.innerHTML =
        '<legend>本对话外观</legend><p>默认逐项跟随全局；只调整需要微调的项目。更改在保存设置后生效。</p>';
      form.querySelector('.shiye-actions').before(appearanceSection);
      const appearanceInputs = {
        theme: 'roomTheme',
        shade: 'roomShade',
        bubble: 'roomBubble',
        radius: 'roomRadius',
        messageGap: 'roomMessageGap',
        font: 'roomFont',
        fontSize: 'roomFontSize',
        inputFontSize: 'roomInputFontSize',
        messageAlign: 'roomMessageAlign',
        messageRenderMode: 'roomMessageRenderMode',
      };
      const appearanceTitles = { theme: '明暗模式', shade: '背景遮罩', bubble: '气泡不透明度',
        radius: '气泡圆角', messageGap: '消息间距', font: '字体', fontSize: '消息字号',
        inputFontSize: '输入字号（独立）', messageAlign: '消息位置', messageRenderMode: '发送动效' };
      const choiceTitles = { dark: '深色', light: '浅色', yahei: '微软雅黑 / 苹方', system: '系统字体',
        serif: '衬线', mono: '等宽', right: '靠右', left: '靠左', instant: '即时显示',
        smooth: '从输入框发出', legacy: '原平滑过渡' };
      const appearanceModes = {}, appearanceOutputs = {};
      const describeAppearance = (key, value) => choiceTitles[value] ||
        (['shade', 'bubble'].includes(key) ? `${Math.round(Number(value) * 100)}%` :
          ['fontSize', 'inputFontSize', 'radius', 'messageGap'].includes(key) ? `${value} px` : String(value));
      function updateAppearanceField(key) {
        const following = appearanceModes[key].value === 'inherit';
        const control = field(appearanceInputs[key]);
        if (following) control.value = String(globalAppearance()[key]);
        control.disabled = following;
        appearanceOutputs[key].textContent = `${following ? '跟随全局' : '自定义'} · 当前：${describeAppearance(key, control.value)}`;
      }
      for (const [key, name] of Object.entries(appearanceInputs)) {
        const row = document.createElement('div');
        row.dataset.appearanceField = key;
        const modeLabel = document.createElement('label');
        modeLabel.textContent = appearanceTitles[key] + ' · 来源';
        const mode = document.createElement('select');
        mode.name = name + 'Mode';
        mode.add(new Option('跟随全局', 'inherit'));
        mode.add(new Option('自定义', 'override'));
        appearanceModes[key] = mode;
        modeLabel.append(mode);
        const valueLabel = document.createElement('label');
        valueLabel.textContent = appearanceTitles[key];
        const control = document.createElement(appearanceChoices[key] ? 'select' : 'input');
        control.name = name;
        if (appearanceChoices[key])
          for (const value of appearanceChoices[key]) control.add(new Option(choiceTitles[value], value));
        else {
          control.type = 'range';
          [control.min, control.max] = appearanceFields[key].map(String);
          control.step = ['shade', 'bubble', 'inputFontSize'].includes(key) ? '0.01' : '1';
        }
        valueLabel.append(control);
        const output = document.createElement('output');
        appearanceOutputs[key] = output;
        const reset = document.createElement('button');
        reset.type = 'button';
        reset.dataset.appearanceRestore = key;
        reset.textContent = '恢复跟随全局';
        reset.onclick = () => {
          mode.value = 'inherit';
          mode.dispatchEvent(new Event('change', { bubbles: true }));
        };
        mode.onchange = () => updateAppearanceField(key);
        control.oninput = () => updateAppearanceField(key);
        row.append(modeLabel, valueLabel, output, reset);
        appearanceSection.append(row);
      }
      const restoreAll = document.createElement('button');
      restoreAll.type = 'button';
      restoreAll.dataset.appearanceRestoreAll = '';
      restoreAll.textContent = '全部恢复跟随全局';
      restoreAll.onclick = () => {
        for (const key of Object.keys(appearanceInputs)) {
          appearanceModes[key].value = 'inherit';
          updateAppearanceField(key);
        }
        restoreAll.dispatchEvent(new Event('input', { bubbles: true }));
      };
      appearanceSection.append(restoreAll);
      function fillAppearance(id) {
        const appearance = effectiveAppearance(id);
        const raw = roomAppearances[id] || {};
        for (const [key, name] of Object.entries(appearanceInputs)) {
          appearanceModes[key].value = Object.hasOwn(raw, key) ? 'override' : 'inherit';
          field(name).value = appearance[key];
          updateAppearanceField(key);
        }
      }
      element.settingsAppearanceRefresh = () => {
        for (const key of Object.keys(appearanceInputs)) updateAppearanceField(key);
      };
      fillAppearance(null);
      for (const category of new Set([
        ...journalStatus.categories,
        ...Object.values(journalStatus.rooms)
          .map((link) => link.category)
          .filter(Boolean),
        ...rooms.map((room) => room.category).filter(Boolean),
      ]))
        field('category').add(new Option(category, category));
      const fill = (room) => {
        fillAppearance(room.id);
        const link = journalStatus.rooms[room.id];
        field('archiveEnabled').checked = !!link?.enabled;
        window.dispatchEvent(
          new CustomEvent('shiye-room-wallpaper-preview', { detail: { form, room } }),
        );
        for (const name of ['title', 'kind', 'category', 'description', 'servicePlan', 'idleHours'])
          field(name).value =
            (name === 'category' ? link?.category || room[name] : room[name]) ?? '';
        window.dispatchEvent(
          new CustomEvent('shiye-room-state-controls', { detail: { form, room } }),
        );
      };
      if (isNew) {
        field('archiveEnabled').checked = true;
        field('category').value = journalStatus.categories[0] || '';
      }
      if (journalStatus.lastError)
        form.querySelector('.shiye-form-status').textContent =
          journalStatus.lastError + '；可在设置 → 日记归档与保存状态中连接或解锁。';
      if (!isNew) {
        for (const room of rooms) field('id').add(new Option(room.title, room.id));
        if (current) {
          field('id').value = current.id;
          fill(current);
        }
        field('id').onchange = () => fill(rooms.find((room) => room.id === field('id').value));
      }
      element.classList.add('shiye-room-settings-dialog');
      form.className = 'shiye-room-settings-form';
      const actions = form.querySelector('.shiye-actions');
      const status = form.querySelector('.shiye-form-status');
      const parameters = document.createElement('div');
      parameters.className = 'shiye-room-settings-parameters';
      for (const child of [...form.children])
        if (child !== actions && child !== status) parameters.append(child);
      const actionBar = document.createElement('footer');
      actionBar.className = 'shiye-room-settings-actions';
      actionBar.append(status, actions);
      form.replaceChildren(parameters, actionBar);
      const markDirty = (event) => {
        if (event.target.name === 'id') return;
        form.dataset.dirty = 'true';
        status.textContent = '有未保存的更改';
      };
      form.addEventListener('input', markDirty);
      form.addEventListener('change', markDirty);
      element.querySelector('[role=status]').replaceWith(form);
      if (!isNew && current) {
        element.querySelector('h2').textContent = '对话设置 · ' + current.title;
        field('id').closest('label').hidden = true;
      }
      form.querySelector('[data-cancel]').onclick = () => element.close('discard');
      window.dispatchEvent(
        new CustomEvent('shiye-room-wallpaper-preview', {
          detail: { form, room: isNew ? undefined : current },
        }),
      );
      if (!isNew && current)
        window.dispatchEvent(
          new CustomEvent('shiye-room-state-controls', { detail: { form, room: current } }),
        );
      const serviceAnchor = document.createElement('div');
      field('kind').closest('label').after(serviceAnchor);
      const servicesUi =
        await import('./shiye-conversation-services-ui.js?v=20261019-atomic-ui45');
      if (!element.isConnected) return;
      const services = servicesUi.mountRoomServices({
        room: isNew ? { id: null, title: '新会话' } : current,
        parent: element,
        container: serviceAnchor,
        categories: journalStatus.categories,
      });
      element.settingsCleanup = () => services.dispose();
      element.addEventListener('close', () => {
        if (['saved', 'discard'].includes(element.returnValue)) services.dispose();
      });
      element.settingsResume = () => services.refresh();
      if (!isNew && String(current?.id) === '-900000001') {
        field('title').readOnly = true;
        field('title').title = '现有程序会同步名称，请在下方朝花夕拾设置里调整回看标题';
        field('archiveEnabled').closest('label').hidden = true;
        field('idleHours').closest('label').hidden = true;
      }
      form.onsubmit = async (event) => {
        event.preventDefault();
        const button = form.querySelector('[type=submit]');
        button.disabled = true;
        status.textContent = '正在保存…';
        try {
          const fields = Object.fromEntries(new FormData(form));
          const previousLink = journalStatus.rooms[fields.id];
          const previousCategory =
            previousLink?.category || rooms.find((room) => room.id === fields.id)?.category || '';
          const archiveChanged =
            field('archiveEnabled').checked !== Boolean(previousLink?.enabled) ||
            (fields.category || '') !== previousCategory;
          for (const name of Object.values(appearanceInputs)) {
            delete fields[name];
            delete fields[name + 'Mode'];
          }
          if (field('archiveEnabled').checked && !fields.category)
            throw Error('请先选择拾页分类；日记库不可用时可先关闭自动归档');
          const image = field('wallpaper').files[0];
          if (image) {
            await window.shiyeRoomWorkspace.validateImage(image);
            const assetId = 'wallpaper:room:' + crypto.randomUUID();
            await window.shiyeLocalAssets.put({ id: assetId, name: image.name, blob: image });
            fields.wallpaperAssetId = assetId;
          }
          delete fields.wallpaper;
          const result = await roomCommand(isNew ? 'create' : 'update', fields);
          if (isNew) {
            isNew = false;
            const option = document.createElement('select');
            option.name = 'id';
            option.hidden = true;
            option.add(new Option(fields.title, result.id));
            form.append(option);
          }
          if (archiveChanged)
            await window.shiyeJournal.configure(
              result.id,
              field('archiveEnabled').checked,
              fields.category,
            );
          const nextRoomAppearances = JSON.parse(localStorage.getItem(roomAppearanceKey) || '{}');
          const nextAppearance = { ...(nextRoomAppearances[result.id] || {}) };
          for (const [key, name] of Object.entries(appearanceInputs)) {
            if (appearanceModes[key].value === 'inherit') delete nextAppearance[key];
            else nextAppearance[key] = appearanceChoices[key] ? field(name).value : Number(field(name).value);
          }
          if (Object.keys(nextAppearance).length) nextRoomAppearances[result.id] = nextAppearance;
          else delete nextRoomAppearances[result.id];
          localStorage.setItem(roomAppearanceKey, JSON.stringify(nextRoomAppearances));
          roomAppearances = nextRoomAppearances;
          apply();
          window.dispatchEvent(
            new CustomEvent('shiye-refresh-rooms', {
              detail: { id: requestedId ? previousId : result.id },
            }),
          );
          markSettingsSaved(element);
          status.textContent = '已保存';
          element.close('saved');
        } catch (error) {
          form.querySelector('.shiye-form-status').textContent = error.message;
        } finally {
          button.disabled = false;
        }
      };
      bindSettingsForm(element, form, true);
      field('title').focus();
    } catch (error) {
      element.querySelector('[role=status]').textContent = error.message;
    }
  }
  function openSettings() {
    const element = dialog(
      '拾页 · 设置',
      '<div class="shiye-settings-menu"><button data-edit-room>当前会话设置：资料、外观与程序服务</button><button data-navigation>会话管理与排列</button><button data-appearance>外观、中文输入、字体与时区</button><button data-messages>消息与图片</button><button data-input>表情包</button><button data-desktop>全局快捷键与后台</button><button data-journal>日记归档与保存状态</button><button data-local>本地数据与后续接入</button></div>',
      { page: 'root', parent: null },
    );

    if (element.dataset.settingsRestored === 'true') return;
    const switchTo = (callback) => callback();
    element.querySelector('[data-edit-room]').onclick = () => switchTo(() => openRoomSettings());
    element.querySelector('[data-appearance]').onclick = () => switchTo(openAppearance);
    element.querySelector('[data-navigation]').onclick = () =>
      switchTo(() => window.dispatchEvent(new Event('shiye-open-navigation')));
    element.querySelector('[data-messages]').onclick = () =>
      switchTo(() => {
        const messages = dialog(
          '消息与图片',
          '<label>新图片的保存质量<select id="shiyeImageQuality"><option value="original">原图 · 保留原文件，不压缩</option><option value="high">清晰 · 长边至多 2560 像素，质量 82%</option><option value="balanced">均衡 · 长边至多 2048 像素，质量 60%</option></select></label><p>与拾页共用图片处理代码。只影响之后添加的图片；动画和不适合压缩的图片保留原文件。</p><label>消息 Markdown 显示<select id="shiyeMarkdown"><option value="true">开启</option><option value="false">保留文字原样</option></select></label><p>支持 CommonMark/GFM：标题、加粗、斜体、删除线、引用、列表、任务、表格、链接、分割线、代码块，以及 ==高亮==。Markdown 原文保留；代码中的符号保持原样。__双下划线__ 是加粗，斜体使用 *单星号* 或 _单下划线_。</p><label>间隔多久显示时间分隔（分钟）<input id="shiyeTimeGap" type="number" min="1" max="1440" step="1"></label><p>默认 15 分钟；跨天自动分隔。与话题的归篇间隔分别设置。默认北京时间，可在外观与时区设置中跟随系统。</p><p>查看大图时，放大／缩小和 Ctrl＋滚轮只作用于图片；拖动可查看细节。</p><p>已启用自动归档的对话会写入拾页。本人消息可不限时编辑；撤回原文仅在本机保留供恢复，后台旧条只留撤回提示。修改后的消息沿原时间归位。</p><div class="shiye-actions"><button data-done>完成</button></div>',
          { page: 'messages' },
        );

        if (messages.dataset.settingsRestored === 'true') return;
        const renderLabel = document.createElement('label');
        renderLabel.textContent = '消息呈现方式';
        const renderMode = document.createElement('select');
        renderMode.id = 'shiyeMessageRenderMode';
        renderMode.add(new Option('即时显示', 'instant'));
        renderMode.add(new Option('从输入框发出', 'smooth'));
        renderMode.add(new Option('原平滑过渡', 'legacy'));
        try {
          const storedMode = localStorage.getItem('shiye-message-render-mode');
          renderMode.value = ['instant', 'smooth', 'legacy'].includes(storedMode)
            ? storedMode
            : 'instant';
        } catch {
          renderMode.value = document.body.dataset.shiyeMessageRenderMode || 'instant';
        }
        renderMode.onchange = () => {
          globalMessageRenderMode = renderMode.value;
          try {
            localStorage.setItem('shiye-message-render-mode', renderMode.value);
          } catch {
            /* The selection still applies for this session. */
          }
          apply();
        };
        renderLabel.append(renderMode);
        const renderHelp = document.createElement('p');
        renderHelp.textContent =
          '即时显示完整消息；从输入框发出使用短促过渡；原平滑过渡保留旧效果。';
        messages
          .querySelector('#shiyeImageQuality')
          .closest('label')
          .before(renderLabel, renderHelp);
        installBubbleSpacingSettings(messages, renderHelp);
        const quality = messages.querySelector('#shiyeImageQuality');
        quality.value = localStorage.getItem('shiye-image-quality') || 'balanced';
        quality.onchange = () => localStorage.setItem('shiye-image-quality', quality.value);
        const markdown = messages.querySelector('#shiyeMarkdown');
        markdown.value = localStorage.getItem('shiye-markdown-enabled') || 'true';
        markdown.onchange = () => {
          localStorage.setItem('shiye-markdown-enabled', markdown.value);
          window.dispatchEvent(new Event('shiye-markdown-changed'));
        };
        const gap = messages.querySelector('#shiyeTimeGap');
        gap.value = localStorage.getItem('shiye-time-gap-minutes') || '15';
        gap.onchange = () => {
          if (!gap.reportValidity()) return;
          localStorage.setItem('shiye-time-gap-minutes', gap.value);
          window.dispatchEvent(new Event('shiye-time-gap-changed'));
        };
        messages.querySelector('[data-done]').onclick = () => messages.close();
      });
    element.querySelector('[data-input]').onclick = () =>
      switchTo(() => window.dispatchEvent(new Event('shiye-open-input-settings')));
    element.querySelector('[data-desktop]').onclick = () => switchTo(openDesktopSettings);
    element.querySelector('[data-journal]').onclick = () => switchTo(openJournalStatus);
    element.querySelector('[data-local]').onclick = () =>
      switchTo(() =>
        dialog(
          '本地数据与后续接入',
          '<p>聊天与媒体先保存在本机；启用自动归档后写入拾页日记库与媒体目录，不连接 Telegram 的账户、服务或存储。</p><p>消息立即保存；默认按连续 5 小时无新消息划分日记，在对话设置中选择分类并启用。手机使用、自建服务器同步、机器人、回顾、提醒、AI 与 MCP 均可沿此架构扩展，目前未启用。</p>',
          { page: 'local', autosave: false },
        ),
      );
  }
  async function openJournalStatus() {
    const element = dialog(
      '日记归档与保存状态',
      '<p role="status">正在读取…</p><p>消息先保存到聊天本地库，再归入拾页；连接失败自动重试，不重复创建消息。默认空闲 5 小时截断，聊天里的时间提示不受影响。</p><p data-cut-hotkey></p><button type="button" data-cut-now>立即结束当前篇</button><button type="button" data-cut-hotkeys>设置时间戳快捷键</button><div data-journal-rooms></div><form data-unlock hidden><label>拾页本地锁密码<input type="password" name="password" autocomplete="off" required></label><button type="submit">解锁日记库</button></form><button data-retry>立即重试归档</button>',
      { page: 'journal', autosave: false },
    );

    if (element.dataset.settingsRestored === 'true') return;
    const status = element.querySelector('[role=status]');
    element.querySelector('[data-cut-now]').onclick = () => {
      requestSettingsClose();
      if (!settingsSession) void openManualCut();
    };
    element.querySelector('[data-cut-hotkeys]').onclick = () => post({ kind: 'shared-hotkey-settings' });
    const update = async () => {
      try {
        await refreshCutSettings(true);
        element.querySelector('[data-cut-hotkey]').textContent = '手动结束当前篇：' + (cutBinding() || '未绑定') + '（与思绪插入时间戳共用）';
      } catch (error) { element.querySelector('[data-cut-hotkey]').textContent = error.message; }
      const state = await window.shiyeJournal.status();
      status.textContent =
        state.lastError ||
        (state.lastSuccess
          ? '已连接拾页；最近归档检查：' +
            new Date(state.lastSuccess).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' }) +
            '（北京时间）'
          : '已连接拾页；请在各对话设置中选择分类并启用自动归档。');
      const rows = element.querySelector('[data-journal-rooms]');
      rows.replaceChildren();
      for (const [id, link] of Object.entries(state.rooms)) {
        const p = document.createElement('p');
        p.textContent =
          (rooms.find((r) => r.id === id)?.title || '对话') +
          '：' +
          (link.enabled ? '自动归入「' + link.category + '」' : '仅保存在聊天中');
        rows.append(p);
      }
      element.querySelector('[data-unlock]').hidden = !state.locked;
    };
    element.querySelector('[data-retry]').onclick = async () => {
      status.textContent = '正在归档…';
      try {
        await window.shiyeJournal.flush();
        await update();
      } catch (error) {
        status.textContent = error.message;
      }
    };
    element.querySelector('[data-unlock]').onsubmit = async (event) => {
      event.preventDefault();
      const input = event.target.elements.password;
      const password = input.value;
      input.value = '';
      try {
        await window.shiyeJournal.unlock(password);
        await window.shiyeJournal.flush();
        await update();
      } catch (error) {
        status.textContent = error.message;
      }
    };
    await update();
  }
  function openDesktopSettings() {
    post({ kind: 'get-window-state' });
    const element = dialog(
      '全局快捷键与后台',
      '<p>思绪与随想由拾页同一个后台接收，快捷键可在统一设置调整。</p><button data-shared-hotkeys>打开拾页统一快捷键设置</button><label>热键收起时确认<select id="shiyeConfirmHide"><option value="false">直接保存并收起</option><option value="true">确认后收起（Enter 确认）</option></select></label><label><input type="checkbox" id="shiyeEdgeSnap">窗口靠近屏幕边缘时自动吸附</label><label><input type="checkbox" id="shiyeHoverActivate">悬停展开时自动激活输入</label><label>鼠标离开后收起（毫秒）<input id="shiyeDockHideDelay" type="number" min="0" max="3000" step="10"></label><p>可设 0–3000 毫秒；0 表示移开后立即开始收起，默认 350 毫秒。输入、菜单和图片查看期间暂缓。贴边收起后保留一条可悬停唤回的边。</p><p>当前窗口在前台时按热键收起；在其他软件或后台时按热键唤回并聚焦输入框，恢复话题、光标和草稿。普通 × 也保存后退到后台。</p><p>后台托盘负责接收按键；完全退出后快捷键不再响应。开机启动另行设置，未自动启用。</p><p role="status"></p><div class="shiye-actions"><button data-save-desktop>保存</button></div>',
      { page: 'desktop', explicit: true },
    );

    if (element.dataset.settingsRestored === 'true') return;
    element.querySelector('[data-shared-hotkeys]').onclick = () =>
      post({ kind: 'shared-hotkey-settings' });
    const motionLabel = document.createElement('label');
    motionLabel.textContent = '贴边窗口动效';
    const motion = document.createElement('select');
    motion.id = 'shiyeDockMotionStyle';
    motion.add(new Option('柔和收敛', 'responsive'));
    motion.add(new Option('原有曲线', 'classic'));
    motion.value = desktopState.dockMotionStyle === 'classic' ? 'classic' : 'responsive';
    motionLabel.append(motion);
    element.querySelector('#shiyeDockHideDelay').closest('label').before(motionLabel);
    element.querySelector('#shiyeEdgeSnap').checked = desktopState.edgeSnap !== false;
    element.querySelector('#shiyeHoverActivate').checked =
      desktopState.dockActivateOnHover === true;
    element.querySelector('#shiyeDockHideDelay').value = desktopState.dockHideDelayMs ?? 350;
    element.querySelector('#shiyeConfirmHide').value = String(desktopState.confirmHide);
    desktopStatus = element.querySelector('[role=status]');
    element.addEventListener('input', () => {
      element.dataset.settingsDirty = 'true';
    });
    element.addEventListener('change', () => {
      element.dataset.settingsDirty = 'true';
    });
    element.settingsSave = async () => {
      if (element.settingsNativeSave) return element.settingsNativeSave;
      const delay = element.querySelector('#shiyeDockHideDelay');
      const value = delay.value.trim() === '' ? NaN : Number(delay.value);
      delay.value = Number.isFinite(value) ? Math.max(0, Math.min(3000, Math.round(value))) : 350;
      if (!window.chrome?.webview) {
        desktopStatus.textContent = '当前浏览器没有原生窗口设置接口';
        return false;
      }
      const saved = new Promise((resolve) => {
        let timer;
        const finish = (event) => {
          clearTimeout(timer);
          window.removeEventListener('shiye-desktop-setting-result', finish);
          if (!event?.detail?.error && event) markSettingsSaved(element);
          element.settingsNativeSave = undefined;
          element.settingsCleanup = undefined;
          resolve(Boolean(event && !event.detail?.error));
        };
        window.addEventListener('shiye-desktop-setting-result', finish);
        timer = setTimeout(() => finish(), 10000);
        element.settingsCleanup = () => finish();
      });
      element.settingsNativeSave = saved;
      post({
        kind: 'desktop-settings',
        edgeSnap: element.querySelector('#shiyeEdgeSnap').checked,
        dockActivateOnHover: element.querySelector('#shiyeHoverActivate').checked,
        dockMotionStyle: element.querySelector('#shiyeDockMotionStyle').value,
        dockHideDelayMs: Number(delay.value),
        confirmHide: element.querySelector('#shiyeConfirmHide').value === 'true',
      });
      return saved;
    };
    element.querySelector('[data-save-desktop]').onclick = () => element.settingsSave();
  }
  window.addEventListener('shiye-desktop-settings', openDesktopSettings);
  function setSidebar(collapsed, focusCurrent = false) {
    if (settings.sidebarCollapsed !== collapsed) {
      window.dispatchEvent(
        new CustomEvent('shiye-sidebar-before-change', { detail: { collapsed } }),
      );
    }
    settings.sidebarCollapsed = collapsed;
    apply();
    persist();
    window.dispatchEvent(new Event('resize'));
    window.dispatchEvent(
      new CustomEvent('shiye-sidebar-changed', { detail: { collapsed, focusCurrent } }),
    );
  }
  window.addEventListener('shiye-set-sidebar', ({ detail }) => {
    if (typeof detail?.collapsed === 'boolean') setSidebar(detail.collapsed, !!detail.focusCurrent);
  });
  window.addEventListener('shiye-toggle-topics', () => {
    setSidebar(!settings.sidebarCollapsed, settings.sidebarCollapsed);
  });
  const sidebarFallback = document.createElement('button');
  sidebarFallback.type = 'button';
  sidebarFallback.className = 'shiye-sidebar-fallback';
  sidebarFallback.setAttribute('aria-label', '折叠或展开对话栏');
  sidebarFallback.setAttribute('aria-controls', 'LeftColumn');
  sidebarFallback.classList.add('shiye-toggle-topics');
  sidebarFallback.innerHTML =
    '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="3"/><path d="M9 4v16"/></svg>';
  sidebarFallback.onclick = () => window.dispatchEvent(new Event('shiye-toggle-topics'));
  document.body.append(sidebarFallback);
  document.addEventListener('click', (event) => {
    if (innerWidth < 926 && event.target.closest('#LeftColumn .ListItem.Chat .ListItem-button')) {
      setSidebar(true);
    }
  });
  window.addEventListener('shiye-open-settings', openSettings);
  window.addEventListener('shiye-new-topic', () => openRoomSettings(true));
  window.addEventListener('shiye-edit-room', (event) => openRoomSettings(false, event.detail?.id));
  function openAppearance() {
    const element = dialog(
      '对话外观与时区',
      `<label>日期与时间的时区<select id="shiyeTimeZone"><option value="Asia/Shanghai">北京时间（UTC+08:00）</option><option value="system">跟随系统</option><option value="UTC">协调世界时（UTC）</option><option value="America/Los_Angeles">美国太平洋时间</option></select></label><p>时区切换在下次打开预览时生效；原消息时间保持不变。</p><label>消息位置<select id="shiyeMessageAlign"><option value="right">靠右</option><option value="left">靠左</option></select></label><label>明暗模式<select id="shiyeTheme"><option value="dark">深色</option><option value="light">浅色</option></select></label><label>背景遮罩<input id="shiyeShade" type="range" min="0.1" max="1" step="0.01"></label><label>我的气泡不透明度<input id="shiyeBubble" type="range" min="0.25" max="1" step="0.01"></label><label>消息间距<input id="shiyeMessageGap" type="range" min="4" max="28" step="1"></label><label>对话切换等待（毫秒）<input id="shiyeSwitchDelay" type="number" min="400" max="5000" step="100"></label><label>气泡圆角<input id="shiyeRadius" type="range" min="4" max="24" step="1"></label><label>自定义背景图片<input id="shiyeWallpaper" type="file" accept="image/*"></label><p>外观只作用于这个测试窗口，文字和媒体保持清晰。</p><div class="shiye-actions"><button id="shiyeReset">恢复默认</button><button id="shiyeDone">完成</button></div>`,
      { page: 'appearance' },
    );

    if (element.dataset.settingsRestored === 'true') return;
    element.querySelector('#shiyeMessageAlign').value = settings.messageAlign || 'right';
    element.querySelector('#shiyeMessageAlign').onchange = (event) => {
      settings.messageAlign = event.target.value;
      apply();
      persist();
    };
    element.querySelector('#shiyeTimeZone').value = settings.timeZone;
    element.querySelector('#shiyeTimeZone').onchange = (event) => {
      settings.timeZone = event.target.value;
      persist();
    };
    const conversationDate = document.createElement('div');
    conversationDate.innerHTML = '<label>会话列表星期语言<select id="shiyeConversationWeekdayLanguage"><option value="zh">中文（周二）</option><option value="en">英文（Tue）</option></select></label><p>会话列表显示最后消息的日期、星期和北京时间，例如 10-21 周三 14:05。</p><button type="button" data-conversation-date-save>保存星期语言</button><button type="button" data-conversation-date-cancel>取消修改</button><span role="status" data-conversation-date-status></span>';
    element.querySelector('.shiye-actions').before(conversationDate);
    const weekdayLanguage = conversationDate.querySelector('select');
    const savedWeekdayLanguage = () => settings.conversationWeekdayLanguage === 'en' ? 'en' : 'zh';
    weekdayLanguage.value = savedWeekdayLanguage();
    conversationDate.querySelector('[data-conversation-date-save]').onclick = () => {
      const previous = settings.conversationWeekdayLanguage;
      settings.conversationWeekdayLanguage = weekdayLanguage.value === 'en' ? 'en' : 'zh';
      try {
        persist();
        window.dispatchEvent(new Event('shiye-conversation-date-changed'));
        conversationDate.querySelector('[data-conversation-date-status]').textContent = '已保存';
      } catch (error) {
        settings.conversationWeekdayLanguage = previous;
        conversationDate.querySelector('[data-conversation-date-status]').textContent = '保存失败，请重试';
      }
    };
    conversationDate.querySelector('[data-conversation-date-cancel]').onclick = () => {
      weekdayLanguage.value = savedWeekdayLanguage();
      conversationDate.querySelector('[data-conversation-date-status]').textContent = '已取消修改';
    };
    const behavior = document.createElement('div');
    behavior.innerHTML =
      '<label>唤回时的输入<select id="shiyeInputMode"><option value="chinese">每次唤回恢复中文</option><option value="system">保留系统输入状态</option></select></label><label>中文字体<select id="shiyeFont"><option value="yahei">微软雅黑 / 苹方</option><option value="system">系统字体</option><option value="serif">衬线</option><option value="mono">等宽</option></select></label><label>消息字号<input id="shiyeFontSize" type="range" min="14" max="24" step="1"></label><p>Ctrl＋滚轮、Ctrl＋加减以 4% 只调整消息文字；输入框字号单独设置，图标和工具栏保持原尺寸，Ctrl＋0 恢复。窗口位置、大小和比例自动记住。</p>';
    element.querySelector('.shiye-actions').before(behavior);
    element.querySelector('#shiyeInputMode').value = inputMode;
    element.querySelector('#shiyeInputMode').onchange = (event) => {
      inputMode = event.target.value;
      post({ kind: 'input-mode', mode: inputMode });
    };
    element.querySelector('#shiyeFont').value = settings.font || 'yahei';
    element.querySelector('#shiyeFontSize').value = settings.fontSize || 16;
    const inputLabel = document.createElement('label');
    const inputValue = document.createElement('span');
    const inputSize = document.createElement('input');
    inputSize.id = 'shiyeInputFontSize';
    inputSize.type = 'range';
    inputSize.min = '7';
    inputSize.max = '60';
    inputSize.step = '0.01';
    inputSize.value = String(inputFontSize());
    const showInputSize = () => {
      inputValue.textContent = '输入框字号（独立）：' + Number(inputFontSize().toFixed(2)) + ' px';
    };
    inputSize.oninput = () => {
      settings.inputFontSize = Number(inputSize.value);
      apply();
      persist();
      showInputSize();
    };
    inputLabel.append(inputValue, inputSize);
    behavior.append(inputLabel);
    const sendLabel = document.createElement('label');
    const showSendButton = document.createElement('input');
    showSendButton.type = 'checkbox';
    showSendButton.id = 'shiyeShowSendButton';
    showSendButton.checked = settings.showSendButton !== false;
    showSendButton.onchange = () => {
      settings.showSendButton = showSendButton.checked;
      persist();
      apply();
    };
    sendLabel.append(showSendButton, '显示聊天发送按钮（仍可用 Enter 发送）');
    behavior.append(sendLabel);
    showInputSize();
    for (const [id, field] of [
      ['shiyeFont', 'font'],
      ['shiyeFontSize', 'fontSize'],
    ]) {
      element.querySelector('#' + id).oninput = (event) => {
        settings[field] = field === 'fontSize' ? Number(event.target.value) : event.target.value;
        apply();
        persist();
      };
    }
    for (const [id, field] of [
      ['shiyeTheme', 'theme'],
      ['shiyeShade', 'shade'],
      ['shiyeBubble', 'bubble'],
      ['shiyeRadius', 'radius'],
      ['shiyeMessageGap', 'messageGap'],
    ]) {
      const input = element.querySelector('#' + id);
      input.value = settings[field];
      input.oninput = () => {
        settings[field] = field === 'theme' ? input.value : Number(input.value);
        apply();
        persist();
      };
    }
    const switchDelay = element.querySelector('#shiyeSwitchDelay');
    switchDelay.value = window.shiyeSwitchDelay.get();
    switchDelay.onchange = () => {
      switchDelay.value = window.shiyeSwitchDelay.set(switchDelay.value);
    };
    const backgroundStatus = document.createElement('p');
    backgroundStatus.setAttribute('role', 'status');
    element.querySelector('#shiyeWallpaper').after(backgroundStatus);
    element.querySelector('#shiyeWallpaper').onchange = async (event) => {
      const file = event.target.files[0];
      if (!file) return;
      event.target.disabled = true;
      try {
        if (!file.type.startsWith('image/') || file.type === 'image/svg+xml')
          throw Error('请选择 PNG、JPEG、WebP 或 GIF 图片');
        const decoded = await createImageBitmap(file);
        decoded.close();
        await window.shiyeLocalAssets.put({ id: 'wallpaper', blob: file, name: file.name });
        delete settings.wallpaper;
        persist();
        await restoreWallpaper();
        backgroundStatus.textContent = '背景已保存在本机，不压缩原图。';
      } catch (error) {
        backgroundStatus.textContent = `背景保存失败：${error.message}。请检查图片和本机剩余空间。`;
      } finally {
        event.target.disabled = false;
      }
    };
    element.querySelector('#shiyeDone').onclick = () => element.close();
    element.querySelector('#shiyeReset').onclick = async () => {
      try {
        await window.shiyeLocalAssets.remove('wallpaper');
      } catch {
        backgroundStatus.textContent = '清除背景失败，请重试。';
        return;
      }
      if (wallpaperUrl) URL.revokeObjectURL(wallpaperUrl);
      wallpaperUrl = undefined;
      Object.assign(settings, {
        theme: 'dark',
        shade: 0.9,
        bubble: 0.98,
        radius: 14,
        wallpaper: undefined,
      });
      apply();
      persist();
      element.close();
    };
  }
  window.addEventListener('storage', (event) => {
    if (![key, roomAppearanceKey, 'shiye-message-render-mode'].includes(event.key)) return;
    try {
      if (event.key === roomAppearanceKey) roomAppearances = JSON.parse(event.newValue || '{}') || {};
      else if (event.key === 'shiye-message-render-mode')
        globalMessageRenderMode = appearanceChoices.messageRenderMode.includes(event.newValue) ? event.newValue : 'instant';
      else {
        const next = JSON.parse(event.newValue || '{}') || {};
        for (const field of [...Object.keys(appearanceFields), ...Object.keys(appearanceChoices), 'showSendButton']) {
          if (Object.hasOwn(next, field)) settings[field] = next[field];
          else delete settings[field];
        }
        Object.assign(settings, { theme: settings.theme || 'dark', shade: settings.shade ?? 0.9,
          bubble: settings.bubble ?? 0.98, radius: settings.radius ?? 14, messageGap: settings.messageGap ?? 10 });
      }
      apply();
    } catch { /* Invalid external data does not replace the visible local preference state. */ }
  });
  apply();
  restoreWallpaper();
  window.shiyeRoomUi = {
    command: roomCommand,
    currentId: currentRoomId,
    restoreDefaultWallpaper: apply,
  };
  // Share the diary command parser and effective settings owner, including extension opt-in.
  let cutHotkeys;
  let cutSettings;
  let cutDialog;
  let cutOpening = false;
  let cutSettingsLoading;
  async function refreshCutSettings(refresh = false) {
    if (cutSettingsLoading) return cutSettingsLoading;
    cutSettingsLoading = (async () => {
      cutHotkeys ||= await import('./shiye-hotkeys.js');
      cutSettings = await window.shiyeJournal.datetimeSettings(refresh);
      return cutSettings;
    })().finally(() => { cutSettingsLoading = undefined; });
    return cutSettingsLoading;
  }
  function cutBinding() {
    return cutHotkeys && cutSettings ? cutHotkeys.binding(
      cutHotkeys.commands.find((command) => command.id === 'datetime'),
      cutHotkeys.effectiveShortcuts(cutSettings.shortcuts, cutSettings.extendedShortcuts),
    ) : undefined;
  }
  async function openManualCut() {
    if (cutOpening || cutDialog?.isConnected || composing || !document.hasFocus() || document.hidden) return;
    const roomId = currentRoomId();
    if (!roomId) return;
    cutOpening = true;
    try { await roomCommand('list'); } catch { cutOpening = false; return; }
    cutOpening = false;
    const room = rooms.find((item) => item.id === roomId);
    if (!room || currentRoomId() !== roomId || !document.hasFocus() || document.hidden) return;
    const editor = document.querySelector('.middle-column-footer:not([hidden]) #editable-message-text');
    if (!editor || !editor.isContentEditable) return;
    const originalSelection = getSelection();
    const savedSelection = originalSelection?.rangeCount ? { range: originalSelection.getRangeAt(0).cloneRange(),
      anchorNode: originalSelection.anchorNode, anchorOffset: originalSelection.anchorOffset,
      focusNode: originalSelection.focusNode, focusOffset: originalSelection.focusOffset } : undefined;
    const previousFocus = document.activeElement;
    const element = dialog('结束当前篇', '<p data-cut-description></p><p role="status"></p><div class="shiye-actions"><button type="button" data-cut-confirm>确认结束</button><button type="button" data-cut-cancel>取消</button></div>');
    cutDialog = element;
    element.dataset.manualCut = 'true';
    element.querySelector('[data-cut-description]').textContent =
      '将「' + room.title + '」本次确认前已保存在本机的消息结束成一篇。草稿保留，下一条新消息另起一篇。';
    const confirm = element.querySelector('[data-cut-confirm]');
    const cancel = element.querySelector('[data-cut-cancel]');
    const status = element.querySelector('[role=status]');
    let operationId;
    let submitting = false;
    confirm.focus();
    cancel.onclick = () => element.close();
    element.addEventListener('keydown', (event) => {
      if (event.isComposing || event.keyCode === 229) return;
      if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) {
        event.preventDefault(); event.stopImmediatePropagation();
        (document.activeElement === cancel ? confirm : cancel).focus();
      }
    });
    element.addEventListener('close', () => {
      if (cutDialog === element) cutDialog = undefined;
      if (currentRoomId() === roomId && previousFocus?.isConnected) {
        previousFocus.focus({ preventScroll: true });
        if (savedSelection && editor.contains(savedSelection.range.commonAncestorContainer)) {
          const selection = getSelection();
          selection.setBaseAndExtent(savedSelection.anchorNode, savedSelection.anchorOffset, savedSelection.focusNode, savedSelection.focusOffset);
        }
      }
    });
    confirm.onclick = async () => {
      if (submitting) return;
      if (currentRoomId() !== roomId || !document.hasFocus() || document.hidden) {
        status.textContent = '当前会话或窗口已变化，请返回原会话重新确认。'; return;
      }
      submitting = true; confirm.disabled = true;
      operationId ||= crypto.randomUUID();
      try {
        const cut = await window.shiyeJournal.manualCut(roomId, operationId);
        if (!element.isConnected) return;
        status.textContent = cut.status === 'empty' ? '当前没有新增的已发送消息，无需结束。'
          : '本机分篇已保存，正在同步到拾页。新消息可以继续发送。';
        confirm.hidden = true; cancel.textContent = '完成'; cancel.focus();
      } catch (error) { status.textContent = error.message; confirm.disabled = false; }
      finally { submitting = false; }
    };
  }
  window.addEventListener('keydown', (event) => {
    if (event.repeat || event.isComposing || event.keyCode === 229 || composing || document.hidden
      || !document.hasFocus() || document.querySelector('dialog[open], .Modal.open, #MediaViewer')
      || event.target.closest?.('[data-shortcut-recording], .shortcut-key.recording, .shiye-settings-dialog')) return;
    const value = cutBinding();
    if (!value || event.getModifierState?.('AltGraph') || cutHotkeys.chord(event) !== value
      || cutHotkeys.match(event, cutHotkeys.effectiveShortcuts(cutSettings.shortcuts, cutSettings.extendedShortcuts), true, true)?.id !== 'datetime') return;
    event.preventDefault(); event.stopImmediatePropagation(); void openManualCut();
  }, true);
  window.addEventListener('focus', () => { void refreshCutSettings(true).catch(() => {}); });
  void refreshCutSettings().catch(() => {});
  window.shiyeManualCut = { open: openManualCut, binding: cutBinding, refreshSettings: refreshCutSettings };
  document.title = '拾页 · 随想';
})();
