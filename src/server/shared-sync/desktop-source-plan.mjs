import { promises as fs, createReadStream } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { sharedInfo } from './replication.mjs';
import { formatDesktopJournalText } from './desktop-journal-format.mjs';
import { LEGACY_SERVICE_ID, isLegacyConversation } from '../conversation-services/settings.mjs';

const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const fail = (code) => {
  throw Object.assign(Error(code), { code });
};
const isObject = (value) => value && typeof value === 'object' && !Array.isArray(value);
const logical = new Set([
  'logical/library.typed.json',
  'logical/link.typed.json',
  'logical/preferences.json',
  'logical/assets.typed.json',
  'logical/withdrawal-recovery.typed.json',
]);
const validMember = (value) => logical.has(value) || /^media\/[a-f0-9]{64}$/.test(value);
const uuid = (value) =>
  typeof value === 'string' && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(value);
const id = (value) => {
  if (typeof value === 'bigint') value = value.toString();
  if (Number.isSafeInteger(value)) value = String(value);
  if (typeof value !== 'string' || !/^-?\d{1,20}$/.test(value)) fail('DESKTOP_PLAN_INVALID_ID');
  return value;
};
async function noLinks(file) {
  let selected = path.resolve(file);
  while (true) {
    if ((await fs.lstat(selected)).isSymbolicLink()) fail('DESKTOP_PLAN_REPARSE_REJECTED');
    const parent = path.dirname(selected);
    if (parent === selected) break;
    selected = parent;
  }
}

/** Decode only the capture's explicit data graph. Binary nodes stay verified
 * opaque descriptors: planning never loads every original into memory. */
export function decodeDesktopRecoveryGraph(graph, members) {
  if (
    graph?.format !== 'shiye-desktop-private-graph' ||
    graph.version !== 1 ||
    !Array.isArray(graph.nodes) ||
    graph.nodes.length > 1000000
  )
    fail('DESKTOP_PLAN_INVALID_GRAPH');
  const binaryTypes = new Set([
    'Blob',
    'File',
    'ArrayBuffer',
    'DataView',
    'Uint8Array',
    'Uint8ClampedArray',
    'Int8Array',
    'Uint16Array',
    'Int16Array',
    'Uint32Array',
    'Int32Array',
    'Float32Array',
    'Float64Array',
    'BigInt64Array',
    'BigUint64Array',
  ]);
  const nodes = graph.nodes.map((node) => {
    if (!isObject(node)) fail('DESKTOP_PLAN_INVALID_GRAPH');
    if (binaryTypes.has(node.type)) {
      const member = members.get(node.path);
      if (
        !/^media\/[a-f0-9]{64}$/.test(node.path || '') ||
        !member ||
        member.size !== node.size ||
        member.sha256 !== node.sha256
      )
        fail('DESKTOP_PLAN_BINARY_MISMATCH');
      return Object.freeze({ captureBinary: Object.freeze({ ...node }) });
    }
    if (node.type === 'Object') return Object.create(null);
    if (
      node.type === 'Array' &&
      Number.isSafeInteger(node.length) &&
      node.length >= 0 &&
      node.length <= 1000000
    )
      return new Array(node.length);
    if (node.type === 'Map') return new Map();
    if (node.type === 'Set') return new Set();
    if (node.type === 'Date' && Number.isFinite(Date.parse(node.value)))
      return new Date(node.value);
    fail('DESKTOP_PLAN_INVALID_GRAPH');
  });
  function value(encoded) {
    if (!Array.isArray(encoded)) fail('DESKTOP_PLAN_INVALID_GRAPH');
    const [type, raw] = encoded;
    if (!['null', 'undefined'].includes(type) && encoded.length !== 2)
      fail('DESKTOP_PLAN_INVALID_GRAPH');
    if (type === 'ref' && Number.isSafeInteger(raw) && raw >= 0 && raw < nodes.length)
      return nodes[raw];
    if (type === 'null' && encoded.length === 1) return null;
    if (type === 'undefined' && encoded.length === 1) return undefined;
    if (type === 'string' && typeof raw === 'string') return raw;
    if (type === 'boolean' && typeof raw === 'boolean') return raw;
    if (type === 'bigint' && typeof raw === 'string' && /^-?\d{1,1000}$/.test(raw))
      return BigInt(raw);
    if (
      type === 'number' &&
      typeof raw === 'string' &&
      (['NaN', 'Infinity', '-Infinity', '-0'].includes(raw) || String(Number(raw)) === raw)
    )
      return Number(raw);
    fail('DESKTOP_PLAN_INVALID_GRAPH');
  }
  for (let i = 0; i < nodes.length; i++) {
    const source = graph.nodes[i],
      target = nodes[i];
    if (target.captureBinary || source.type === 'Date') continue;
    if (!Array.isArray(source.values)) fail('DESKTOP_PLAN_INVALID_GRAPH');
    const keys = new Set();
    for (const pair of source.values) {
      if (source.type === 'Set') {
        target.add(value(pair));
        continue;
      }
      if (!Array.isArray(pair) || pair.length !== 2) fail('DESKTOP_PLAN_INVALID_GRAPH');
      if (source.type === 'Map') {
        target.set(value(pair[0]), value(pair[1]));
        continue;
      }
      if (
        typeof pair[0] !== 'string' ||
        keys.has(pair[0]) ||
        (source.type === 'Array' && pair[0] === 'length')
      )
        fail('DESKTOP_PLAN_INVALID_GRAPH');
      if (
        source.type === 'Array' &&
        /^(0|[1-9]\d*)$/.test(pair[0]) &&
        BigInt(pair[0]) < 4294967295n &&
        BigInt(pair[0]) >= BigInt(source.length)
      )
        fail('DESKTOP_PLAN_INVALID_GRAPH');
      keys.add(pair[0]);
      Object.defineProperty(target, pair[0], {
        value: value(pair[1]),
        writable: true,
        enumerable: true,
        configurable: true,
      });
    }
  }
  return value(graph.root);
}

