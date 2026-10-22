import { captureDesktopDirectory } from '../../../previews/telegram-chat/shiye-shared-directory-adapter.js';
import {
  DESKTOP_PORTABLE_PREFERENCE_KEYS,
  readDesktopPortablePreferences,
} from '../../../previews/telegram-chat/shiye-shared-directory-port.js';
import { portablePreferences } from '../../../public/shared/shared-preference-capture.js';
import { directoryView } from '../conversation-services/directory.mjs';
import { describeConversation } from '../conversation-services/conversations.mjs';
import { readConversationWallpaper } from '../conversation-services/wallpaper.mjs';
import { portableConfiguration } from '../sync-product/migration-metadata.mjs';
import { sharedInfo } from './replication.mjs';
import { planDesktopSource } from './desktop-source-plan.mjs';
import { sourceMessageFingerprint } from './source-message-conflicts.mjs';

const equal = (a, b) => sourceMessageFingerprint(a) === sourceMessageFingerprint(b);
const binary = (value) => value?.captureBinary;
const allowedImage = /^image\/(png|jpeg|gif|webp|avif)$/;
const privatePreferenceKeys = new Set([
  'shiye-room-order-v1',
  'shiye-symbol-usage-v1',
  'shiye-room-viewports-v1',
  'shiye-input-height',
  'shiye-room-state-v1',
  'shiye-room-switch-sidebar-v1',
  'shiye-switch-timing-v2',
]);

/** Dry-run only. Reuses the PC's pure directory/preference projection and existing
 * business CAS schemas; it never executes a program, creates identity or writes.
 * This recipe is NOT an authority token and cannot prove computer completeness. */
