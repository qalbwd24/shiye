import { randomUUID, createHash } from 'node:crypto';
import { Marked } from '../../../public/vendor/marked.js';
import { fail } from '../http.mjs';
import {
  commitChatUnit,
  canonicalChatHTML,
  withdrawChatUnit,
  chatUnitId,
} from './message-store.mjs';

const escape = (s) =>
  String(s).replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c],
  );
const parser = new Marked({
  gfm: true,
  breaks: true,
  renderer: {
    checkbox: ({ checked }) => (checked ? '☑ ' : '☐ '),
    html: ({ text }) => escape(text),
    image: ({ text }) => escape(`[图片：${text}]`),
    link({ href, tokens }) {
      const label = this.parser.parseInline(tokens);
      return /^(https?:|mailto:)/i.test(href) ? `<a href="${escape(href)}">${label}</a>` : label;
    },
  },
  extensions: [
    {
      name: 'highlight',
      level: 'inline',
      start: (s) => s.indexOf('=='),
      tokenizer(s) {
        const m = /^==(?=\S)([^\n]+?\S|\S)==/.exec(s);
        return m
          ? { type: 'highlight', raw: m[0], tokens: this.lexer.inlineTokens(m[1]) }
          : undefined;
      },
      renderer(token) {
        return `<mark>${this.parser.parseInline(token.tokens)}</mark>`;
      },
    },
  ],
});
const uuid = (s) => typeof s === 'string' && /^[a-f0-9-]{36}$/i.test(s);
export const parseChatMarkdown = (text) => parser.parse(text);
const hash = (v) => createHash('sha256').update(JSON.stringify(v)).digest('hex');
const owned = (entry) => hash([entry.title, entry.content, entry.category, entry.attachments]);
const stamp = (value) =>
  new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).format(new Date(value));

export function validateChatRoom(input, db, { allowUncategorized = false } = {}) {
  if (
    !input ||
    !uuid(input.sourceId) ||
    typeof input.id !== 'string' ||
    !/^-?\d{1,20}$/.test(input.id)
  )
    throw fail(400, '对话标识不正确');
  if (typeof input.title !== 'string' || !input.title.trim() || input.title.length > 80)
    throw fail(400, '请输入对话名称');
  if (!Number.isFinite(input.idleHours) || input.idleHours < 0.1 || input.idleHours > 8760)
    throw fail(400, '归篇间隔应在 0.1–8760 小时之间');
  const category =
    allowUncategorized &&
    (input.category === undefined || input.category === null || input.category === '')
      ? null
      : input.category;
  if (
    (category !== null && (typeof category !== 'string' || !db.categories.includes(category))) ||
    (category === null && !allowUncategorized)
  )
    throw fail(409, '请从拾页现有分类中选择；分类可能已改名');
  return {
    sourceId: input.sourceId,
    id: input.id,
    title: input.title.trim(),
    category,
    idleHours: input.idleHours,
  };
}

export function saveChatRoom(db, input, options) {
  const room = validateChatRoom(input, db, options);
  db.chatJournal ||= { version: 1, rooms: [] };
  const i = db.chatJournal.rooms.findIndex((r) => r.sourceId === room.sourceId && r.id === room.id);
  if (i < 0) db.chatJournal.rooms.push(room);
  else db.chatJournal.rooms[i] = { ...db.chatJournal.rooms[i], ...room };
  return room;
}

