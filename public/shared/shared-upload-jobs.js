import { Sha256 } from './sync-v2-media.js';

const TYPE = 'local-media-job',
  CHUNK = 256 * 1024;
const copy = (value) => structuredClone(value);
const uuid = (value) =>
  typeof value === 'string' && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(value);
const decimal = (value) => typeof value === 'string' && /^\d{1,20}$/.test(value);
const fail = (code) => {
  throw Object.assign(Error(code), { code });
};
const codeOf = (error) =>
  /^[A-Z][A-Z0-9_]{0,95}$/.test(error?.code || '') ? error.code : 'SHARED_UPLOAD_FAILED';
const frozen = new Set(['submitted', 'acknowledged']);
const final = new Set(['acknowledged', 'cancelled']);
function summary(job) {
  const { attachments, ...rest } = job;
  return {
    ...copy(rest),
    attachments: attachments.map(({ source, ...item }) => ({
      ...copy(item),
      name: source.name,
      mime: source.mime,
      size: source.size,
    })),
  };
}

/** Durable local work records in the SAME shared client transaction store. Upload
 * sources never enter meta or command JSON. The journal command is created only
 * after every original completes, so uploads cannot occupy the text outbox head.
 * No network, file read or hash is awaited inside a storage transaction. */
export function createSharedUploadJobs({
  storage,
  client,
  media,
  libraryId,
  epoch,
  openHandle,
  idFactory = () => crypto.randomUUID(),
  clock = Date.now,
  maxConcurrent = 2,
  onChange = () => {},
  timers = { setTimeout, clearTimeout, setInterval, clearInterval },
} = {}) {
  if (
    !storage?.transaction ||
    !client?.enqueue ||
    !client?.readOperation ||
    !media?.upload ||
    !uuid(libraryId) ||
    !uuid(epoch) ||
    !Number.isInteger(maxConcurrent) ||
    maxConcurrent < 1 ||
    maxConcurrent > 4 ||
    !['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'].every(
      (name) => typeof timers?.[name] === 'function',
    )
  )
    fail('SHARED_UPLOAD_OPTIONS_REQUIRED');
  let running = false,
    disposed = false;
  const queue = [],
    queued = new Set(),
    active = new Map(),
    idle = new Set(),
    leaseTimers = new Map(),
    leaseWakes = new Map();
  const ownerId = crypto.randomUUID(),
    leaseMs = 60000;
  const notify = () => {
    try {
      onChange();
    } catch {
      /* durable commits survive observers */
    }
  };
  const now = () => new Date(clock()).toISOString();
  async function transaction(fn) {
    return storage.transaction(async (tx) => {
      const meta = await tx.getMeta();
      if (
        meta &&
        (meta.sharedBusiness !== 1 || meta.libraryId !== libraryId || meta.epoch !== epoch)
      )
        fail('SHARED_IDENTITY_MISMATCH');
      if (!meta)
        await tx.setMeta({
          sharedBusiness: 1,
          libraryId,
          epoch,
          initialized: false,
          cursor: null,
          paused: null,
          entryConversationIndex: { version: 1, byConversation: {}, byEntry: {} },
        });
      return fn(tx);
    });
  }
  async function mutate(operationId, fn, leaseToken) {
    const result = await transaction(async (tx) => {
      const record = await tx.getEntity(TYPE, operationId);
      if (!record?.job || record.job.libraryId !== libraryId || record.job.epoch !== epoch)
        fail('SHARED_UPLOAD_JOB_NOT_FOUND');
      if (
        leaseToken &&
        (record.job.lease?.ownerId !== ownerId || record.job.lease?.token !== leaseToken)
      )
        fail('SHARED_UPLOAD_LEASE_LOST');
      await fn(record.job);
      record.job.updatedAt = now();
      await tx.putEntity(record);
      return summary(record.job);
    });
    notify();
    return result;
  }
  async function readJob(operationId) {
    return transaction(async (tx) => (await tx.getEntity(TYPE, operationId))?.job || null);
  }
  async function claim(operationId) {
    return transaction(async (tx) => {
      const record = await tx.getEntity(TYPE, operationId),
        job = record?.job;
      if (!job || final.has(job.status) || job.status === 'failed') return null;
      if (job.lease && job.lease.expiresAt > clock() && job.lease.ownerId !== ownerId)
        return { blockedUntil: job.lease.expiresAt };
      job.lease = { ownerId, token: crypto.randomUUID(), expiresAt: clock() + leaseMs };
      await tx.putEntity(record);
      return copy(job);
    });
  }
  async function release(operationId, token) {
    return transaction(async (tx) => {
      const record = await tx.getEntity(TYPE, operationId);
      if (record?.job?.lease?.ownerId === ownerId && record.job.lease.token === token) {
        delete record.job.lease;
        await tx.putEntity(record);
      }
    });
  }
  async function releaseAll() {
    return transaction(async (tx) => {
      for (const record of await tx.listEntities(TYPE))
        if (record.job?.lease?.ownerId === ownerId) {
          delete record.job.lease;
          await tx.putEntity(record);
        }
    });
  }
  function ensureActive(signal) {
    if (disposed || signal.aborted) fail('SHARED_UPLOAD_STOPPED');
  }
  function schedule(operationId) {
    if (!running || disposed || queued.has(operationId) || active.has(operationId)) return;
    if (leaseWakes.has(operationId)) {
      timers.clearTimeout(leaseWakes.get(operationId));
      leaseWakes.delete(operationId);
    }
    queue.push(operationId);
    queued.add(operationId);
    pump();
  }
  function wakeAtLeaseExpiry(operationId, expiresAt) {
    if (disposed || !running) return;
    if (leaseWakes.has(operationId)) timers.clearTimeout(leaseWakes.get(operationId));
    const delay = Math.max(1, Math.min(60001, expiresAt - clock() + 1));
    const timer = timers.setTimeout(() => {
      leaseWakes.delete(operationId);
      schedule(operationId);
    }, delay);
    timer.unref?.();
    leaseWakes.set(operationId, timer);
  }
  function settled() {
    if (queue.length || active.size) return;
    for (const resolve of idle) resolve();
    idle.clear();
  }
  function pump() {
    while (running && !disposed && active.size < maxConcurrent && queue.length) {
      const operationId = queue.shift();
      queued.delete(operationId);
      const controller = new AbortController();
      active.set(operationId, controller);
      void process(operationId, controller.signal)
        .catch(() => {})
        .finally(() => {
          active.delete(operationId);
          pump();
          settled();
        });
    }
    settled();
  }
  async function checkAck(operationId, leaseToken) {
    const state = await client.readOperation(operationId);
    if (state?.status === 'acknowledged')
      await mutate(
        operationId,
        (job) => {
          job.status = 'acknowledged';
          job.error = null;
          job.acknowledgedAt = now();
        },
        leaseToken,
      );
    else if (state?.status === 'blocked' || state?.status === 'recovered')
      await mutate(
        operationId,
        (job) => {
          job.error =
            state.status === 'blocked' ? 'SHARED_COMMAND_BLOCKED' : 'SHARED_COMMAND_RECOVERED';
        },
        leaseToken,
      );
    return state;
  }
  async function process(operationId, signal) {
    let job = await claim(operationId);
    if (!job) return;
    if (job.blockedUntil) {
      wakeAtLeaseExpiry(operationId, job.blockedUntil);
      return;
    }
    const leaseToken = job.lease.token,
      update = (fn) => mutate(operationId, fn, leaseToken);
    let renewing = false;
    const heartbeat = timers.setInterval(() => {
      if (renewing || disposed || signal.aborted) return;
      renewing = true;
      void update((current) => {
        current.lease.expiresAt = clock() + leaseMs;
      })
        .catch(() => active.get(operationId)?.abort())
        .finally(() => {
          renewing = false;
        });
    }, leaseMs / 4);
    heartbeat.unref?.();
    leaseTimers.set(operationId, heartbeat);
    try {
      if (!frozen.has(job.status)) {
        await update((current) => {
          if (current.status === 'cancelled') fail('SHARED_UPLOAD_STOPPED');
          current.status = 'uploading';
          current.attempts++;
          current.error = null;
        });
        for (let index = 0; index < job.attachments.length; index++) {
          ensureActive(signal);
          const attachment = job.attachments[index];
          if (attachment.asset) continue;
          const source = attachment.source;
          let file;
          if (source.kind === 'blob')
            file = {
              size: source.size,
              name: source.name,
              type: source.mime,
              slice: (start, end) => source.blob.slice(start, end),
            };
          else {
            if (typeof openHandle !== 'function') fail('SHARED_UPLOAD_HANDLE_PORT_REQUIRED');
            const opened = await openHandle(
              source.handle,
              copy({
                size: source.size,
                sha256: source.sha256,
                name: source.name,
                mime: source.mime,
              }),
            );
            if (
              !opened ||
              opened.size !== source.size ||
              opened.sha256 !== source.sha256 ||
              typeof opened.read !== 'function'
            )
              fail('SHARED_UPLOAD_SOURCE_CHANGED');
            // The handle port returns bounded bytes. It must never materialize a whole file.
            file = {
              size: source.size,
              name: source.name,
              type: source.mime,
              slice: (start, end) => ({
                arrayBuffer: async () => {
                  ensureActive(signal);
                  if (end - start > CHUNK) fail('SHARED_UPLOAD_INVALID_RANGE');
                  const bytes = await opened.read(start, end);
                  if (!(bytes instanceof Uint8Array) || bytes.length !== end - start)
                    fail('SHARED_UPLOAD_SOURCE_CHANGED');
                  return bytes.slice().buffer;
                },
              }),
            };
            // Validate the persistent handle before any upload. The media client re-hashes too.
            const digest = new Sha256();
            for (let offset = 0; offset < source.size; offset += CHUNK) {
              ensureActive(signal);
              const bytes = new Uint8Array(
                await file.slice(offset, Math.min(source.size, offset + CHUNK)).arrayBuffer(),
              );
              digest.update(bytes);
            }
            if (digest.digest() !== source.sha256) fail('SHARED_UPLOAD_SOURCE_CHANGED');
          }
          let checkpoint = attachment.transferred || 0,
            progressTail = Promise.resolve();
          let asset;
          try {
            asset = await media.upload(file, {
              operationId: attachment.uploadOperationId,
              signal,
              onProgress: (progress) => {
                if (signal.aborted || disposed) return;
                if (
                  !Number.isSafeInteger(progress.transferred) ||
                  progress.transferred < checkpoint ||
                  progress.transferred > source.size ||
                  progress.total !== source.size
                )
                  return;
                checkpoint = progress.transferred;
                progressTail = progressTail.then(() =>
                  update((current) => {
                    if (current.status !== 'cancelled')
                      current.attachments[index].transferred = Math.max(
                        current.attachments[index].transferred,
                        progress.transferred,
                      );
                  }),
                );
                progressTail.catch(() => {});
              },
            });
          } finally {
            await progressTail;
          }
          ensureActive(signal);
          if (
            !asset?.id ||
            asset.size !== source.size ||
            !/^[a-f0-9]{64}$/.test(asset.sha256 || '') ||
            (source.sha256 && source.sha256 !== asset.sha256)
          )
            fail('SHARED_UPLOAD_SOURCE_CHANGED');
          await update((current) => {
            if (current.status === 'cancelled') fail('SHARED_UPLOAD_STOPPED');
            current.attachments[index].asset = copy(asset);
            current.attachments[index].transferred = source.size;
          });
          job = await readJob(operationId);
        }
        ensureActive(signal);
        const message = {
          id: job.messageId,
          sentAt: job.sentAt,
          text: job.text,
          attachments: job.attachments.map((item) => item.asset.id),
          ...(job.replyTo ? { replyTo: job.replyTo } : {}),
        };
        const command = {
          operationId,
          action: 'journal-send',
          input: {
            sourceId: job.sourceId,
            roomId: job.roomId,
            messages: [message],
            deferredMedia: {
              uploadOperationIds: job.attachments.map((item) => item.uploadOperationId),
            },
          },
          optimistic: [
            {
              entityType: 'local-chat-message',
              entityId: JSON.stringify([job.conversationId, job.messageId]),
              changes: { ...message, conversationId: job.conversationId },
            },
          ],
        };
        // Durable handoff permits an interrupted enqueue to repeat the exact command.
        await update((current) => {
          if (current.status === 'cancelled') fail('SHARED_UPLOAD_STOPPED');
          current.command = copy(command);
          current.status = 'ready';
        });
        job = await readJob(operationId);
      }
      ensureActive(signal);
      if (job.status !== 'submitted') {
        if (!job.command) fail('SHARED_UPLOAD_COMMAND_MISSING');
        await client.enqueue(copy(job.command));
        // After enqueue, cancellation must never remove the immutable business command.
        await update((current) => {
          current.status = 'submitted';
          current.error = null;
        });
      }
      ensureActive(signal);
      try {
        await client.sync?.();
      } catch (error) {
        await update((current) => {
          current.error = codeOf(error);
        });
      }
      await checkAck(operationId, leaseToken);
    } catch (error) {
      if (
        disposed ||
        signal.aborted ||
        error.code === 'SHARED_UPLOAD_STOPPED' ||
        error.code === 'SHARED_UPLOAD_LEASE_LOST'
      )
        return;
      await update((current) => {
        if (!final.has(current.status)) {
          if (!frozen.has(current.status)) current.status = 'failed';
          current.error = codeOf(error);
        }
      });
    } finally {
      timers.clearInterval(heartbeat);
      leaseTimers.delete(operationId);
      await release(operationId, leaseToken).catch(() => {});
    }
  }
  async function enqueue(input = {}) {
    if (disposed) fail('SHARED_UPLOAD_DISPOSED');
    const operationId = input.operationId || idFactory(),
      messageId =
        input.messageId ||
        (uuid(operationId)
          ? String(BigInt('0x' + operationId.replaceAll('-', '')) % 100000000000000000000n)
          : '');
    const parts = /^desktop:([a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}):(-?\d{1,20})$/.exec(
      input.conversationId || '',
    );
    if (
      !parts ||
      !uuid(operationId) ||
      !decimal(messageId) ||
      (input.sourceId !== undefined && input.sourceId !== parts[1]) ||
      (input.roomId !== undefined && input.roomId !== parts[2]) ||
      (input.messageOwner || 'legacy') !== 'legacy' ||
      typeof (input.text ?? '') !== 'string' ||
      (input.replyTo !== undefined && input.replyTo !== null && !decimal(input.replyTo)) ||
      !Array.isArray(input.attachments) ||
      input.attachments.length < 1 ||
      input.attachments.length > 100
    )
      fail('SHARED_UPLOAD_INVALID_JOB');
    const createdAt = now(),
      sentAt = input.sentAt || createdAt;
    if (
      !Number.isFinite(Date.parse(sentAt)) ||
      (input.text || '').length > 500000 ||
      new TextEncoder().encode(input.text || '').length > 2 * 1024 * 1024
    )
      fail('SHARED_UPLOAD_INVALID_JOB');
    const draftClear = input.draftClear;
    if (
      draftClear !== undefined &&
      (!draftClear ||
        typeof draftClear !== 'object' ||
        Array.isArray(draftClear) ||
        Object.keys(draftClear).some((key) => !['scope', 'expectedRevision'].includes(key)) ||
        draftClear.scope !== input.conversationId ||
        !Number.isSafeInteger(draftClear.expectedRevision) ||
        draftClear.expectedRevision < 0)
    )
      fail('SHARED_INVALID_DRAFT');
    const attachments = input.attachments.map((item) => {
      let source;
      if (typeof Blob === 'function' && item.blob instanceof Blob)
        source = {
          kind: 'blob',
          blob: item.blob,
          size: item.blob.size,
          name: item.name || item.blob.name || '附件',
          mime: item.mime || item.blob.type || 'application/octet-stream',
        };
      else if (
        typeof item.handle === 'string' &&
        /^[A-Za-z0-9:_-]{1,256}$/.test(item.handle) &&
        /^[a-f0-9]{64}$/.test(item.sha256 || '')
      )
        source = {
          kind: 'handle',
          handle: item.handle,
          size: item.size,
          name: item.name || '附件',
          mime: item.mime || 'application/octet-stream',
          sha256: item.sha256,
        };
      else fail('SHARED_UPLOAD_DURABLE_SOURCE_REQUIRED');
      const uploadOperationId = idFactory();
      if (
        !uuid(uploadOperationId) ||
        !Number.isSafeInteger(source.size) ||
        source.size < 1 ||
        source.size > 16 * 1024 ** 3 ||
        typeof source.name !== 'string' ||
        typeof source.mime !== 'string' ||
        source.name.length > 4096 ||
        source.mime.length > 256
      )
        fail('SHARED_UPLOAD_INVALID_ORIGINAL');
      return { uploadOperationId, source, transferred: 0, asset: null };
    });
    if (
      new Set(attachments.map((a) => a.uploadOperationId)).size !== attachments.length ||
      attachments.some((a) => a.uploadOperationId === operationId)
    )
      fail('SHARED_UPLOAD_INVALID_OPERATION');
    const job = {
      version: 1,
      libraryId,
      epoch,
      operationId,
      messageId,
      conversationId: input.conversationId,
      sourceId: parts[1],
      roomId: parts[2],
      sentAt,
      createdAt,
      updatedAt: createdAt,
      text: input.text || '',
      replyTo: input.replyTo || null,
      attachments,
      status: 'queued',
      attempts: 0,
      error: null,
      command: null,
    };
    await transaction(async (tx) => {
      if (await tx.getEntity(TYPE, operationId)) fail('SHARED_UPLOAD_JOB_EXISTS');
      await tx.putEntity({
        entityType: TYPE,
        entityId: operationId,
        base: null,
        local: null,
        localRevision: 0,
        job,
      });
      if (draftClear !== undefined) {
        const meta = await tx.getMeta(),
          previous = meta?.drafts?.[draftClear.scope];
        if (previous?.revision === draftClear.expectedRevision) {
          if (previous.revision === Number.MAX_SAFE_INTEGER)
            fail('SHARED_DRAFT_REVISION_EXHAUSTED');
          meta.drafts[draftClear.scope] = {
            text: '',
            replyId: null,
            revision: previous.revision + 1,
          };
          await tx.setMeta(meta);
        }
      }
    });
    notify();
    schedule(operationId);
    return summary(job);
  }
  async function resume() {
    if (disposed) fail('SHARED_UPLOAD_DISPOSED');
    running = true;
    const records = await transaction((tx) => tx.listEntities(TYPE));
    for (const record of records)
      if (['queued', 'uploading', 'ready', 'submitted'].includes(record.job?.status))
        schedule(record.entityId);
    return { scheduled: queue.length + active.size };
  }
  return {
    enqueue,
    start: resume,
    resume,
    async list({ conversationId, includeCompleted = false } = {}) {
      return transaction(async (tx) =>
        (await tx.listEntities(TYPE))
          .filter(
            (row) =>
              row.job &&
              (!conversationId || row.job.conversationId === conversationId) &&
              (includeCompleted || !final.has(row.job.status)),
          )
          .map((row) => summary(row.job)),
      );
    },
    async read(operationId) {
      const job = await readJob(operationId);
      return job ? summary(job) : null;
    },
    async retry(operationId) {
      if (disposed) fail('SHARED_UPLOAD_DISPOSED');
      const result = await mutate(operationId, (job) => {
        if (final.has(job.status)) fail('SHARED_UPLOAD_FINAL');
        if (job.status === 'failed') job.status = job.command ? 'ready' : 'queued';
        job.error = null;
      });
      running = true;
      schedule(operationId);
      return result;
    },
    async cancel(operationId) {
      const result = await mutate(operationId, (job) => {
        if (frozen.has(job.status) || job.command) fail('SHARED_UPLOAD_COMMAND_ALREADY_QUEUED');
        job.status = 'cancelled';
        job.error = null;
        delete job.lease;
      });
      active.get(operationId)?.abort();
      return result;
    },
    async reconcile() {
      const records = await transaction((tx) => tx.listEntities(TYPE));
      for (const row of records) if (row.job?.status === 'submitted') await checkAck(row.entityId);
    },
    waitIdle() {
      return queue.length || active.size
        ? new Promise((resolve) => idle.add(resolve))
        : Promise.resolve();
    },
    dispose() {
      disposed = true;
      running = false;
      queue.length = 0;
      queued.clear();
      for (const controller of active.values()) controller.abort();
      for (const timer of leaseTimers.values()) timers.clearInterval(timer);
      leaseTimers.clear();
      for (const timer of leaseWakes.values()) timers.clearTimeout(timer);
      leaseWakes.clear();
      settled();
      return releaseAll().catch(() => {});
    },
  };
}