export function desktopCollectionRecipe(db, capture) {
  const info = sharedInfo(db),
    source = capture.sourceId,
    library = capture.library,
    raw = capture.preferences.values;
  const assets = capture.assets?.values || [],
    assetById = new Map(assets.map((a) => [a.id, a]));
  const user = (Array.isArray(library.users) ? library.users : []).find(
    (user) => user.self === true || user.id === '1',
  );
  const selfName =
    [user?.firstName, user?.lastName].filter((v) => typeof v === 'string' && v.trim()).join(' ') ||
    '我';
  const excluded = [],
    blockers = [],
    resourceRows = [];
  if (!info.enabled) blockers.push('original-owner-shared-not-enabled');
  const rooms = {};
  for (const [id, original] of Object.entries(library.shiyeRooms || {})) {
    // The recovery decoder deliberately creates null-prototype records. Clone
    // their data into ordinary objects for the existing JSON-only PC projector.
    const { wallpaperAssetId: _wallpaperAssetId, ...room } = structuredClone(original);
    rooms[id] = room;
  }
  const directory = captureDesktopDirectory({
    sourceId: source,
    rooms,
    dialogs: library.dialogs || {},
    journalRooms: capture.link.rooms || {},
    order: JSON.parse(raw['shiye-room-order-v1'] || '[]'),
    selfName,
  });
  excluded.push(...directory.excluded.map((row) => ({ ...row, domain: 'directory' })));
  const current = directoryView(db);
  const targets = directory.rooms.map((local) => {
    const remote = describeConversation(db, { conversationId: local.conversationId });
    const existing = current.conversations.find(
      (row) => row.conversationId === local.conversationId,
    );
    const metadata = portableConfiguration(local.clientMetadata, { excluded });
    const input = {
      conversationId: local.conversationId,
      expectedRevision: remote.revision,
      title: local.title,
      category: local.category,
      idleHours: local.idleHours,
      description: local.description,
      mode: local.mode,
      selfName: local.selfName,
      clientMetadata: {
        ...remote.clientMetadata,
        desktop: { ...remote.clientMetadata.desktop, ...metadata.desktop },
      },
    };
    const ownerRoom = (db.chatJournal?.rooms || []).find(
      (row) => `desktop:${row.sourceId}:${row.id}` === local.conversationId,
    );
    const before = {
      title: remote.title,
      category: remote.category,
      idleHours: remote.idleHours,
      description: remote.description,
      mode: remote.mode,
      selfName: remote.participants.find((p) => p.id === 'self')?.name || '我',
      clientMetadata: remote.clientMetadata,
    };
    const after = {
      title: input.title,
      category: input.category,
      idleHours: input.idleHours,
      description: input.description,
      mode: input.mode,
      selfName: input.selfName,
      clientMetadata: input.clientMetadata,
    };
    const profileSame = equal(before, after),
      stateSame =
        existing && existing.pinned === local.pinned && existing.archived === local.archived;
    const changedProfileFields = Object.keys(before).filter(
      (key) => !equal(before[key], after[key]),
    );
    const profileConflict = remote.revision > 0 && !profileSame;
    const stateConflict = existing?.listStateRevision > 0 && !stateSame;
    if (profileConflict) blockers.push('directory-profile-needs-reconciliation');
    if (stateConflict) blockers.push('directory-list-state-needs-reconciliation');
    return {
      conversationId: local.conversationId,
      sourceRoomId: local.conversationId.split(':')[2],
      ownerRoomSha256: sourceMessageFingerprint(ownerRoom || null),
      profile: {
        action: 'conversation-save',
        input,
        disposition: profileSame ? 'reuse' : profileConflict ? 'conflict' : 'initial-cas',
        changedFields: changedProfileFields,
      },
      listState: {
        action: 'conversation-list-state',
        input: {
          conversationId: local.conversationId,
          expectedRevision: existing?.listStateRevision || 0,
          pinned: local.pinned,
          archived: local.archived,
        },
        disposition: stateSame ? 'reuse' : stateConflict ? 'conflict' : 'initial-cas',
      },
    };
  });
  const allIds = new Set([...current.order, ...directory.order]);
  const order = [
    ...directory.order,
    ...current.order.filter((id) => !directory.order.includes(id)),
  ];
  const relativeCurrent = current.order.filter((id) => directory.order.includes(id));
  const orderConflict =
    current.revision > 0 &&
    relativeCurrent.length === directory.order.length &&
    !equal(relativeCurrent, directory.order);
  if (orderConflict) blockers.push('directory-order-needs-reconciliation');
  // The recovery member may contain an old multi-MiB wallpaper data URL. Strip
  // known resource/private fields with the SAME portable sanitizer before the
  // normal small JSON preference reader, while original bytes stay mapped apart.
  const preparedRaw = { ...raw };
  for (const spec of DESKTOP_PORTABLE_PREFERENCE_KEYS) {
    if (typeof spec === 'string' || !spec.json || !Object.hasOwn(raw, spec.key)) continue;
    const safe = portablePreferences({ [spec.key]: JSON.parse(raw[spec.key]) });
    excluded.push(...safe.excluded.map((row) => ({ ...row, domain: 'preferences' })));
    preparedRaw[spec.key] = JSON.stringify(safe.value[spec.key]);
  }
  const selected = readDesktopPortablePreferences({
    storage: { getItem: (key) => (Object.hasOwn(preparedRaw, key) ? preparedRaw[key] : null) },
  });
  const preferences = portablePreferences(selected);
  const restoreValues = {};
  const restorationCoverage = [];
  const switchModes = ['sidebar', 'direct', 'list', 'manual'];
  for (const key of ['shiye-room-switch-sidebar-v1', 'shiye-switch-timing-v2']) {
    if (!Object.hasOwn(raw, key)) {
      restorationCoverage.push({ key, status: 'absent-in-source' });
      continue;
    }
    let valid = raw[key] === '1';
    if (key === 'shiye-room-switch-sidebar-v1') {
      try {
        const value = JSON.parse(raw[key]);
        valid =
          raw[key].length <= 4096 &&
          value &&
          Object.keys(value).sort().join(',') === 'effectivePreviousMode,previousMode' &&
          (value.previousMode === null ||
            (typeof value.previousMode === 'string' && value.previousMode.length <= 64)) &&
          value.effectivePreviousMode ===
            (switchModes.includes(value.previousMode) ? value.previousMode : 'direct');
      } catch {
        valid = false;
      }
    }
    if (valid) {
      restoreValues[key] = raw[key];
      restorationCoverage.push({
        key,
        status: 'packaged-desktop-only-inert-restore-receipt',
        rendererStatus: 'pending-explicit-pc-restore-validation',
      });
    } else {
      blockers.push('desktop-restore-receipt-invalid');
      restorationCoverage.push({ key, status: 'invalid-private-recovery-preserved' });
    }
  }
  if (Object.keys(restoreValues).length)
    preferences.value = {
      ...preferences.value,
      restoreReceipts: { version: 1, values: restoreValues },
    };
  restorationCoverage.push(
    {
      key: 'shiye-room-state-v1',
      status: Object.hasOwn(raw, 'shiye-room-state-v1')
        ? 'private-cache-worker-directory-is-authority'
        : 'absent-in-source',
    },
    {
      key: 'shiye-input-height',
      status: Object.hasOwn(raw, 'shiye-input-height')
        ? 'private-legacy-test-only-no-product-reader'
        : 'absent-in-source',
    },
    { key: 'tt-last-activity', status: 'never-read-device-private-never-restored' },
  );
  excluded.push(...preferences.excluded.map((row) => ({ ...row, domain: 'preferences' })));
  if (!equal(portableConfiguration(preferences.value), preferences.value))
    blockers.push('preference-sanitizers-disagree');
  const prior = (db.sharedClientPreferences?.profiles || []).find(
    (p) => p.scope === 'desktop:thoughts',
  );
  let changedPreferenceKeys = Object.keys(preferences.value).filter(
    (key) => !equal(prior?.values?.[key] ?? null, preferences.value[key]),
  );
  const wallpapers = [],
    stickers = [];
  const global = assetById.get('wallpaper');
  const selectedIds = new Set(
    Object.values(library.shiyeRooms || {})
      .map((room) => room.wallpaperAssetId)
      .filter(Boolean),
  );
  if (global) selectedIds.add(global.id);
  for (const asset of assets) {
    const original = binary(asset.blob),
      id = String(asset.id),
      sticker = id.startsWith('sticker:');
    const required = sticker ? !asset.removed : selectedIds.has(id);
    const knownRole =
      sticker ||
      id === 'wallpaper' ||
      id.startsWith('wallpaper:room:') ||
      id.startsWith('mapping:') ||
      id === 'preference:sticker-order-v1';
    if (!knownRole) blockers.push('unknown-resource-role');
    if (id.startsWith('mapping:')) blockers.push('sticker-alias-needs-explicit-mapping');
    if (id === 'preference:sticker-order-v1')
      blockers.push('desktop-sticker-order-needs-explicit-mapping');
    if (required && (!original || !allowedImage.test(original.mime || '')))
      blockers.push('required-resource-original-invalid');
    const matches = original
      ? (db.media || [])
          .filter(
            (m) =>
              !m.deleted &&
              m.sha256 === original.sha256 &&
              m.size === original.size &&
              allowedImage.test(m.type || m.mime || ''),
          )
          .map((m) => m.id)
          .sort()
      : [];
    const preferred =
      asset.serverMediaId && matches.includes(asset.serverMediaId)
        ? asset.serverMediaId
        : matches[0] || null;
    if (required && !preferred) blockers.push('required-original-upload-needed');
    const resource = {
      sourceAssetId: id,
      required,
      role: sticker
        ? 'sticker'
        : id === 'wallpaper'
          ? 'global-wallpaper'
          : id.startsWith('wallpaper:room:')
            ? 'room-wallpaper'
            : id.startsWith('mapping:')
              ? 'sticker-alias'
              : 'desktop-sticker-order',
      original: original || null,
      mediaId: preferred,
      disposition: required
        ? preferred
          ? 'reuse-sha-candidate-requires-file-verification'
          : 'upload-then-recompile'
        : 'private-recovery-only',
    };
    resourceRows.push(resource);
    if (sticker && required) {
      const existing =
        (db.stickers || []).find(
          (item) => item.id === asset.serverStickerId && item.mediaId === preferred,
        ) || (db.stickers || []).find((item) => item.mediaId === preferred);
      const metadataSame =
        existing &&
        !existing.deleted &&
        ['name', 'group', 'note'].every(
          (key) => !Object.hasOwn(asset, key) || (existing[key] ?? '') === (asset[key] ?? ''),
        );
      if (existing && !metadataSame) blockers.push('sticker-metadata-needs-reconciliation');
      stickers.push({
        sourceAssetId: id,
        mediaId: preferred,
        stickerId: existing?.id || null,
        disposition: metadataSame ? 'reuse' : existing ? 'conflict' : 'collect-after-original',
        input: { mediaId: preferred, name: asset.name, group: asset.group, note: asset.note },
      });
    }
  }
  for (const legacy of capture.preferences.dataUrlMedia || []) {
    const matches = (db.media || [])
      .filter(
        (m) =>
          !m.deleted &&
          m.sha256 === legacy.sha256 &&
          m.size === legacy.size &&
          allowedImage.test(m.type || m.mime || ''),
      )
      .map((m) => m.id)
      .sort();
    resourceRows.push({
      sourceAssetId: 'legacy-global-wallpaper',
      required: true,
      role: 'legacy-global-wallpaper',
      original: {
        type: 'Blob',
        path: legacy.path,
        size: legacy.size,
        sha256: legacy.sha256,
        mime: legacy.mime,
      },
      mediaId: matches[0] || null,
      disposition: matches.length
        ? 'reuse-sha-candidate-requires-file-verification'
        : 'upload-then-recompile',
    });
    if (!matches.length) blockers.push('required-original-upload-needed');
  }
  const globalResource =
    resourceRows.find((row) => row.role === 'legacy-global-wallpaper') ||
    resourceRows.find((row) => row.role === 'global-wallpaper');
  const preferenceResourceBindings = [];
  if (globalResource?.mediaId) {
    const key = 'shiye-preview-appearance-v1';
    const currentValue = preferences.value[key] || {};
    if (typeof currentValue !== 'object' || Array.isArray(currentValue))
      blockers.push('global-wallpaper-preference-invalid');
    else {
      preferences.value = {
        ...preferences.value,
        [key]: { ...currentValue, wallpaperAssetId: globalResource.mediaId },
      };
      preferenceResourceBindings.push({
        scope: 'desktop:thoughts',
        key,
        field: 'wallpaperAssetId',
        sourceField: 'wallpaper',
        sourceMemberSha256: capture.members.get('logical/preferences.json')?.sha256 || null,
        mediaId: globalResource.mediaId,
        sha256: globalResource.original.sha256,
        size: globalResource.original.size,
        originalMemberPath: globalResource.original.path,
        rendererStatus: 'pending-explicit-frontend-resolver',
      });
    }
  }
  changedPreferenceKeys = Object.keys(preferences.value).filter(
    (key) => !equal(prior?.values?.[key] ?? null, preferences.value[key]),
  );
  if (prior?.revision > 0 && changedPreferenceKeys.length)
    blockers.push('preferences-needs-reconciliation');
  for (const target of targets) {
    const local = library.shiyeRooms[target.sourceRoomId];
    const assetId = local.wallpaperAssetId || global?.id;
    if (!assetId) continue;
    const asset = resourceRows.find((row) => row.sourceAssetId === assetId);
    if (!asset) {
      blockers.push('room-wallpaper-reference-missing');
      continue;
    }
    const registered = current.conversations.some(
      (row) => row.conversationId === target.conversationId,
    );
    const prior = registered
      ? readConversationWallpaper(db, { conversationId: target.conversationId })
      : { revision: 0, syncEnabled: true, sharedAssetId: null };
    const same = asset.mediaId && prior.syncEnabled && prior.sharedAssetId === asset.mediaId;
    const conflict = prior.revision > 0 && !same;
    if (conflict) blockers.push('wallpaper-needs-reconciliation');
    wallpapers.push({
      sourceAssetId: assetId,
      disposition: same
        ? 'reuse'
        : conflict
          ? 'conflict'
          : asset.mediaId
            ? 'initial-cas'
            : 'await-original',
      action: 'wallpaper-save',
      input: {
        conversationId: target.conversationId,
        scope: 'shared',
        expectedRevision: prior.revision,
        syncEnabled: true,
        sharedAssetId: asset.mediaId,
      },
    });
  }
  const messagePlan = planDesktopSource(db, capture);
  for (const row of messagePlan.messages) {
    if (row.disposition === 'same-identity-content-conflict') {
      const pending = (db.sourceMessageConflicts?.records || []).find(
        (c) => c.sourceId === source && c.roomId === row.roomId && c.messageId === row.messageId,
      );
      if (!pending) blockers.push('source-message-conflicts-not-registered');
    } else if (
      ![
        'existing-exact-reused',
        'existing-successor-preserved',
        'server-withdrawn-final',
        'source-withdrawn-never-resend',
        'bundled-demo-private',
        'authoritative-program-domain-reused',
        'authoritative-comment-withdrawn-final',
      ].includes(row.disposition)
    )
      blockers.push('source-message-not-accounted');
  }
  const portableKeys = new Set(
    DESKTOP_PORTABLE_PREFERENCE_KEYS.map((spec) => (typeof spec === 'string' ? spec : spec.key)),
  );
  const unclassified = [
    ...capture.preferences.uncollectedKeys.filter((key) => key !== 'tt-last-activity'),
    ...Object.keys(raw).filter((key) => !portableKeys.has(key) && !privatePreferenceKeys.has(key)),
  ];
  if (unclassified.length) blockers.push('unclassified-storage-key');
  const summary = {
    version: 1,
    kind: 'desktop-source-mapping-recipe',
    sourceManifestSha256: capture.manifestSha256,
    writesPerformed: false,
    completeComputerExport: false,
    counts: {
      rooms: targets.length,
      newRooms: targets.filter((row) => !current.order.includes(row.conversationId)).length,
      profileCas: targets.filter((row) => row.profile.disposition === 'initial-cas').length,
      listStateCas: targets.filter((row) => row.listState.disposition === 'initial-cas').length,
      portablePreferenceKeys: Object.keys(selected).length,
      preferencePayloadKeys: Object.keys(preferences.value).length,
      desktopRestoreReceiptKeys: Object.keys(restoreValues).length,
      preferenceChanges: changedPreferenceKeys.length,
      resourceOriginals: resourceRows.filter((row) => row.original).length,
      requiredOriginals: resourceRows.filter((row) => row.required).length,
      requiredOriginalsToUpload: new Set(
        resourceRows
          .filter((row) => row.required && !row.mediaId)
          .map((row) => row.original?.sha256),
      ).size,
      wallpaperBindings: wallpapers.length,
      stickerBindings: stickers.length,
      stickerBindingsReused: stickers.filter((row) => row.disposition === 'reuse').length,
      privateResources: resourceRows.filter((row) => !row.required).length,
      unclassifiedStorageKeys: unclassified.length,
    },
    blockers: [...new Set(blockers)],
  };
  return {
    version: 1,
    sourceId: source,
    sourceManifestSha256: capture.manifestSha256,
    sourceSha256: capture.sourceSha256,
    owner: info,
    summary,
    directory: {
      rooms: targets,
      order: {
        action: 'conversation-order',
        expectedRevision: current.revision,
        order,
        expectedSet: [...allIds].sort(),
        disposition: orderConflict
          ? 'conflict'
          : equal(current.order, order)
            ? 'reuse'
            : 'initial-cas',
      },
    },
    preferences: {
      action: 'client-preferences-save',
      input: {
        scope: 'desktop:thoughts',
        expectedRevision: prior?.revision || 0,
        set: preferences.value,
        remove: [],
      },
      changedKeys: changedPreferenceKeys,
    },
    resources: resourceRows,
    wallpapers,
    stickers,
    preferenceResourceBindings,
    restorationCoverage,
    excluded,
    unclassifiedStorageKeys: unclassified,
    sourceReceipt: {
      status: 'not-registered',
      required: [
        'directory-profile-state-order-final-cas',
        'preferences-final-revision-hash',
        'every-required-original-full-sha-binding',
        'wallpaper-and-sticker-final-cas',
        'source-message-conflict-receipts',
        'source-generation-unchanged-or-trusted-following-delta',
      ],
      completeComputerExport: false,
    },
    messageCoverage: messagePlan.summary.counts,
  };
}
