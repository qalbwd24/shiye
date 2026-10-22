/* DOM-free client shared by the desktop receiver and isolated integration lab. */
import {
  presentHistoryMessage,
  createHistoryNoticePublisher,
} from './shiye-revisit-view.js?v=20261017-mode-switch1';
export const REVISIT_ROOM = '-900000001';

export function createRevisitClient({
  api: request,
  command: submit,
  roomId = REVISIT_ROOM,
  instanceId,
  readLibrary,
  isComposing = () => false,
  decorateMedia = async (media) => media,
  onState = () => {},
  onNotice = () => {},
}) {
  const scope = { roomId: String(roomId), instanceId, providerId: 'revisit' };
  const belongs = (item) => (item?.instanceId || undefined) === (instanceId || undefined);
  const readState = (data) =>
    instanceId ? data?.shiyeServiceStates?.[instanceId] : data?.shiyeRevisit;
  const command = (action, payload = {}) => submit(action, { ...payload, ...scope });
  const api = async (action, payload = {}) => {
    const result = await request(action, payload);
    if (instanceId && result?.scope?.instanceId !== instanceId)
      throw Error('回看响应的实例身份不一致');
    return result;
  };
  const publishNotice = createHistoryNoticePublisher(onNotice);
  let running,
    target,
    followLatest = true;
  let selectionRevision = 0;
  let selectionQueue = Promise.resolve();
  let pendingSelections = 0;
  let state = { batches: [], deliveries: [], target: undefined, lastError: '', locked: false };
  const publish = (patch) => {
    state = { ...state, ...patch };
    onState(structuredClone(state));
  };
  async function hasPendingDraft() {
    if (isComposing()) return true;
    const data = await readLibrary();
    const dialog = [...(data?.dialogs?.active || []), ...(data?.dialogs?.archived || [])].find(
      (item) => String(item.id) === String(roomId),
    );
    return Boolean(dialog?.draft?.message || isComposing());
  }
  function select(batchId, deliveryId, automatic = false) {
    return selectTarget(batchId, deliveryId, automatic, false);
  }
  function selectTarget(batchId, deliveryId, automatic, background) {
    if (background && (pendingSelections || !followLatest || isComposing()))
      return Promise.resolve(false);
    const revision = ++selectionRevision;
    pendingSelections += 1;
    const operation = selectionQueue
      .catch(() => {})
      .then(async () => {
        if (revision !== selectionRevision || (background && (await hasPendingDraft())))
          return false;
        // Validate the fixed group, then recheck the intent after the asynchronous response.
        await api('context', { batchId, ...(deliveryId ? { deliveryId } : {}) });
        if (revision !== selectionRevision || (background && (await hasPendingDraft())))
          return false;
        await command('program-target', { batchId, deliveryId });
        target = { batchId, deliveryId, ...scope };
        followLatest = automatic;
        publish({ target });
        return revision === selectionRevision;
      });
    selectionQueue = operation.finally(() => {
      pendingSelections -= 1;
    });
    return selectionQueue;
  }
  async function mediaBytes(deliveryId, assetId, max = 32 * 1024 * 1024) {
    let offset = 0,
      bytes,
      metadata;
    do {
      const part = await api('media', { deliveryId, assetId, offset });
      if (!Number.isSafeInteger(part.size) || part.size < 0 || part.size > max)
        throw Error('媒体大小无效或较大，请在原日记中查看原件');
      if (part.offset !== offset || (bytes && bytes.length !== part.size))
        throw Error('媒体分段位置不一致');
      bytes ||= new Uint8Array(part.size);
      const chunk = Uint8Array.from(atob(part.bytes), (char) => char.charCodeAt(0));
      if (offset + chunk.length > bytes.length || (!chunk.length && !part.done))
        throw Error('媒体读取中断');
      bytes.set(chunk, offset);
      offset += chunk.length;
      if (Boolean(part.done) !== (offset === bytes.length)) throw Error('媒体分段不完整');
      metadata = part;
    } while (!metadata.done);
    return { ...metadata, bytes };
  }
  async function drainComments() {
    const snapshot = await readLibrary();
    for (const operation of snapshot?.shiyeWithdrawalOutbox || []) {
      if (String(operation.roomId) !== String(roomId)) continue;
      const saved = snapshot.shiyeRevisitComments?.[operation.messageId];
      if (!saved || !belongs(saved)) continue;
      if (saved) await api('withdraw', { operationId: saved.operationId });
      await command('withdrawal-ack', { operationIds: [operation.operationId] });
    }
    // Keep only pending IDs: historical messages and acknowledged comments need no
    // fresh snapshot. Do not retain a media-bearing library across this loop.
    const pendingIds = ((await readLibrary())?.messages?.[roomId] || [])
      .filter(
        (message) =>
          message.shiyeComment &&
          belongs(message.shiyeComment) &&
          !message.shiyeComment.acknowledged,
      )
      .map((message) => message.id);
    for (const id of pendingIds) {
      // Re-read before each request: a local withdrawal may have happened during a prior await.
      const data = await readLibrary();
      const message = data?.messages?.[roomId]?.find((item) => item.id === id);
      if (
        !message?.shiyeComment ||
        !belongs(message.shiyeComment) ||
        message.shiyeComment.acknowledged
      )
        continue;
      if (
        data.shiyeWithdrawalOutbox?.some(
          (item) =>
            String(item.roomId) === String(roomId) &&
            [message.id, message.replacesMessageId]
              .filter((value) => value !== undefined)
              .some((value) => String(item.messageId) === String(value)),
        )
      )
        continue;
      await api('comment', {
        ...message.shiyeComment,
        sentAt: new Date(message.date * 1000).toISOString(),
        text: message.message || '',
      });
      await command('program-ack', { operationId: message.shiyeComment.operationId });
    }
  }
  async function receive(reason, historical = false) {
    const data = await readLibrary();
    const status = await api('status');
    if (!status.config.enabled && !readState(data)) {
      publish({ config: status.config, randomDay: null, locked: false });
      publishNotice(state, reason);
      return;
    }
    let commentError = '';
    try {
      await drainComments();
    } catch (error) {
      if ([401, 403].includes(error.status)) throw error;
      commentError = error.message;
    }
    let after = 0;
    const batches = new Map(),
      deliveries = new Map();
    // Start at zero deliberately: revalidate hidden/withdrawn sources, not only new arrivals.
    for (;;) {
      const feed = await api('feed', { after, limit: 50 });
      if (
        !Array.isArray(feed.deliveries) ||
        feed.deliveries.length > 100 ||
        !Array.isArray(feed.batches) ||
        !Number.isSafeInteger(feed.next) ||
        !Number.isSafeInteger(feed.total) ||
        feed.next < after ||
        feed.next > feed.total ||
        (feed.next === after && feed.next < feed.total)
      )
        throw Error('回看分页没有前进，请稍后重试');
      const cached = (await readLibrary())?.messages?.[roomId] || [];
      for (const delivery of feed.deliveries) {
        delivery.presentation = delivery.source.available
          ? presentHistoryMessage(delivery, feed.config.timeZone)
          : undefined;
        const message = cached.find(
          (item) => belongs(item.shiyeProgram) && item.shiyeProgram?.deliveryId === delivery.id,
        );
        if (
          (!historical || message) &&
          delivery.source.available &&
          delivery.source.media.length &&
          !message?.media
        ) {
          try {
            delivery.media = await decorateMedia(
              await mediaBytes(delivery.id, delivery.source.media[0]),
            );
          } catch (error) {
            if ([401, 403].includes(error.status)) throw error;
            // Text/source link remain available; do not recompress original bytes.
          }
        }
      }
      // Only advance after durable local acknowledgement. Retried pages dedupe by deliveryId.
      await command('program-feed', {
        historical,
        feed: {
          ...feed,
          deliveries: feed.deliveries.filter(
            (delivery) =>
              !delivery.superseded &&
              (!historical ||
                cached.some(
                  (message) =>
                    belongs(message.shiyeProgram) &&
                    [delivery.id, delivery.replacesDeliveryId].includes(
                      message.shiyeProgram?.deliveryId,
                    ),
                )),
          ),
        },
      });
      for (const batch of feed.batches) batches.set(batch.id, batch);
      for (const { media: _media, source: _source, ...delivery } of feed.deliveries.filter(
        (delivery) => !delivery.superseded,
      ))
        deliveries.set(delivery.id, delivery);
      after = feed.next;
      if (after === feed.total) break;
    }
    if (!target && readState(data)?.targetBatchId) {
      target = {
        ...scope,
        batchId: readState(data).targetBatchId,
        deliveryId: readState(data).targetDeliveryId,
      };
      // A persisted draft target survives receiver recreation without being retargeted.
      followLatest = false;
    }
    publish({
      batches: [...batches.values()],
      deliveries: [...deliveries.values()],
      timeZone: status.config.timeZone,
      config: status.config,
      randomDay: status.randomDay || null,
      target,
      locked: false,
    });
    const latest = state.batches.at(-1);
    if (
      !historical &&
      latest &&
      (!target || (followLatest && !isComposing() && target.batchId !== latest.id))
    )
      await selectTarget(latest.id, undefined, true, true);
    publish({ lastError: commentError });
    publishNotice(state, reason);
  }
  function sync({ reason = 'poll', historical = false } = {}) {
    if (running)
      return reason === 'poll'
        ? running
        : running.catch(() => {}).then(() => sync({ reason, historical }));
    running = receive(reason, historical)
      .catch(async (error) => {
        if ([401, 403].includes(error.status)) {
          // Purge durable source bodies/media, preserve authored comments and their outbox.
          await command('program-clear');
          publish({ batches: [], deliveries: [], config: null, randomDay: null, locked: true });
          publishNotice(state);
        }
        publish({ lastError: error.message });
        throw error;
      })
      .finally(() => {
        running = undefined;
      });
    return running;
  }
  return { sync, select, mediaBytes, drainComments, status: () => structuredClone(state) };
}