export function validateChatMessages(input, db) {
  if (
    !input ||
    !uuid(input.sourceId) ||
    !Array.isArray(input.messages) ||
    input.messages.length > 50
  )
    throw fail(400, '消息批次格式不正确');
  const room = db.chatJournal?.rooms.find(
    (r) => r.sourceId === input.sourceId && r.id === input.roomId,
  );
  if (!room || typeof room.category !== 'string' || !db.categories.includes(room.category))
    throw fail(409, '请先选择分类并保存对话设置');
  const messages = input.messages.map((m) => {
    if (
      m &&
      typeof m.id === 'string' &&
      /^\d{1,20}$/.test(m.id) &&
      findWithdrawal(db, input.sourceId, input.roomId, m.id)
    )
      return { id: m.id, withdrawn: true };
    if (
      !m ||
      typeof m.id !== 'string' ||
      !/^\d{1,20}$/.test(m.id) ||
      !Number.isFinite(Date.parse(m.sentAt)) ||
      Date.parse(m.sentAt) > Date.now() + 300000 ||
      typeof m.text !== 'string' ||
      m.text.length > 500000 ||
      !Array.isArray(m.attachments) ||
      m.attachments.length > 100 ||
      !m.attachments.every((id) => db.media.some((a) => a.id === id)) ||
      (!m.text.trim() && !m.attachments.length)
    )
      throw fail(400, '消息正文、时间或附件不正确');
    if (m.replyTo !== undefined && (typeof m.replyTo !== 'string' || !/^\d{1,20}$/.test(m.replyTo)))
      throw fail(400, '引用消息标识不正确');
    if (
      m.replacementOf !== undefined &&
      (typeof m.replacementOf !== 'string' ||
        !/^\d{1,20}$/.test(m.replacementOf) ||
        m.replacementOf === m.id)
    )
      throw fail(400, '替代消息标识不正确');
    if (
      m.replacementRootId !== undefined &&
      (!m.replacementOf ||
        typeof m.replacementRootId !== 'string' ||
        !/^\d{1,20}$/.test(m.replacementRootId) ||
        m.replacementRootId === m.id)
    )
      throw fail(400, '替代消息根标识不正确');
    return {
      id: m.id,
      sentAt: new Date(m.sentAt).toISOString(),
      text: m.text,
      attachments: [...new Set(m.attachments)],
      ...(m.replyTo ? { replyTo: m.replyTo } : {}),
      ...(m.replacementOf ? { replacementOf: m.replacementOf } : {}),
      ...(m.replacementRootId ? { replacementRootId: m.replacementRootId } : {}),
    };
  });
  return {
    room,
    messages: messages.sort(
      (a, b) =>
        Number(!!b.withdrawn) - Number(!!a.withdrawn) ||
        (a.withdrawn ? 0 : Date.parse(a.sentAt) - Date.parse(b.sentAt)) ||
        (BigInt(a.id) < BigInt(b.id) ? -1 : BigInt(a.id) > BigInt(b.id) ? 1 : 0),
    ),
  };
}

export function projectChatEntry(
  entry,
  db,
  now,
  { historical = false, preserveRevision = false } = {},
) {
  const journal = entry.chatJournal;
  entry.content = journal.messages
    .map((m) => {
      const media = m.attachments
        .map((id) => {
          const item = db.media.find((a) => a.id === id);
          return item.type.startsWith('image/')
            ? `<p><img src="/media/${id}" alt="${escape(item.name)}"></p>`
            : `<p>附件：${escape(item.name)}（${escape(item.type)}）</p>`;
        })
        .join('');
      const canonical = m.withdrawn
        ? '<p>消息已撤回</p>'
        : historical
          ? null
          : canonicalChatHTML(db, entry, m);
      return `<p><strong>${escape(stamp(m.sentAt))}</strong>${m.replyTo ? ` · 引用消息 #${escape(m.replyTo)}` : ''}</p>${canonical ?? parser.parse(m.text) + media}`;
    })
    .join('<hr>');
  entry.attachments = [...new Set(journal.messages.flatMap((m) => m.attachments))];
  if (!preserveRevision) {
    entry.updatedAt = new Date(now).toISOString();
    entry.revision++;
  }
  journal.projectionHash = owned(entry);
}
const project = projectChatEntry;

function isolatedDeferredEntry(room, message, now) {
  return {
    id: randomUUID(),
    title: `${room.title} · ${stamp(message.sentAt).slice(0, 16)}`,
    content: '',
    contentFormat: 'html',
    markdownSource: null,
    markdownHtml: null,
    category: room.category,
    date: message.sentAt,
    createdAt: new Date(now).toISOString(),
    updatedAt: new Date(now).toISOString(),
    revision: 0,
    attachments: [],
    tags: [],
    history: [],
    deleted: false,
    hidden: false,
    draft: false,
    pinned: false,
    chatJournal: {
      version: 1,
      sourceId: room.sourceId,
      roomId: room.id,
      title: room.title,
      category: room.category,
      idleHours: room.idleHours,
      status: 'closed',
      closeReason: 'deferred-media',
      firstAt: message.sentAt,
      lastAt: message.sentAt,
      deadline: new Date(Date.parse(message.sentAt) + room.idleHours * 3600000).toISOString(),
      messages: [],
    },
  };
}

