import {
  appendChatMessages,
  closeIdleChatEntries,
  saveChatRoom,
  validateChatRoom,
  withdrawChatMessage,
  chatMessageReceipt,
} from '../domain/chat-journal.mjs';

export function createRoutes({ getDb, mutate, body, reply, fail, messageUnitsEnabled = false }) {
  return async (req, res, p) => {
    if (p === '/api/chat-journal' && req.method === 'GET') {
      return reply(res, 200, {
        version: 1,
        categories: getDb().categories,
        rooms: getDb().chatJournal?.rooms || [],
      });
    }
    if (p === '/api/chat-journal/rooms' && req.method === 'PUT') {
      const input = JSON.parse(await body(req));
      const checked = validateChatRoom(input, getDb());
      const old = getDb().chatJournal?.rooms.find(
        (r) => r.sourceId === checked.sourceId && r.id === checked.id,
      );
      if (old && Object.entries(checked).every(([key, value]) => old[key] === value))
        return reply(res, 200, old);
      return reply(res, 200, await mutate((d) => saveChatRoom(d, input)));
    }
    if (p === '/api/chat-journal/receipts' && req.method === 'POST') {
      const input = JSON.parse(await body(req));
      if (!input || !Array.isArray(input.ids) || input.ids.length > 50)
        throw fail(400, '消息查询批次过大');
      if (
        !input.ids.every((id) => typeof id === 'string' && /^\d{1,20}$/.test(id)) ||
        typeof input.sourceId !== 'string' ||
        !/^[a-f0-9-]{36}$/i.test(input.sourceId) ||
        typeof input.roomId !== 'string' ||
        !/^-?\d{1,20}$/.test(input.roomId)
      )
        throw fail(400, '消息查询标识不正确');
      const accepted = [...new Set(input.ids)]
        .map((id) => chatMessageReceipt(getDb(), input.sourceId, input.roomId, id))
        .filter(Boolean);
      return reply(res, 200, { accepted });
    }
    if (p === '/api/chat-journal/messages' && req.method === 'POST') {
      const input = JSON.parse(await body(req));
      return reply(
        res,
        200,
        await mutate((d) => appendChatMessages(d, input, Date.now(), { messageUnitsEnabled })),
      );
    }
    if (p === '/api/chat-journal/withdraw' && req.method === 'POST') {
      const input = JSON.parse(await body(req));
      return reply(res, 200, await mutate((d) => withdrawChatMessage(d, input)));
    }
    if (p === '/api/chat-journal/messages' && req.method === 'PUT') {
      throw fail(405, '聊天原消息不可直接编辑，请撤回后重新发送');
    }
    if (p === '/api/chat-journal/close-idle' && req.method === 'POST') {
      return reply(res, 200, await mutate((d) => ({ closed: closeIdleChatEntries(d) })));
    }
    return false;
  };
}
