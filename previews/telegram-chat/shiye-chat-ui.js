/* Shiye desktop composer, local message port and native image viewing. */
(() => {
  // A scoped release can reuse its verified upstream scheduler without
  // rebuilding unrelated modules. Full builds expose it through the editor.
  let layout;
  let readFrozenState;
  const stateModule = document.currentScript?.dataset.shiyeState;
  const stateExport = document.currentScript?.dataset.shiyeStateExport;
  if (stateModule && stateExport)
    import(stateModule)
      .then((module) => {
        if (typeof module[stateExport] === 'function') {
          readFrozenState = module[stateExport];
          reconcileSendMotion();
        }
      })
      .catch(() => {});
  const layoutModule = document.currentScript?.dataset.shiyeLayout;
  if (layoutModule)
    import(layoutModule)
      .then((module) => {
        if (typeof module.n === 'function' && typeof module.r === 'function')
          layout = { measure: module.n, mutate: module.r };
      })
      .catch(() => {});
  const post = (message) => window.chrome?.webview?.postMessage(message);
  function notify(message) {
    const status = document.createElement('div');
    status.className = 'shiye-ui-status';
    status.setAttribute('role', 'status');
    status.textContent = message;
    document.body.append(status);
    setTimeout(() => status.remove(), 5000);
  }
  window.chrome?.webview?.addEventListener('message', ({ data }) => {
    if (data.kind === 'workspace-launch-result' && data.error)
      notify(`无法打开${data.workspace === 'notes' ? '便签' : '快捷写作'}：${data.error}`);
  });
  let footer;
  let scroller;
  let messageContent;
  let sizedEditor;
  let contentSizeChanged = false;
  let followUntil = 0;
  let restoredBottomScroller;
  let frame;
  let resizingInput = false;
  let inputCap = 160;
  let manualHeight;
  let minimumManualHeight = 36;
  let scrollGesture = 0;
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  function readMessageRenderMode() {
    try {
      const value = localStorage.getItem('shiye-message-render-mode');
      return value === 'smooth' || value === 'legacy' ? value : 'instant';
    } catch {
      return 'instant';
    }
  }
  let messageRenderMode = readMessageRenderMode();
  document.body.dataset.shiyeMessageRenderMode = messageRenderMode;
  const bubbleMotions = new Map();
  let sendMotion;
  let motionFrame;
  let motionGeneration = 0;
  let motionExpiry;
  const originMotions = new Set();
  const originClips = new Map();
  function finishOriginMotion(entry) {
    if (!originMotions.delete(entry)) return;
    entry.animation.cancel();
    const clip = originClips.get(entry.container);
    if (clip && --clip.count === 0) {
      if (clip.value) entry.container.style.setProperty('overflow', clip.value, clip.priority);
      else entry.container.style.removeProperty('overflow');
      originClips.delete(entry.container);
    }
  }
  function captureSendOrigin() {
    const editor = footer?.querySelector('#editable-message-text');
    const box = editor?.closest('.input-scroller');
    if (!box || !box.getClientRects().length) return undefined;
    const bounds = box.getBoundingClientRect();
    const text = editor.getBoundingClientRect();
    const style = getComputedStyle(editor);
    const line = Number.parseFloat(style.lineHeight) || 24;
    let bottom = text.bottom - (Number.parseFloat(style.paddingBottom) || 0);
    const selection = getSelection();
    if (selection?.rangeCount && editor.contains(selection.focusNode)) {
      const caret = selection.getRangeAt(0).getBoundingClientRect();
      if (caret.height) bottom = caret.bottom;
    }
    return {
      x: text.left + (Number.parseFloat(style.paddingLeft) || 0),
      y: Math.max(bounds.top + Math.min(line, bounds.height), Math.min(bounds.bottom, bottom)),
    };
  }
  function animateFromInput(message, state, origin, previous) {
    const content = message.querySelector('.message-content');
    const container = message.closest('.messages-container');
    if (!content || !container || !origin || reducedMotion.matches) return;
    const rect = content.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    const style = getComputedStyle(content);
    const dy = origin.y - rect.bottom + (Number.parseFloat(style.paddingBottom) || 0);
    const duration = previous?.duration ?? Math.min(220, 160 + Math.abs(dy) * 0.12);
    const elapsed = previous ? Math.max(0, performance.now() - previous.startedAt) : 0;
    if (elapsed >= duration) {
      if (previous) finishOriginMotion(previous);
      return;
    }
    let clip = originClips.get(container);
    if (!clip) {
      clip = {
        count: 0,
        value: container.style.getPropertyValue('overflow'),
        priority: container.style.getPropertyPriority('overflow'),
      };
      originClips.set(container, clip);
      container.style.setProperty('overflow', 'clip', 'important');
    }
    clip.count++;
    // Only the new bubble moves. Its final layout and the old rows never get
    // a reverse transform; clipping prevents the visual path growing scrollHeight.
    const animation = content.animate(
      [
        { transform: `translate(0px, ${dy}px)`, opacity: 0.82 },
        { transform: 'translate(0px, 0px)', opacity: 1 },
      ],
      { duration, easing: 'cubic-bezier(0.16,1,0.3,1)', fill: 'both' },
    );
    animation.currentTime = elapsed;
    animation.id = 'shiye-send-origin';
    const entry = {
      message,
      content,
      container,
      animation,
      origin,
      duration,
      id: message.dataset.messageId,
      startedAt: previous?.startedAt ?? performance.now(),
      state,
    };
    originMotions.add(entry);
    if (previous) finishOriginMotion(previous);
    animation.onfinish = () => finishOriginMotion(entry);
  }
  function reconcileOriginMotions() {
    const detached = [...originMotions].filter((entry) => !entry.content.isConnected);
    if (!detached.length || !scroller) return;
    const roots = [...scroller.querySelectorAll('.Message.own')];
    let editor;
    window.dispatchEvent(
      new CustomEvent('shiye-editor-request', {
        detail: {
          receive(value) {
            editor = value;
          },
        },
      }),
    );
    const identities =
      editor?.resolveMessageIdentities?.(roots.map((node) => node.dataset.messageId)) || [];
    for (const entry of detached) {
      const alias = identities.find((item) => item.previousLocalId === entry.id)?.id;
      const replacement = roots.find(
        (node) =>
          node.dataset.messageId === entry.id ||
          (alias && node.dataset.messageId === String(alias)),
      );
      if (replacement && entry.state.list === scroller)
        animateFromInput(replacement, entry.state, entry.origin, entry);
      // Confirmation can mount the replacement in a later mutation batch.
      // Keep the original clock alive; never restart an already visible send.
      else if (entry.state.list !== scroller) finishOriginMotion(entry);
    }
  }
  const instantSizeObserver = new ResizeObserver(() => {
    if (!sendMotion?.instant) return;
    if (sendMotion.revealed) commitInstantTail(sendMotion);
    else reconcileInstantAppend();
  });
  const scrollTopAccess = Object.getOwnPropertyDescriptor(Element.prototype, 'scrollTop');
  function ownSendScroll(list) {
    Object.defineProperty(list, 'scrollTop', {
      configurable: true,
      get() {
        return scrollTopAccess.get.call(this);
      },
      set(value) {
        // While sending, only the reveal/scroll transaction moves the viewport.
        if (sendMotion?.list === this && Date.now() < followUntil) return;
        scrollTopAccess.set.call(this, value);
      },
    });
  }
  function sampleBubbleOpacity(age) {
    const t = Math.max(0, Math.min(1, age / 80));
    return 0.8 + 0.2 * (1 - (1 - t) ** 3);
  }
  function finishBubble(id, entry) {
    if (bubbleMotions.get(id) === entry) bubbleMotions.delete(id);
    mutate(() => {
      entry.restore?.();
      entry.restoreRoot?.();
      entry.animation.cancel();
    });
  }
  function stopSendMotion(restoreImmediately = false) {
    const state = sendMotion;
    motionGeneration++;
    clearTimeout(motionExpiry);
    instantSizeObserver.disconnect();
    motionFrame = undefined;
    sendMotion = undefined;
    for (const entry of [...originMotions]) finishOriginMotion(entry);
    if (state?.scrollMode && state.list.isConnected)
      state.list.scrollTo({ top: state.list.scrollTop, behavior: 'auto' });
    for (const [id, entry] of bubbleMotions)
      if (restoreImmediately) {
        bubbleMotions.delete(id);
        entry.restore?.();
        entry.restoreRoot?.();
        entry.animation.cancel();
      } else finishBubble(id, entry);
  }
  function beginSendMotion() {
    const instant = messageRenderMode !== 'legacy';
    if (!scroller || (!instant && (reducedMotion.matches || !Element.prototype.animate))) return;
    const previous = sendMotion;
    const roots = [...scroller.querySelectorAll('.Message')];
    // A withdrawal notice is an ActionMessage, not a Message bubble. It can be
    // the real tail of an otherwise nonempty history. Keep that node as the
    // instant-send anchor instead of waiting forever for a nonexistent bubble.
    const tail =
      roots.find((message) => message.classList.contains('last-in-list')) ||
      (instant ? scroller.querySelector('.message-list-item.last-in-list') : undefined);
    const ids = new Set(roots.map((message) => message.dataset.messageId));
    const continuePending =
      instant && previous?.instant && previous.list === scroller && previous.pending > 0;
    const origin = captureSendOrigin();
    sendMotion = {
      list: scroller,
      instant,
      fromInput: messageRenderMode === 'smooth' && !reducedMotion.matches,
      origins: [...(continuePending ? previous.origins : []), origin],
      origin,
      lastTail: continuePending ? previous.lastTail : tail,
      anchor: continuePending ? previous.anchor : tail,
      knownNodes: new Set(continuePending ? previous.knownNodes : roots),
      candidates: new Set(continuePending ? previous.candidates : []),
      known: new Set(continuePending ? previous.known : ids),
      baseline: new Set(continuePending ? previous.baseline : ids),
      revealed: continuePending && previous.revealed,
      headers: previous?.list === scroller ? previous.headers : new Set(),
      pending: (previous?.list === scroller ? previous.pending : 0) + 1,
      scrollMode:
        previous?.list === scroller
          ? previous.scrollMode
          : scroller.scrollHeight > scroller.clientHeight + 1,
      target: previous?.list === scroller ? previous.target : undefined,
      initialReserve:
        Number.parseFloat(scroller.style.getPropertyValue('--shiye-footer-reserve')) || 98,
      until: performance.now() + (instant ? 4000 : 1000),
    };
    clearTimeout(motionExpiry);
    instantSizeObserver.disconnect();
    const content = instant && scroller.querySelector('.messages-container');
    if (content) instantSizeObserver.observe(content);
    motionExpiry = setTimeout(
      () => {
        instantSizeObserver.disconnect();
        sendMotion = undefined;
      },
      instant ? 4000 : 1000,
    );
    reconcileSendMotion();
  }
  function footerReserve(measured) {
    if (!sendMotion) return measured;
    // Immediate layout follows the actual editor even while an earlier send is
    // being acknowledged. Holding its old height until a tail ID settles makes
    // rapid multiline sends jump again hundreds of milliseconds later.
    if (sendMotion.instant) return measured;
    if (!sendMotion.revealed && sendMotion.pending)
      return Math.max(measured, sendMotion.initialReserve);
    if (sendMotion.scrollMode) return measured;
    const growing = [...bubbleMotions.values()].filter((e) => e.restore);
    const progress = growing.length
      ? Math.max(...growing.map((e) => e.animation?.effect.getComputedTiming().progress ?? 0))
      : sendMotion.pending
        ? 0
        : 1;
    return Math.ceil(measured + Math.max(0, sendMotion.initialReserve - measured) * (1 - progress));
  }
  function revealBubble(
    message,
    content,
    id,
    now,
    state,
    entering,
    previous,
    divider = false,
    committing = false,
  ) {
    if (state.scrollMode && !committing) {
      mutate(() => {
        if (sendMotion === state && message.isConnected && content.isConnected)
          revealBubble(message, content, id, now, state, entering, previous, divider, true);
      });
      return;
    }
    const enteredAt = entering ? now : previous.enteredAt;
    const age = Math.max(0, now - enteredAt);
    if (previous?.content === content && previous.message === message) return;
    previous?.animation.cancel();
    previous?.restore?.();
    previous?.restoreRoot?.();
    // The upstream row also fades. Keep one owner so its opacity does not
    // multiply the content fade, delaying the first readable paint.
    const rootStyles = ['opacity', 'transition'].map((p) => [
      p,
      message.style.getPropertyValue(p),
      message.style.getPropertyPriority(p),
    ]);
    const restoreRoot = () => {
      for (const [p, value, priority] of rootStyles)
        if (value) message.style.setProperty(p, value, priority);
        else message.style.removeProperty(p);
    };
    message.style.setProperty('transition', 'none', 'important');
    message.style.setProperty('opacity', '1', 'important');
    const grow = !state.scrollMode;
    let restore, keyframes, duration;
    if (grow) {
      const height = message.getBoundingClientRect().height;
      const style = getComputedStyle(message);
      const gap = Number.parseFloat(style.marginBottom) || 0;
      const topGap = divider ? Number.parseFloat(style.marginTop) || 0 : 0;
      const properties = [
        'height',
        'min-height',
        'padding-bottom',
        'padding-top',
        'margin-top',
        'margin-bottom',
        'overflow',
        'box-sizing',
      ];
      const saved = properties.map((p) => [
        p,
        message.style.getPropertyValue(p),
        message.style.getPropertyPriority(p),
      ]);
      restore = () => {
        for (const [p, value, priority] of saved)
          if (value) message.style.setProperty(p, value, priority);
          else message.style.removeProperty(p);
      };
      message.style.setProperty('height', '0px');
      message.style.setProperty('min-height', '0px');
      message.style.setProperty('padding-bottom', '0px');
      message.style.setProperty('padding-top', '0px');
      if (divider) message.style.setProperty('margin-top', '0px', 'important');
      message.style.setProperty('margin-bottom', '0px', 'important');
      message.style.setProperty('overflow', 'clip');
      message.style.setProperty('box-sizing', 'border-box');
      duration = 160;
      keyframes = [
        { height: '0px', paddingBottom: '0px', paddingTop: '0px' },
        {
          height: `${height + gap + topGap}px`,
          paddingBottom: `${gap}px`,
          paddingTop: `${topGap}px`,
        },
      ];
    } else {
      duration = Math.max(1, 80 - age);
      keyframes = Array.from({ length: 33 }, (_, i) => ({
        opacity: sampleBubbleOpacity(age + (duration * i) / 32),
      }));
    }
    const animation = (grow ? message : content).animate(keyframes, {
      duration,
      easing: grow ? 'cubic-bezier(0.16,1,0.3,1)' : 'linear',
      fill: 'both',
    });
    if (grow) animation.currentTime = Math.min(age, duration);
    animation.id = 'shiye-send-bubble';
    const entry = { animation, message, content, enteredAt, restore, restoreRoot };
    bubbleMotions.set(id, entry);
    animation.onfinish = () => finishBubble(id, entry);
  }
  function updateSendMotion(now) {
    motionFrame = undefined;
    const state = sendMotion;
    if (state?.instant) return;
    if (
      !state ||
      state.list !== scroller ||
      !scroller.isConnected ||
      reducedMotion.matches ||
      document.hidden ||
      document.body.dataset.shiyeRoomPending ||
      scroller.dataset.shiyeRestoring === 'true'
    ) {
      stopSendMotion();
      return;
    }
    const denseTarget = state.scrollMode
      ? Math.max(0, scroller.scrollHeight - scroller.clientHeight)
      : undefined;
    for (const message of scroller.querySelectorAll('.Message.own')) {
      const id = message.dataset.messageId;
      const previous = bubbleMotions.get(id);
      const entering = !state.known.has(id) && !Number.isInteger(Number(id)) && state.pending > 0;
      if (!entering && !previous) continue;
      const content = message.querySelector(':scope > .message-content-wrapper > .message-content');
      if (!content) continue;
      if (!state.scrollMode) {
        const group = message.closest('.message-date-group');
        const first = group?.querySelector('.Message');
        const header = group?.querySelector(':scope > .sticky-date');
        const headerId =
          first &&
          `divider:${[...scroller.querySelectorAll('.message-date-group')].indexOf(group)}:${header?.textContent}`;
        const headerMotion = bubbleMotions.get(headerId);
        const newGroup =
          group &&
          ![...group.querySelectorAll('.Message')].some((e) =>
            state.baseline.has(e.dataset.messageId),
          );
        if (header && (headerMotion || (newGroup && !state.headers.has(headerId)))) {
          state.headers.add(headerId);
          revealBubble(header, header, headerId, now, state, !headerMotion, headerMotion, true);
        }
      }
      state.known.add(id);
      if (entering) {
        state.pending--;
        state.revealed = true;
      }
      revealBubble(message, content, id, now, state, entering, previous);
    }
    if (!state.scrollMode && footer) {
      const reserve = footerReserve(Math.ceil(footer.getBoundingClientRect().height));
      if (scroller.style.getPropertyValue('--shiye-footer-reserve') !== `${reserve}px`)
        scroller.style.setProperty('--shiye-footer-reserve', `${reserve}px`);
    }
    const target = denseTarget ?? Math.max(0, scroller.scrollHeight - scroller.clientHeight);
    if (state.scrollMode) {
      if (state.target !== target) {
        state.target = target;
        scroller.scrollTo({ top: target, behavior: 'smooth' });
      }
    } else scrollTopAccess.set.call(scroller, target);
    // Dense lists use compositor scrolling and opacity; they need no per-frame
    // message scan. Sparse row growth still reconciles its footer reserve.
    if (bubbleMotions.size && !state.scrollMode)
      motionFrame = requestAnimationFrame(updateSendMotion);
  }
  function recoverInstantAnchor(state) {
    const id = state.anchor?.dataset.messageId;
    if (!id) return false;
    const roots = [...state.list.querySelectorAll('.message-list-item')];
    let matches = roots.filter((node) => node.dataset.messageId === id);
    if (!matches.length) {
      const ids = [...state.candidates]
        .filter((node) => state.list.contains(node))
        .map((node) => node.dataset.messageId);
      let editor;
      window.dispatchEvent(
        new CustomEvent('shiye-editor-request', {
          detail: {
            receive: (value) => {
              editor = value;
            },
          },
        }),
      );
      let identities = editor?.resolveMessageIdentities?.(ids);
      if (!identities && readFrozenState) {
        const global = readFrozenState();
        const lists = Object.values(global.byTabId || {})
          .map((tab) => tab.messageLists?.at(-1))
          .filter(Boolean);
        const keys = new Set(lists.map((list) => `${list.chatId}:${list.threadId}:${list.type}`));
        if (keys.size === 1) {
          const byId = global.messages?.byChatId?.[lists[0].chatId]?.byId;
          identities = ids
            .map((candidateId) => {
              const message = byId?.[candidateId];
              return (
                message && {
                  id: String(message.id),
                  previousLocalId: String(message.previousLocalId || ''),
                }
              );
            })
            .filter(Boolean);
        }
      }
      if (!identities) return false;
      const aliases = new Set(
        identities.filter((item) => item.previousLocalId === id).map((item) => item.id),
      );
      matches = roots.filter((node) => aliases.has(node.dataset.messageId));
    }
    if (matches.length !== 1) return false;
    const anchor = matches[0];
    state.anchor = anchor;
    state.knownNodes.add(anchor);
    state.known.add(anchor.dataset.messageId);
    state.candidates.delete(anchor);
    return true;
  }
  function reconcileInstantAppend(records) {
    reconcileInstantAppendRecords(records);
    // A content-only render need not insert a Message root. Rebind even when
    // append reconciliation has nothing to consume, after its layout commit.
    reconcileOriginMotions();
  }
  function reconcileInstantAppendRecords(records) {
    const state = sendMotion;
    if (!state?.instant || state.list !== scroller || !scroller.isConnected) return;
    // Keep actual inserted roots even when their own/tail classes arrive later.
    // A confirmed integer ID alone is neither a new append nor a reason to reject one.
    for (const record of records || [])
      if (record.type === 'childList')
        for (const node of record.addedNodes) {
          if (!(node instanceof Element)) continue;
          if (node.matches('.Message') && !state.knownNodes.has(node)) state.candidates.add(node);
          for (const message of node.querySelectorAll('.Message'))
            if (!state.knownNodes.has(message)) state.candidates.add(message);
        }
    if (
      !state.candidates.size ||
      !footer?.isConnected ||
      Date.now() >= followUntil ||
      document.hidden ||
      document.body.dataset.shiyeRoomPending ||
      scroller.dataset.shiyeRestoring === 'true' ||
      (!state.anchor && state.baseline.size > 0)
    )
      return;
    if (
      state.anchor &&
      (!state.anchor.isConnected || !scroller.contains(state.anchor)) &&
      !recoverInstantAnchor(state)
    )
      return;
    let editor;
    window.dispatchEvent(
      new CustomEvent('shiye-editor-request', {
        detail: {
          receive(value) {
            editor = value;
          },
        },
      }),
    );
    const identities =
      editor?.resolveMessageIdentities?.(
        [...state.candidates].map((message) => message.dataset.messageId),
      ) || [];
    for (const identity of identities)
      if (state.known.has(String(identity.previousLocalId))) state.known.add(String(identity.id));
    const entering = [...state.candidates].filter((message) => {
      const id = message.dataset.messageId;
      return (
        scroller.contains(message) &&
        message.classList.contains('own') &&
        !state.knownNodes.has(message) &&
        !state.known.has(id)
      );
    });
    const currentTail = scroller.querySelector('.Message.last-in-list');
    // An earlier acknowledgement can temporarily sort after the newer local
    // fractional ID. Identity, not DOM tail order, determines an actual send.
    const tail = entering.find((message) => message === currentTail) || entering.at(-1);
    if (!tail || !state.pending) return;
    const arrivals = [];
    for (const message of entering) {
      state.known.add(message.dataset.messageId);
      state.knownNodes.add(message);
      state.candidates.delete(message);
      state.pending = Math.max(0, state.pending - 1);
      arrivals.push({ message, origin: state.origins.shift() ?? state.origin });
    }
    state.lastTail = tail;
    state.revealed = true;
    instantSizeObserver.observe(tail);
    commitInstantTail(state);
    if (state.fromInput)
      for (const arrival of arrivals) animateFromInput(arrival.message, state, arrival.origin);
  }
  function bindManagedFooter(list, currentFooter, reserve) {
    const valid =
      currentFooter?.isConnected &&
      list?.isConnected &&
      currentFooter.parentElement === list.parentElement &&
      Number.isFinite(reserve) &&
      reserve > 0;
    if (!valid) {
      if (list) delete list.dataset.shiyeFooterLayout;
      return;
    }
    if (list.style.getPropertyValue('--shiye-footer-reserve') !== `${reserve}px`)
      list.style.setProperty('--shiye-footer-reserve', `${reserve}px`);
    list.dataset.shiyeFooterLayout = 'managed';
  }
  function commitInstantTail(state) {
    if (
      sendMotion !== state ||
      !state.instant ||
      state.list !== scroller ||
      !state.list.isConnected ||
      !footer?.isConnected ||
      Date.now() >= followUntil ||
      document.hidden ||
      document.body.dataset.shiyeRoomPending ||
      state.list.dataset.shiyeRestoring === 'true'
    )
      return;
    // One intentional synchronous layout commit after a real own append or size
    // change. A later frame could leave the new row underneath the footer.
    applySizing();
    const compact = reconcileSizing(footer.querySelector('#editable-message-text'));
    applyCompactInput(footer, compact);
    const reserve = Math.ceil(footer.getBoundingClientRect().height);
    bindManagedFooter(scroller, footer, reserve);
    const target = Math.max(0, scroller.scrollHeight - scroller.clientHeight);
    if (state.target !== target || Math.abs(scroller.scrollTop - target) > 1) {
      state.target = target;
      scroller.scrollTo({ top: target, behavior: 'auto' });
    }
  }
  function reconcileSendMotion(records) {
    if (!sendMotion) return;
    if (sendMotion.instant) {
      reconcileInstantAppend(records);
      return;
    }
    if (!sendMotion.scrollMode) {
      cancelAnimationFrame(motionFrame);
      updateSendMotion(performance.now());
    } else if (!motionFrame) {
      const generation = motionGeneration;
      motionFrame = true;
      measure(() => {
        if (generation === motionGeneration) updateSendMotion(performance.now());
      });
    }
  }
  reducedMotion.addEventListener('change', () => {
    if (reducedMotion.matches) stopSendMotion();
  });
  window.addEventListener('shiye-message-render-mode-changed', ({ detail }) => {
    // The setting can still work in this session if persistent storage is unavailable.
    const next = ['smooth', 'instant', 'legacy'].includes(detail)
      ? detail
      : readMessageRenderMode();
    if (next === messageRenderMode) return;
    stopSendMotion(true);
    followUntil = 0;
    restoredBottomScroller = undefined;
    scrollGesture++;
    if (scroller) delete scroller.dataset.shiyeFollowUntil;
    messageRenderMode = next;
    document.body.dataset.shiyeMessageRenderMode = next;
    schedule();
  });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) stopSendMotion();
  });
  try {
    const stored = Number(localStorage.getItem('shiye-input-cap-v2'));
    if (Number.isFinite(stored) && stored >= 36 && stored <= 2000) inputCap = stored;
    const manual = Number(localStorage.getItem('shiye-input-manual-height-v1'));
    if (Number.isFinite(manual) && manual >= 36 && manual <= 2000) manualHeight = manual;
  } catch {
    /* Keep the default in this session. */
  }
  function hasInputContent(editor) {
    return Boolean(
      editor &&
      (editor.textContent ||
        editor.querySelector('img,table,pre,blockquote') ||
        editor.children.length > 1),
    );
  }
  const compactInputStates = new WeakMap();
  function applyCompactInput(container, compact) {
    container.dataset.shiyeCompactInput = String(compact);
    compactInputStates.set(container, {
      editor: container.querySelector('#editable-message-text'),
      room: window.shiyeRoomUi?.currentId(),
      compact,
    });
  }
  function reconcileSizing(editor) {
    const inputBox = editor?.closest('.input-scroller');
    if (!inputBox) return false;
    // Measure the one-line floor before the scheduled sizing mutation; retain the requested preference.
    minimumManualHeight = Math.max(
      36,
      Math.ceil(
        (Number.parseFloat(getComputedStyle(editor).lineHeight) || 24) +
          (manualHeight < 48 ? 8 : 12),
      ),
    );
    const hasContent = hasInputContent(editor);
    const hasHardBreak =
      hasContent &&
      (editor.children.length > 1 || editor.querySelector('br:not(.ProseMirror-trailingBreak)'));
    if (manualHeight > 80 || hasHardBreak) return false;
    // An explicit low manual height and an empty auto editor keep the compact row.
    if (manualHeight !== undefined || !hasContent) return true;
    const previous = compactInputStates.get(editor.closest('.middle-column-footer'));
    const wasTall =
      previous?.editor === editor &&
      previous.room === window.shiyeRoomUi?.currentId() &&
      !previous.compact;
    // Widening a three-line compact editor can make it two lines. Only leave
    // the tall row at one natural line, avoiding a width/height feedback loop.
    const threshold = wasTall
      ? (Number.parseFloat(getComputedStyle(inputBox).minHeight) || 40) + 1
      : 80;
    return inputBox.getBoundingClientRect().height <= threshold;
  }
  // Hold the draft viewport independently of the message-list scroll owner.
  let resizingView;
  const resizeSelections = new WeakMap();
  // The rich-editor formatter dismisses its selection in document capture.
  // Capture before that handler so resizing keeps the user's selected range.
  window.addEventListener(
    'pointerdown',
    (event) => {
      const handle = event.target.closest?.('.shiye-input-resizer');
      const editor = handle?.closest('.middle-column-footer')?.querySelector('#editable-message-text');
      const selection = getSelection();
      if (editor?.contains(selection?.anchorNode) && editor.contains(selection?.focusNode))
        resizeSelections.set(event, {
          anchor: selection.anchorNode, anchorOffset: selection.anchorOffset,
          focus: selection.focusNode, focusOffset: selection.focusOffset,
        });
    },
    true,
  );
  function retainResizingView() {
    const view = resizingView;
    if (
      !view || !view.footer.isConnected || !view.editor.isConnected ||
      view.editor !== view.footer.querySelector('#editable-message-text') ||
      view.room !== window.shiyeRoomUi?.currentId()
    ) return;
    const selection = getSelection();
    const saved = view.selection;
    if (
      saved && selection && view.editor.contains(saved.anchor) && view.editor.contains(saved.focus) &&
      (selection.anchorNode !== saved.anchor || selection.focusNode !== saved.focus ||
        selection.anchorOffset !== saved.anchorOffset || selection.focusOffset !== saved.focusOffset)
    )
      selection.setBaseAndExtent(saved.anchor, saved.anchorOffset, saved.focus, saved.focusOffset);
    view.scroller.scrollTop = view.pinned ? view.scroller.scrollHeight : view.top;
  }
  function applySizing() {
    document.body.toggleAttribute('data-shiye-input-tight', manualHeight < 48);
    if (manualHeight === undefined) {
      document.body.style.setProperty('--shiye-input-cap', `${inputCap}px`);
      document.body.style.removeProperty('--shiye-input-manual-height');
    } else {
      // Keep the requested size; only its effective height follows the viewport.
      const tools = manualHeight > 80 ? 56 : 0;
      const effective = Math.max(
        minimumManualHeight,
        Math.min(manualHeight, innerHeight * 0.55 - tools),
      );
      document.body.style.setProperty('--shiye-input-cap', `${effective}px`);
      document.body.style.setProperty('--shiye-input-manual-height', `${effective}px`);
    }
  }
  const sizeObserver = new ResizeObserver((entries) => {
    if (entries.some((entry) => entry.target === messageContent)) contentSizeChanged = true;
    schedule();
  });
  function schedule() {
    if (!frame) {
      frame = true;
      measure(update);
    }
  }
  function measure(callback) {
    if (layout) return layout.measure(callback);
    let editor;
    window.dispatchEvent(
      new CustomEvent('shiye-editor-request', {
        detail: {
          receive(value) {
            editor = value;
          },
        },
      }),
    );
    if (editor?.measure) editor.measure(callback);
    else requestAnimationFrame(callback);
  }
  function mutate(callback) {
    if (layout) return layout.mutate(callback);
    let editor;
    window.dispatchEvent(
      new CustomEvent('shiye-editor-request', {
        detail: {
          receive(value) {
            editor = value;
          },
        },
      }),
    );
    if (editor?.mutate) editor.mutate(callback);
    else setTimeout(schedule, 100);
  }
  function update() {
    frame = undefined;
    const nextScroller =
      document.querySelector('#MiddleColumn .Transition_slide-active > .MessageList') ||
      document.querySelector('#MiddleColumn .MessageList');
    const nextFooter = [
      ...(nextScroller?.parentElement?.querySelectorAll(':scope > .middle-column-footer') || []),
    ].find((node) => {
      const rect = node.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0;
    });
    const nextContent = nextScroller?.querySelector('.messages-container');
    const nextEditor = nextFooter?.querySelector('#editable-message-text');
    if (
      nextFooter !== footer ||
      nextScroller !== scroller ||
      nextContent !== messageContent ||
      nextEditor !== sizedEditor
    ) {
      sizeObserver.disconnect();
      if (scroller) delete scroller.dataset.shiyeFooterLayout;
      footer = nextFooter;
      scroller = nextScroller;
      messageContent = nextContent;
      sizedEditor = nextEditor;
      contentSizeChanged = false;
      if (footer) sizeObserver.observe(footer);
      if (sizedEditor) sizeObserver.observe(sizedEditor);
      if (scroller) {
        ownSendScroll(scroller);
        sizeObserver.observe(scroller);
      }
      // Upstream footer clearance may change only container padding. Observe
      // the border box throughout editing, including after send-follow expires.
      if (messageContent) sizeObserver.observe(messageContent, { box: 'border-box' });
    }
    if (!footer || !scroller) return;
    const compact = reconcileSizing(footer.querySelector('#editable-message-text'));
    const reserve = footerReserve(Math.ceil(footer.getBoundingClientRect().height));
    const bottom = scroller.scrollHeight;
    const pinned = bottom - scroller.scrollTop - scroller.clientHeight < 80;
    const reserveChanged =
      scroller.style.getPropertyValue('--shiye-footer-reserve') !== `${reserve}px`;
    const contentChanged = contentSizeChanged;
    contentSizeChanged = false;
    const gesture = scrollGesture;
    const capturedFooter = footer;
    const capturedScroller = scroller;
    reconcileSendMotion();
    mutate(() => {
      if (!capturedScroller.isConnected || !capturedFooter.isConnected) return;
      applySizing();
      applyCompactInput(capturedFooter, compact);
      retainResizingView();
      bindManagedFooter(capturedScroller, capturedFooter, reserve);
      if (!capturedFooter.querySelector('.shiye-input-resizer')) installResizer(capturedFooter);
      if (
        sendMotion?.instant &&
        sendMotion.revealed &&
        sendMotion.list === capturedScroller &&
        (reserveChanged || contentChanged) &&
        gesture === scrollGesture
      )
        commitInstantTail(sendMotion);
      if (
        !document.body.dataset.shiyeRoomPending &&
        capturedScroller.dataset.shiyeRestoring !== 'true' &&
        (Date.now() < followUntil ||
          (pinned && (reserveChanged || contentChanged)) ||
          restoredBottomScroller === capturedScroller)
      )
        if (capturedScroller === scroller && gesture === scrollGesture) {
          // Commit footer clearance and tail positioning together, before the next paint.
          if (sendMotion?.list !== capturedScroller)
            capturedScroller.scrollTop = capturedScroller.scrollHeight;
          if (restoredBottomScroller === capturedScroller) restoredBottomScroller = undefined;
        }
    });
  }
  function followSend() {
    beginSendMotion();
    followUntil = Date.now() + 4000;
    if (scroller) scroller.dataset.shiyeFollowUntil = String(followUntil);
    window.dispatchEvent(new Event('shiye-stop-send-scroll'));
    schedule();
  }
  document.addEventListener(
    'keydown',
    (event) => {
      if (
        event.key === 'Enter' &&
        !event.shiftKey &&
        !event.isComposing &&
        event.keyCode !== 229 &&
        event.target.closest?.('#editable-message-text') &&
        !document.querySelector('#shiye-commands, dialog[open], .Modal.open')
      )
        followSend();
    },
    true,
  );
  document.addEventListener(
    'click',
    (event) => {
      const button = event.target.closest?.('.send, .send-button, [aria-label="发送消息"]');
      // Attachment confirmation has its own accepted-send event; counting both
      // the click and that event would consume two origins for a single send.
      if (button && footer?.contains(button) && !button.closest('.Modal')) followSend();
    },
    true,
  );
  document.addEventListener(
    'wheel',
    () => {
      stopSendMotion();
      followUntil = 0;
      restoredBottomScroller = undefined;
      if (scroller) delete scroller.dataset.shiyeFollowUntil;
      scrollGesture++;
    },
    { capture: true, passive: true },
  );
  document.addEventListener(
    'touchstart',
    () => {
      stopSendMotion();
      followUntil = 0;
      restoredBottomScroller = undefined;
      if (scroller) delete scroller.dataset.shiyeFollowUntil;
      scrollGesture++;
    },
    { passive: true },
  );
  document.addEventListener(
    'pointerdown',
    (event) => {
      if (!event.target.closest?.('.MessageList, .shiye-input-resizer')) return;
      stopSendMotion();
      followUntil = 0;
      restoredBottomScroller = undefined;
      if (scroller) delete scroller.dataset.shiyeFollowUntil;
      scrollGesture++;
    },
    true,
  );
  window.addEventListener('shiye-media-confirmed', followSend);
  for (const type of [
    'shiye-open-room',
    'shiye-focus-message',
    'shiye-room-switch-start',
    'shiye-message-navigation',
    'shiye-edit-submit',
  ])
    window.addEventListener(type, () => {
      stopSendMotion();
      followUntil = 0;
      restoredBottomScroller = undefined;
      scrollGesture++;
      if (scroller) delete scroller.dataset.shiyeFollowUntil;
    });
  window.addEventListener('shiye-room-view-ready', () => {
    const list =
      document.querySelector('#MiddleColumn .Transition_slide-active > .MessageList') ||
      document.querySelector('#MiddleColumn .MessageList');
    // The footer can grow while switching has suspended its follower. Reconcile once after reveal.
    if (list && list.scrollHeight - list.scrollTop - list.clientHeight < 48)
      restoredBottomScroller = list;
    schedule();
  });
  // A local media drop must also work on touch/high-DPI hosts without the upstream DropArea.
  let mediaDragTimer;
  let lastDropDiagnostic = 0;
  function dropDiagnostic(event) {
    if (event.type !== 'drop' && Date.now() - lastDropDiagnostic < 1500) return;
    lastDropDiagnostic = Date.now();
    window.chrome?.webview?.postMessage({
      kind: 'media-drop-diagnostic',
      phase: event.type,
      formats: [...(event.dataTransfer?.types || [])]
        .join(',')
        .replace(/[^a-zA-Z0-9\/,;=._ +-]/g, '')
        .slice(0, 500),
      files: event.dataTransfer?.files?.length || 0,
      items: event.dataTransfer?.items?.length || 0,
      inChat: !!event.target.closest?.('#MiddleColumn'),
    });
  }
  const isMedia = (file) => file.type.startsWith('image/') || file.type.startsWith('video/');
  function dragMedia(event) {
    if (
      !event.target.closest?.('#MiddleColumn') ||
      document.querySelector('.Modal.open, dialog[open]')
    )
      return false;
    return (
      window.shiyeDroppedMedia?.isCandidate(event.dataTransfer) ||
      (event.dataTransfer && !event.dataTransfer.types?.length) ||
      [...(event.dataTransfer?.items || [])].some(
        (item) =>
          item.kind === 'file' &&
          (item.type.startsWith('image/') || item.type.startsWith('video/')),
      )
    );
  }
  function clearMediaDrag() {
    delete document.body.dataset.shiyeMediaDrag;
    clearTimeout(mediaDragTimer);
  }
  for (const type of ['dragenter', 'dragover'])
    document.addEventListener(
      type,
      (event) => {
        dropDiagnostic(event);
        if (!dragMedia(event)) return;
        event.preventDefault();
        event.stopImmediatePropagation();
        event.dataTransfer.dropEffect = 'copy';
        document.body.dataset.shiyeMediaDrag = 'true';
        clearTimeout(mediaDragTimer);
        mediaDragTimer = setTimeout(clearMediaDrag, 1200);
      },
      true,
    );
  document.addEventListener(
    'drop',
    (event) => {
      dropDiagnostic(event);
      if (!dragMedia(event)) {
        clearMediaDrag();
        return;
      }
      let captured;
      try {
        captured = window.shiyeDroppedMedia?.capture(event);
      } catch (error) {
        captured = Promise.reject(error);
      }
      const files = captured || [...event.dataTransfer.files].filter(isMedia);
      if (!captured && !files.length) {
        clearMediaDrag();
        if (event.dataTransfer && !event.dataTransfer.types?.length) {
          event.preventDefault();
          window.getActions?.()?.showNotification({
            message: '来源没有交付图片原件；已记录拖入格式，可尝试复制后粘贴或另存后拖入',
          });
        }
        return;
      }
      event.preventDefault();
      event.stopImmediatePropagation();
      clearMediaDrag();
      let editor;
      window.dispatchEvent(
        new CustomEvent('shiye-editor-request', {
          detail: {
            receive: (value) => {
              editor = value;
            },
          },
        }),
      );
      Promise.resolve(files)
        .then((owned) => {
          if (!editor) throw Error('请先打开一个会话，再拖入图片');
          if (
            !editor.input?.isConnected ||
            document.querySelector('#editable-message-text') !== editor.input
          )
            throw Error('会话已切换，请在当前会话重新拖入图片');
          editor.files(owned);
        })
        .catch((error) => window.getActions?.()?.showNotification({ message: error.message }));
    },
    true,
  );
  document.addEventListener(
    'dragleave',
    (event) => {
      if (!event.relatedTarget) clearMediaDrag();
    },
    true,
  );
  window.addEventListener('blur', clearMediaDrag);
  document.addEventListener(
    'load',
    (event) => {
      if (event.target.closest?.('.Message')) schedule();
    },
    true,
  );
  function installResizer(container) {
    const handle = document.createElement('button');
    handle.type = 'button';
    handle.className = 'shiye-input-resizer';
    handle.setAttribute('data-stricterdom-ignore', '');
    handle.setAttribute('aria-label', '拖动调整输入框；方向键调高低，双击或Home恢复自动高度');
    let start;
    let initial;
    function resize(height) {
      const value = Math.round(Math.max(36, Math.min(2000, height)));
      manualHeight = value;
      applySizing();
      retainResizingView();
      try {
        localStorage.setItem('shiye-input-manual-height-v1', value);
      } catch {
        /* Keep this session's size. */
      }
      schedule();
    }
    handle.onpointerdown = (event) => {
      start = event.clientY;
      initial =
        container
          .querySelector('#editable-message-text')
          ?.closest('.input-scroller')
          ?.getBoundingClientRect().height || 80;
      const editor = container.querySelector('#editable-message-text');
      const inputScroller = editor?.closest('.input-scroller');
      resizingView = inputScroller ? {
        editor, footer: container, scroller: inputScroller, room: window.shiyeRoomUi?.currentId(),
        top: inputScroller.scrollTop,
        selection: resizeSelections.get(event),
        pinned: inputScroller.scrollHeight - inputScroller.clientHeight - inputScroller.scrollTop <= 2,
      } : undefined;
      retainResizingView();
      resizingInput = true;
      reportBusy();
      handle.setPointerCapture(event.pointerId);
      event.preventDefault();
    };
    handle.onpointermove = (event) => {
      if (handle.hasPointerCapture(event.pointerId)) resize(initial + start - event.clientY);
    };
    handle.onpointerup = (event) => {
      retainResizingView();
      if (handle.hasPointerCapture(event.pointerId)) handle.releasePointerCapture(event.pointerId);
      resizingInput = false;
      reportBusy();
    };
    handle.onpointercancel = handle.onlostpointercapture = () => {
      resizingView = undefined;
      resizingInput = false;
      reportBusy();
    };
    handle.onkeydown = (event) => {
      if (event.key === 'Home') {
        event.preventDefault();
        event.stopPropagation();
        resetHeight();
        return;
      }
      if (!['ArrowUp', 'ArrowDown'].includes(event.key)) return;
      event.preventDefault();
      event.stopPropagation();
      resize(
        (container
          .querySelector('#editable-message-text')
          ?.closest('.input-scroller')
          ?.getBoundingClientRect().height || 80) + (event.key === 'ArrowUp' ? 24 : -24),
      );
    };
    function resetHeight() {
      inputCap = 160;
      manualHeight = undefined;
      try {
        localStorage.setItem('shiye-input-cap-v2', inputCap);
        localStorage.removeItem('shiye-input-manual-height-v1');
      } catch {
        /* Session-only. */
      }
      applySizing();
      schedule();
    }
    handle.ondblclick = resetHeight;
    container.prepend(handle);
  }
  document.addEventListener(
    'input',
    (event) => {
      if (event.target.closest?.('#editable-message-text')) schedule();
    },
    true,
  );
  let previousModal = false;
  let previousReply;
  let composing = false;
  let busyState;
  function reportBusy(typing = false) {
    const busy =
      composing ||
      resizingInput ||
      openingImage ||
      Boolean(openedUrl) ||
      Boolean(
        document.querySelector(
          'dialog[open], .Modal.open, #MediaViewer, .Menu .bubble.open, #shiye-commands',
        ),
      );
    if (busy !== busyState || typing)
      post({ kind: 'dock-state', busy, ...(typing ? { typing: true } : {}) });
    busyState = busy;
  }
  document.addEventListener(
    'compositionstart',
    () => {
      composing = true;
      reportBusy();
    },
    true,
  );
  document.addEventListener(
    'compositionend',
    () => {
      composing = false;
      reportBusy(true);
    },
    true,
  );
  document.addEventListener('keydown', () => reportBusy(true), true);
  new MutationObserver((records) => {
    schedule();
    if (
      records.some((record) => record.type === 'childList') ||
      (sendMotion?.instant && records.some((record) => record.type === 'attributes'))
    )
      reconcileSendMotion(records);
    const modal = Boolean(document.querySelector('.Modal.open, dialog[open], #MediaViewer'));
    const reply = document.querySelector('.ComposerEmbeddedMessage.open');
    const replySignature = reply?.textContent;
    if (!modal && previousModal && !openingImage && !openedUrl) {
      setTimeout(() => window.dispatchEvent(new Event('shiye-hotkey-resume')), 100);
    } else if (reply && replySignature !== previousReply) {
      setTimeout(() => window.dispatchEvent(new Event('shiye-focus-end')), 100);
    }
    previousModal = modal;
    previousReply = replySignature;
    reportBusy();
  }).observe(document.body, {
    childList: true,
    characterData: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['class', 'data-message-id'],
  });
  schedule();
  let openingImage = false;
  let openedUrl;
  let pendingImage;
  window.addEventListener('shiye-view-image', async ({ detail }) => {
    if (!window.chrome?.webview || openingImage || openedUrl === detail.url) return;
    openingImage = true;
    reportBusy();
    const id = crypto.randomUUID();
    try {
      const blob = await (await fetch(detail.url)).blob();
      if (!blob.type.startsWith('image/')) throw Error('图片格式暂不支持独立查看');
      if (blob.size > 128 * 1024 * 1024) throw Error('图片超过独立查看器的 128 MB 上限');
      pendingImage = { id, close: detail.close, fail: detail.fail, url: detail.url };
      const bytes = new Uint8Array(await blob.arrayBuffer());
      const mime =
        bytes[0] === 0x89 && bytes[1] === 0x50
          ? 'image/png'
          : bytes[0] === 0x47 && bytes[1] === 0x49
            ? 'image/gif'
            : bytes[0] === 0x52 && bytes[8] === 0x57
              ? 'image/webp'
              : blob.type;
      post({ kind: 'image-start', id, mime });
      for (let offset = 0; offset < bytes.length; offset += 128 * 1024) {
        const part = bytes.subarray(offset, offset + 128 * 1024);
        let binary = '';
        for (let i = 0; i < part.length; i += 8192)
          binary += String.fromCharCode(...part.subarray(i, i + 8192));
        post({ kind: 'image-chunk', id, offset, bytes: btoa(binary) });
      }
      post({ kind: 'image-open', id });
    } catch (error) {
      post({ kind: 'image-cancel', id });
      pendingImage = undefined;
      openingImage = false;
      detail.fail?.();
      reportBusy();
      notify(`独立图片窗口未能打开：${error.message}。可继续在当前窗口查看。`);
    }
  });
  window.chrome?.webview?.addEventListener('message', ({ data }) => {
    if (data.kind === 'image-result' && data.id === pendingImage?.id) {
      openingImage = false;
      if (data.error) {
        notify(data.error);
        pendingImage.fail?.();
      } else {
        openedUrl = pendingImage.url;
        pendingImage.close();
      }
      pendingImage = undefined;
      reportBusy();
    }
    if (data.kind === 'image-closed') {
      openedUrl = undefined;
      reportBusy();
      window.dispatchEvent(new Event('shiye-hotkey-resume'));
    }
  });
  // Reserved UI adapter: connecting a program requires an explicit implementation later.
  let programAdapter;
  window.shiyeProgramPort = Object.freeze({
    version: 1,
    connect(adapter) {
      if (!adapter || typeof adapter.send !== 'function' || typeof adapter.subscribe !== 'function')
        throw Error('程序适配器需要 send 和 subscribe');
      if (programAdapter) throw Error('程序适配器已连接，请先断开');
      programAdapter = adapter;
      return () => {
        if (programAdapter === adapter) programAdapter = undefined;
      };
    },
    async send(message) {
      if (!programAdapter) throw Error('程序消息后端尚未连接');
      return programAdapter.send(message);
    },
    subscribe(listener) {
      if (!programAdapter) throw Error('程序消息后端尚未连接');
      return programAdapter.subscribe(listener);
    },
    get connected() {
      return Boolean(programAdapter);
    },
  });
})();