/** Integrity is not business authorization. A caller-selected capture remains
 * a private recovery input until an original-owner transaction proves mappings. */
export async function readDesktopCapture(directory) {
  if (!path.isAbsolute(directory || '')) fail('DESKTOP_PLAN_EXPLICIT_DIRECTORY_REQUIRED');
  await noLinks(directory);
  const manifestFile = path.join(directory, 'capture-manifest.json');
  await noLinks(manifestFile);
  const raw = await fs.readFile(manifestFile);
  if (raw.length > 32 * 1024 ** 2) fail('DESKTOP_PLAN_MANIFEST_TOO_LARGE');
  const manifest = JSON.parse(raw.toString('utf8'));
  if (
    manifest.format !== 'shiye-desktop-logical-capture' ||
    manifest.version !== 1 ||
    !Array.isArray(manifest.members) ||
    manifest.members.length > 100000
  )
    fail('DESKTOP_PLAN_INVALID_MANIFEST');
  const members = new Map(),
    jsons = new Map();
  let total = 0;
  for (const member of manifest.members) {
    if (
      !isObject(member) ||
      !validMember(member.path) ||
      members.has(member.path) ||
      !Number.isSafeInteger(member.size) ||
      member.size < 0 ||
      member.size > 16 * 1024 ** 3 ||
      !/^[a-f0-9]{64}$/.test(member.sha256 || '')
    )
      fail('DESKTOP_PLAN_INVALID_MANIFEST');
    total += member.size;
    if (total > 64 * 1024 ** 3) fail('DESKTOP_PLAN_CAPTURE_TOO_LARGE');
    const file = path.join(directory, ...member.path.split('/'));
    await noLinks(file);
    const stat = await fs.stat(file);
    if (!stat.isFile() || stat.size !== member.size) fail('DESKTOP_PLAN_MEMBER_MISMATCH');
    const digest = createHash('sha256');
    let size = 0;
    const pieces = [];
    if (logical.has(member.path) && member.size > 128 * 1024 ** 2)
      fail('DESKTOP_PLAN_GRAPH_TOO_LARGE');
    for await (const chunk of createReadStream(file, { highWaterMark: 256 * 1024 })) {
      digest.update(chunk);
      size += chunk.length;
      if (logical.has(member.path)) pieces.push(chunk);
    }
    const after = await fs.stat(file);
    if (
      size !== member.size ||
      digest.digest('hex') !== member.sha256 ||
      stat.mtimeMs !== after.mtimeMs ||
      (member.path.startsWith('media/') && member.path.slice(6) !== member.sha256)
    )
      fail('DESKTOP_PLAN_MEMBER_MISMATCH');
    members.set(member.path, { ...member });
    if (logical.has(member.path))
      jsons.set(
        member.path,
        JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(pieces))),
      );
  }
  for (const name of [
    'logical/library.typed.json',
    'logical/link.typed.json',
    'logical/preferences.json',
  ])
    if (!jsons.has(name)) fail('DESKTOP_PLAN_INCOMPLETE_CAPTURE');
  const roster = [...members.values()].sort((a, b) => a.path.localeCompare(b.path));
  const rosterHash = hash(
    Buffer.from(JSON.stringify(roster.map(({ path, size, sha256 }) => ({ path, size, sha256 })))),
  );
  if (manifest.bytes !== total || manifest.summary?.contentSha256 !== rosterHash)
    fail('DESKTOP_PLAN_CAPTURE_DIGEST_MISMATCH');
  const link = decodeDesktopRecoveryGraph(jsons.get('logical/link.typed.json'), members),
    library = decodeDesktopRecoveryGraph(jsons.get('logical/library.typed.json'), members);
  if (!uuid(link?.sourceId) || manifest.summary.sourceId !== link.sourceId)
    fail('DESKTOP_PLAN_SOURCE_IDENTITY_MISMATCH');
  const preferences = jsons.get('logical/preferences.json');
  if (
    preferences?.version !== 1 ||
    !isObject(preferences.values) ||
    !Array.isArray(preferences.uncollectedKeys)
  )
    fail('DESKTOP_PLAN_INVALID_PREFERENCES');
  return {
    manifestSha256: hash(raw),
    sourceSha256: rosterHash,
    sourceId: link.sourceId,
    members,
    link,
    library,
    preferences,
    assets: jsons.has('logical/assets.typed.json')
      ? decodeDesktopRecoveryGraph(jsons.get('logical/assets.typed.json'), members)
      : undefined,
    recoveries: jsons.has('logical/withdrawal-recovery.typed.json')
      ? decodeDesktopRecoveryGraph(jsons.get('logical/withdrawal-recovery.typed.json'), members)
      : undefined,
  };
}