/** Stable message IDs make lost acknowledgements and restarts safe to retry. */
export function appendChatMessages(db, input, now = Date.now(), options = {}) {
  const checked = validateChatMessages(input, db);
  const room = checked.room;
  const owner = db.chatJournal?.rooms.find(
    (r) => r.sourceId === room.sourceId && r.id === room.id,
  )?.messageOwner;
  if (owner === 'conversation-services-v1' && !options.conversationWriter)
    throw fail(409, '此会话已由统一会话写口维护，请停用旧归档写口');
  const messages = checked.messages.map((message) =>
    options.actor && !message.withdrawn
      ? { ...message, actor: structuredClone(options.actor), ...options.messageMetadata }
      : message,
  );
  const entries = db.entries.filter(
    (e) => e.chatJournal?.sourceId === room.sourceId && e.chatJournal.roomId === room.id,
  );
  const byMessage = new Map(
    entries.flatMap((e) => e.chatJournal.messages.map((m) => [m.id, { entry: e, message: m }])),
  );
  let latest = entries.sort(
    (a, b) => Date.parse(b.chatJournal.lastAt) - Date.parse(a.chatJournal.lastAt),
  )[0];
  const accepted = [];
  for (const message of messages) {
    if (message.withdrawn) {
      accepted.push(chatMessageReceipt(db, room.sourceId, room.id, message.id));
      continue;
    }
    const old = byMessage.get(message.id);
    if (old) {
      if (hash(old.message) !== hash(message))
        throw fail(409, '已归档消息内容不同，已保留两端内容，请勿覆盖');
      accepted.push({ id: message.id, entryId: old.entry.id });
      continue;
    }
    const at = Date.parse(message.sentAt);
    if (message.replacementOf) {
      let original = byMessage.get(message.replacementOf);
      const withdrawal = findWithdrawal(db, room.sourceId, room.id, message.replacementOf);
      if (!withdrawal || (original && !original.message.withdrawn))
        throw fail(409, '原消息未撤回，不能定位替代消息');
      if (message.sentAt !== withdrawal.sentAt) throw fail(409, '替代消息必须保留原消息时间');
      const actorKey = (actor) =>
        !actor || (actor.kind === 'self' && actor.id === 'self') ? 'self' : hash(actor);
      let bridgeRoot;
      if (message.replacementRootId) {
        const rootWithdrawal = findWithdrawal(
          db,
          room.sourceId,
          room.id,
          message.replacementRootId,
        );
        const root = byMessage.get(message.replacementRootId);
        if (
          !rootWithdrawal ||
          rootWithdrawal.sentAt !== message.sentAt ||
          (root &&
            (!root.message.withdrawn ||
              root.message.sentAt !== message.sentAt ||
              actorKey(root.message.actor) !== actorKey(message.actor)))
        )
          throw fail(409, '替代根消息作用域、时间或作者不一致');
        if (original) {
          const seen = new Set();
          let cursor = original;
          let connected = false;
          while (cursor && !seen.has(cursor.message.id)) {
            seen.add(cursor.message.id);
            if (
              cursor.message.id === message.replacementRootId ||
              (!root && cursor.message.replacementRootId === message.replacementRootId)
            ) {
              connected = true;
              break;
            }
            cursor = byMessage.get(cursor.message.replacementOf);
          }
          if (!connected || (root && root.entry !== original.entry))
            throw fail(409, '替代根消息不属于原消息链');
        } else if (root) {
          bridgeRoot = root;
          const visited = new Set();
          while (bridgeRoot) {
            const tip = bridgeRoot.message;
            const retired = findWithdrawal(db, room.sourceId, room.id, tip.id);
            if (
              visited.has(tip.id) ||
              !tip.withdrawn ||
              !retired ||
              tip.sentAt !== message.sentAt ||
              retired.sentAt !== message.sentAt ||
              actorKey(tip.actor) !== actorKey(message.actor)
            )
              throw fail(409, '原消息链存在未撤回或冲突后继，请重新读取');
            visited.add(tip.id);
            const children = root.entry.chatJournal.messages.filter(
              (item) => item.replacementOf === tip.id,
            );
            if (children.length > 1) throw fail(409, '原消息链存在分叉，请重新读取');
            if (!children.length) break;
            bridgeRoot = { entry: root.entry, message: children[0] };
          }
          original = {
            entry: root.entry,
            message: {
              id: message.replacementOf,
              sentAt: withdrawal.sentAt,
              text: '',
              attachments: [],
              withdrawn: true,
              replacementOf: bridgeRoot.message.id,
              ...(root.message.actor ? { actor: structuredClone(root.message.actor) } : {}),
            },
          };
        }
      }
      const detached = !original;
      if (detached) {
        const tombstone = {
          id: message.replacementOf,
          sentAt: withdrawal.sentAt,
          text: '',
          attachments: [],
          withdrawn: true,
        };
        original = {
          message: tombstone,
          entry: {
            id: randomUUID(),
            title: `${room.title} · ${stamp(message.sentAt).slice(0, 16)}`,
            content: '',
            contentFormat: 'html',
            markdownSource: null,
            markdownHtml: null,
            category: room.category,
            date: message.sentAt,
            createdAt: new Date(now).toISOString(),
            updatedAt: new Date(now).toISOString(),
            revision: 0,
            attachments: [],
            tags: [],
            history: [],
            deleted: false,
            hidden: false,
            draft: false,
            pinned: false,
            chatJournal: {
              version: 1,
              sourceId: room.sourceId,
              roomId: room.id,
              title: room.title,
              category: room.category,
              idleHours: room.idleHours,
              status: 'closed',
              firstAt: message.sentAt,
              lastAt: message.sentAt,
              deadline: new Date(at + room.idleHours * 3600000).toISOString(),
              messages: [tombstone],
            },
          },
        };
      }
      const entry = original.entry;
      if (entry.deleted || (!detached && owned(entry) !== entry.chatJournal.projectionHash))
        throw fail(409, '原归篇已删除或修改，未覆盖');
      if (message.sentAt !== original.message.sentAt || message.sentAt !== withdrawal.sentAt)
        throw fail(409, '替代消息必须保留原消息时间');
      if (actorKey(message.actor) !== actorKey(original.message.actor))
        throw fail(409, '替代消息作者与原消息不一致');
      if (entry.chatJournal.messages.some((item) => item.replacementOf === message.replacementOf))
        throw fail(409, '原消息已有替代消息，请重新读取');
      commitChatUnit(db, entry, message, parser.parse(message.text), {
        ...options,
        messageUnitsEnabled: true,
      });
      const index = entry.chatJournal.messages.indexOf(bridgeRoot?.message || original.message);
      entry.chatJournal.messages.splice(
        index + 1,
        0,
        ...(bridgeRoot ? [original.message] : []),
        message,
      );
      project(entry, db, now);
      if (detached) {
        db.entries.unshift(entry);
      }
      if (detached || bridgeRoot) byMessage.set(original.message.id, original);
      byMessage.set(message.id, { entry, message });
      accepted.push({ id: message.id, entryId: entry.id });
      continue;
    }
    if (options.deferredMedia && latest) {
      const last = Date.parse(latest.chatJournal.lastAt),
        first = Date.parse(latest.chatJournal.firstAt);
      const safe =
        latest.chatJournal.status === 'open' &&
        !latest.deleted &&
        !latest.hidden &&
        !latest.draft &&
        owned(latest) === latest.chatJournal.projectionHash &&
        latest.chatJournal.category === room.category &&
        now < Date.parse(latest.chatJournal.deadline) &&
        Math.abs(last - at) < latest.chatJournal.idleHours * 3600000;
      const target = safe ? latest : isolatedDeferredEntry(room, message, now);
      commitChatUnit(db, target, message, parser.parse(message.text), options);
      // Insert around complete replacement chains, leaving every existing pair
      // in its original relative order, including equal-time successor groups.
      const roots = new Map(target.chatJournal.messages.map((item) => [item.id, item]));
      const rootId = (item) => {
        const seen = new Set();
        let current = item;
        while (current.replacementOf && roots.has(current.replacementOf) && !seen.has(current.id)) {
          seen.add(current.id);
          current = roots.get(current.replacementOf);
        }
        return current.replacementRootId || current.replacementOf || current.id;
      };
      const position = target.chatJournal.messages.findIndex(
        (item) =>
          Date.parse(item.sentAt) > at ||
          (Date.parse(item.sentAt) === at && BigInt(rootId(item)) > BigInt(message.id)),
      );
      target.chatJournal.messages.splice(
        position < 0 ? target.chatJournal.messages.length : position,
        0,
        message,
      );
      if (safe) {
        target.chatJournal.firstAt = new Date(Math.min(first, at)).toISOString();
        target.chatJournal.lastAt = new Date(Math.max(last, at)).toISOString();
        target.chatJournal.deadline = new Date(
          Math.max(last, at) + target.chatJournal.idleHours * 3600000,
        ).toISOString();
      } else db.entries.unshift(target);
      project(target, db, now);
      byMessage.set(message.id, { entry: target, message });
      accepted.push({ id: message.id, entryId: target.id });
      continue;
    }
    if (latest && at < Date.parse(latest.chatJournal.lastAt))
      throw fail(409, '消息时间早于已归档记录，请保留本地消息并检查时间');
    if (
      options.serviceParticipant &&
      latest &&
      (latest.deleted ||
        latest.hidden ||
        latest.draft ||
        owned(latest) !== latest.chatJournal.projectionHash ||
        (latest.chatJournal.status === 'closed' &&
          latest.chatJournal.category === room.category &&
          at - Date.parse(latest.chatJournal.lastAt) < latest.chatJournal.idleHours * 3600000))
    )
      throw Object.assign(fail(409, '后台服务不能重写已关闭或手工维护的归篇'), {
        code: 'PROGRAM_SEGMENT_PROTECTED',
      });
    const manual =
      latest && (latest.deleted || owned(latest) !== latest.chatJournal.projectionHash);
    if (manual) {
      latest.chatJournal.status = 'closed';
      latest.chatJournal.closeReason = 'edited-in-diary';
    }
    if (
      !latest ||
      manual ||
      at - Date.parse(latest.chatJournal.lastAt) >= latest.chatJournal.idleHours * 3600000 ||
      latest.chatJournal.category !== room.category
    ) {
      if (latest && latest.chatJournal.status !== 'closed') latest.chatJournal.status = 'closed';
      latest = {
        id: randomUUID(),
        title: `${room.title} · ${stamp(message.sentAt).slice(0, 16)}`,
        content: '',
        contentFormat: 'html',
        markdownSource: null,
        markdownHtml: null,
        category: room.category,
        date: message.sentAt,
        createdAt: new Date(now).toISOString(),
        updatedAt: new Date(now).toISOString(),
        revision: 0,
        attachments: [],
        tags: [],
        history: [],
        deleted: false,
        hidden: false,
        draft: false,
        pinned: false,
        chatJournal: {
          version: 1,
          sourceId: room.sourceId,
          roomId: room.id,
          title: room.title,
          category: room.category,
          idleHours: room.idleHours,
          status: 'open',
          firstAt: message.sentAt,
          lastAt: message.sentAt,
          messages: [],
        },
      };
      db.entries.unshift(latest);
    }
    commitChatUnit(db, latest, message, parser.parse(message.text), options);
    latest.chatJournal.messages.push(message);
    latest.chatJournal.lastAt = message.sentAt;
    latest.chatJournal.deadline = new Date(
      at + latest.chatJournal.idleHours * 3600000,
    ).toISOString();
    latest.chatJournal.status = now >= Date.parse(latest.chatJournal.deadline) ? 'closed' : 'open';
    project(latest, db, now);
    byMessage.set(message.id, { entry: latest, message });
    accepted.push({ id: message.id, entryId: latest.id });
  }
  return { accepted };
}

export function closeIdleChatEntries(db, now = Date.now()) {
  let closed = 0;
  for (const entry of db.entries) {
    const j = entry.chatJournal;
    if (j?.status === 'open' && Date.parse(j.deadline) <= now) {
      j.status = 'closed';
      closed++;
    }
  }
  return closed;
}

export function rebuildChatProjection(entry, db) {
  const revision = entry.revision,
    updatedAt = entry.updatedAt;
  project(entry, db, Date.parse(updatedAt) || Date.now());
  entry.revision = revision;
  entry.updatedAt = updatedAt;
}

export function scrubChatMessageHistory(entry, messageId, db, now = Date.now()) {
  for (const snapshot of [...(entry.history || []), ...(entry.restoredFrom?.history || [])]) {
    scrubChatMessageHistory(snapshot, messageId, db, now);
    const archived = snapshot.chatJournal?.messages?.find((item) => item.id === messageId);
    if (!archived) continue;
    archived.text = '';
    archived.attachments = [];
    archived.withdrawn = true;
    const revision = snapshot.revision,
      updatedAt = snapshot.updatedAt;
    project(snapshot, db, now, { historical: true });
    snapshot.revision = revision;
    snapshot.updatedAt = updatedAt;
  }
}

/** Atomic canonical withdrawal; no withdrawn text is retained in diary history. */
export function withdrawChatMessage(db, input, now = Date.now(), options = {}) {
  if (
    !input ||
    !uuid(input.sourceId) ||
    typeof input.roomId !== 'string' ||
    !/^-?\d{1,20}$/.test(input.roomId) ||
    typeof input.messageId !== 'string' ||
    !/^\d{1,20}$/.test(input.messageId) ||
    (input.operationId !== undefined && !uuid(input.operationId))
  )
    throw fail(400, '撤回标识不正确');
  if (
    !db.chatJournal?.rooms.some(
      (room) => room.sourceId === input.sourceId && room.id === input.roomId,
    )
  )
    throw fail(409, '请先保存对话设置');
  const owner = db.chatJournal.rooms.find(
    (r) => r.sourceId === input.sourceId && r.id === input.roomId,
  )?.messageOwner;
  if (owner === 'conversation-services-v1' && !options.conversationWriter)
    throw fail(409, '此会话已由统一会话写口维护，请停用旧撤回写口');
  const existingWithdrawal = findWithdrawal(db, input.sourceId, input.roomId, input.messageId);
  if (existingWithdrawal)
    return chatMessageReceipt(db, input.sourceId, input.roomId, input.messageId);
  if (
    input.operationId &&
    db.chatJournal.withdrawals?.some((item) => item.operationId === input.operationId)
  )
    throw fail(409, '撤回操作编号已用于其他消息');
  const entry = db.entries.find(
    (item) =>
      item.chatJournal?.sourceId === input.sourceId &&
      item.chatJournal.roomId === input.roomId &&
      item.chatJournal.messages.some((message) => message.id === input.messageId),
  );
  const message = entry?.chatJournal.messages.find((item) => item.id === input.messageId);
  const sentAt = message?.sentAt || input.sentAt;
  if (!Number.isFinite(Date.parse(sentAt)) || Date.parse(sentAt) > now + 300000)
    throw fail(400, '撤回消息时间不正确');
  if (entry) {
    if (owned(entry) !== entry.chatJournal.projectionHash)
      throw fail(409, '归篇投影已修改，未覆盖');
    const id = chatUnitId(input.sourceId, input.roomId, input.messageId);
    const current = db.messageStore?.units.find((unit) => unit.id === id);
    if (current) withdrawChatUnit(db, entry, message, input.expectedRevision);
    else {
      // An explicit withdrawal of a legacy message creates only a body-free tombstone.
      db.messageStore ||= { version: 1, units: [], layouts: {} };
      message.text = '';
      message.attachments = [];
      db.messageStore.units.push({
        id,
        body: null,
        state: 'withdrawn',
        revision: 1,
        origin: {
          kind: 'chat',
          entryId: entry.id,
          sourceId: input.sourceId,
          roomId: input.roomId,
          messageId: message.id,
        },
        eventTime: {
          instant: new Date(sentAt).toISOString(),
          timeZone: 'UTC',
          precision: 'millisecond',
          source: 'chat-sent',
          sourceField: 'sentAt',
        },
        replyTo: message.replyTo ? chatUnitId(input.sourceId, input.roomId, message.replyTo) : null,
        sourceSpans: [],
        attachments: [],
        compatibilityHash: hash(message),
      });
    }
    message.withdrawn = true;
    const unit = db.messageStore.units.find((item) => item.id === id);
    unit.compatibilityHash = hash(message);
    scrubChatMessageHistory(entry, input.messageId, db, now);
    project(entry, db, now);
  }
  db.chatJournal.withdrawals ||= [];
  db.chatJournal.withdrawals.push({
    sourceId: input.sourceId,
    roomId: input.roomId,
    messageId: input.messageId,
    ...(input.operationId ? { operationId: input.operationId } : {}),
    sentAt: new Date(sentAt).toISOString(),
    requestedAt: new Date(now).toISOString(),
  });
  return chatMessageReceipt(db, input.sourceId, input.roomId, input.messageId);
}

function findWithdrawal(db, sourceId, roomId, messageId) {
  return db.chatJournal?.withdrawals?.find(
    (item) => item.sourceId === sourceId && item.roomId === roomId && item.messageId === messageId,
  );
}

export function chatMessageReceipt(db, sourceId, roomId, messageId) {
  const unitId = chatUnitId(sourceId, roomId, messageId);
  const unit = db.messageStore?.units.find((item) => item.id === unitId);
  const entry = db.entries.find(
    (item) =>
      item.chatJournal?.sourceId === sourceId &&
      item.chatJournal.roomId === roomId &&
      item.chatJournal.messages.some((message) => message.id === messageId),
  );
  const withdrawn = findWithdrawal(db, sourceId, roomId, messageId);
  if (!unit && !entry && !withdrawn) return null;
  return {
    id: messageId,
    entryId: entry?.id ?? null,
    unitId: unit?.id ?? null,
    revision: unit?.revision ?? null,
    state: withdrawn ? 'withdrawn' : (unit?.state ?? 'active'),
  };
}