/** Read-only reconciliation plan. No title matching, sender inference, writes,
 * automatic history backfill or acceptance of caller-supplied complete flags. */
export function planDesktopSource(db, capture) {
  const info = sharedInfo(db),
    sourceId = capture.sourceId,
    library = capture.library;
  const serverMessages = new Map(),
    media = new Map(),
    records = [];
  for (const item of db.media || [])
    if (item.sha256 && Number.isSafeInteger(item.size)) {
      const key = item.sha256 + ':' + item.size;
      if (!media.has(key)) media.set(key, []);
      media.get(key).push(item.id);
    }
  for (const entry of db.entries || [])
    if (entry.chatJournal?.sourceId === sourceId) {
      const room = id(entry.chatJournal.roomId);
      for (const message of entry.chatJournal.messages || []) {
        const key = room + ':' + id(message.id);
        if (!serverMessages.has(key)) serverMessages.set(key, []);
        serverMessages.get(key).push(message);
      }
    }
  const withdrawn = new Set(
    (library.shiyeWithdrawnMessages || []).map((m) => id(m.roomId) + ':' + id(m.messageId)),
  );
  const withdrawals = new Set(
    (library.shiyeWithdrawalOutbox || []).map((m) => id(m.roomId) + ':' + id(m.messageId)),
  );
  const documents = new Map(
    (Array.isArray(library.documents)
      ? library.documents
      : Object.values(library.documents || {})
    ).map((d) => [String(d.id), d]),
  );
  const localRooms = Object.keys(library.shiyeRooms || {}).map(id);
  const roomPlans = localRooms.map((roomId) => ({
    roomId,
    conversationId: `desktop:${sourceId}:${roomId}`,
    disposition: (db.chatJournal?.rooms || []).some(
      (r) => r.sourceId === sourceId && id(r.id) === roomId,
    )
      ? 'existing-review-cas'
      : 'needs-explicit-directory-registration',
  }));
  for (const [rawRoom, list] of Object.entries(library.messages || {})) {
    const roomId = id(rawRoom);
    if (!Array.isArray(list)) fail('DESKTOP_PLAN_INVALID_MESSAGES');
    const seen = new Set();
    for (const message of list) {
      const messageId = id(message.id),
        key = roomId + ':' + messageId;
      if (seen.has(messageId)) fail('DESKTOP_PLAN_DUPLICATE_MESSAGE');
      seen.add(messageId);
      const record = { roomId, messageId, conversationId: `desktop:${sourceId}:${roomId}` };
      const set = (disposition) => records.push({ ...record, disposition });
      // Reuse the existing journal's bundled-demo exclusion without coercing
      // message identities through Number.
      if (
        ['-10', '-20', '-30'].includes(roomId) &&
        BigInt(messageId) >= 1n &&
        BigInt(messageId) <= 10n
      ) {
        set('bundled-demo-private');
        continue;
      }
      if (withdrawn.has(key)) {
        set('source-withdrawn-never-resend');
        continue;
      }
      if (withdrawals.has(key)) {
        set('withdrawal-pending-private');
        continue;
      }
      if (message.shiyeProgram || message.shiyeComment) {
        const marker = message.shiyeProgram || message.shiyeComment;
        const serviceId =
          marker.instanceId ||
          (isLegacyConversation(record.conversationId) ? LEGACY_SERVICE_ID : null);
        const instance = (db.conversationServices?.instances || []).find(
          (s) =>
            s.id === serviceId &&
            (s.conversationId === record.conversationId ||
              db.conversationServices?.bindings?.some(
                (b) => b.instanceId === s.id && b.conversationId === record.conversationId,
              )),
        );
        const state = serviceId === LEGACY_SERVICE_ID ? db.revisit : instance?.state;
        const original = message.shiyeProgram
          ? state?.deliveries?.find(
              (d) => d.id === marker.deliveryId && d.batchId === marker.batchId,
            )
          : state?.comments?.find(
              (c) => c.operationId === marker.operationId && c.batchId === marker.batchId,
            );
        set(
          original
            ? message.shiyeComment && original.state === 'withdrawn'
              ? 'authoritative-comment-withdrawn-final'
              : 'authoritative-program-domain-reused'
            : 'program-or-comment-requires-original-domain',
        );
        continue;
      }
      if (
        message.out !== true ||
        message.isPending ||
        message.isFailed ||
        message.isLocal ||
        message.sendingState ||
        message.localForward ||
        message.replacementMediaIntent ||
        message.draft
      ) {
        set('pending-or-unproven-private');
        continue;
      }
      const matches = serverMessages.get(key) || [];
      if (matches.length > 1) {
        set('duplicate-server-identity-blocker');
        continue;
      }
      const current = matches[0];
      if (current?.withdrawn) {
        set('server-withdrawn-final');
        continue;
      }
      if (!current) {
        set('missing-history-requires-proven-backfill');
        continue;
      }
      const date =
        Number.isFinite(message.date) && Number.isFinite(new Date(message.date * 1000).valueOf())
          ? new Date(message.date * 1000).toISOString()
          : null;
      const attachments = current.attachments || [];
      let attachmentEqual = !message.media && attachments.length === 0;
      if (message.media) {
        const document = documents.get(String(message.media.id)),
          binary = document?.bytes?.captureBinary;
        const mapped = binary ? media.get(binary.sha256 + ':' + binary.size) || [] : [];
        attachmentEqual = attachments.length === 1 && mapped.includes(attachments[0]);
      }
      const replacementOf =
        message.replacesMessageId === undefined ? undefined : id(message.replacesMessageId);
      const root = message.orderRootId === undefined ? undefined : id(message.orderRootId);
      if (
        formatDesktopJournalText(message) !== current.text ||
        date !== current.sentAt ||
        !attachmentEqual ||
        (message.replyToMsgId === undefined ? undefined : id(message.replyToMsgId)) !==
          current.replyTo ||
        replacementOf !== current.replacementOf ||
        (replacementOf && root !== current.replacementRootId)
      ) {
        set('same-identity-content-conflict');
        continue;
      }
      set(replacementOf ? 'existing-successor-preserved' : 'existing-exact-reused');
    }
  }
  const counts = {};
  for (const row of records) counts[row.disposition] = (counts[row.disposition] || 0) + 1;
  const binaries = [...capture.members.values()]
    .filter((m) => m.path.startsWith('media/'))
    .map((m) => ({
      sha256: m.sha256,
      size: m.size,
      disposition: media.has(m.sha256 + ':' + m.size)
        ? 'existing-original-sha-candidate'
        : 'unmapped-private-binary-requires-role-review',
      candidateAssetIds: media.get(m.sha256 + ':' + m.size) || [],
    }));
  const blockers = [];
  if (!info.enabled) blockers.push('original-owner-shared-not-enabled');
  if (roomPlans.some((r) => r.disposition !== 'existing-review-cas'))
    blockers.push('unregistered-local-directory');
  if (
    records.some(
      (r) =>
        ![
          'existing-exact-reused',
          'existing-successor-preserved',
          'server-withdrawn-final',
          'source-withdrawn-never-resend',
          'bundled-demo-private',
          'authoritative-program-domain-reused',
          'authoritative-comment-withdrawn-final',
        ].includes(r.disposition),
    )
  )
    blockers.push('unresolved-message-dispositions');
  blockers.push(
    'directory-profile-state-order-cas-not-applied',
    'resource-domain-cas-not-applied',
    'portable-preferences-not-applied',
    'original-owner-source-receipt-not-registered',
  );
  if (capture.preferences.uncollectedKeys.some(key => key !== 'tt-last-activity'))
    blockers.push('uncollected-local-storage-values');
  const summary = {
    version: 1,
    kind: 'desktop-source-reconciliation-preview',
    sourceManifestSha256: capture.manifestSha256,
    sourceSha256: capture.sourceSha256,
    ownerEnabled: info.enabled,
    counts: {
      rooms: roomPlans.length,
      messages: records.length,
      binaryMembers: binaries.length,
      messageDispositions: counts,
    },
    completeComputerExport: false,
    writesPerformed: false,
    blockers,
  };
  return {
    summary,
    sourceId,
    owner: info,
    rooms: roomPlans,
    messages: records,
    binaries,
    mapping: {
      directory: 'original-conversation-directory-with-CAS',
      message: 'original-chatJournal/canonical-exact-identity',
      wallpaper: 'existing-three-domain-wallpaper-CAS',
      sticker: 'existing-sticker-catalog-and-explicit-asset-mapping',
      preferences: 'desktop:thoughts-sparse-portable-keys',
      privateRecovery: 'never-publish-as-active-shared-content',
    },
  };
}
