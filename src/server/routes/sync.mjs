import { promises as fs } from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import {
  fetchDiarySource,
  normalizeBase,
  putDiarySource,
  toDiarySource,
} from '../sync/legacy-webdav.mjs';
import { reconcileCloud, wireFingerprints } from '../sync/reconciliation.mjs';

const syncSettings = (db) => db.settings?.sync || {};

async function reusableMediaManifest(dataDir, db, stored = {}) {
  const result = {};
  for (const [name, item] of Object.entries(stored)) {
    if (!item?.etag || !item.sha256) continue;
    const local = (db.media || []).find(
      (media) => media.sha256 === item.sha256 && Number(media.size) === Number(item.size),
    );
    if (!local) continue;
    try {
      await fs.access(path.join(dataDir, 'media', local.id));
    } catch {
      continue;
    }
    result[name] = { ...item, mediaId: local.id };
  }
  return result;
}

async function saveRemoteImport({ dataDir, getDb, mutate, remote, previous }) {
  if (!remote.imported) return { entries: 0, media: 0, conflicts: 0, skipped: true };
  const imported = remote.imported;
  const already = getDb().imports?.some((item) => item.sha256 === remote.sha256);
  if (already) return { entries: 0, media: 0, conflicts: 0, skipped: true };
  const archive = {
    ...imported.archive,
    id: randomUUID(),
    sha256: remote.sha256,
    name: 'WebDAV diary.json',
  };
  await fs.writeFile(path.join(dataDir, 'originals', archive.id), remote.raw, { flag: 'wx' });
  for (const media of imported.media)
    if (media.data)
      await fs.writeFile(path.join(dataDir, 'media', media.id), media.data, { flag: 'wx' });
  let reconciliation;
  try {
    await mutate((db) => {
      db.imports ||= [];
      if (db.imports.some((item) => item.sha256 === remote.sha256)) return;
      reconciliation = reconcileCloud(db, remote, previous).report;
      db.imports.push(archive);
      db.templates = [...(db.templates || []), ...(imported.templates || [])];
      db.tags = [...new Set([...(db.tags || []), ...(imported.tags || [])])];
      db.categories = [...new Set([...(db.categories || []), ...(imported.categories || [])])];
      db.settings ||= {};
      db.settings.sync = {
        ...syncSettings(db),
        pendingRemoteSha: remote.sha256,
      };
    });
  } catch (error) {
    await fs.unlink(path.join(dataDir, 'originals', archive.id)).catch(() => {});
    for (const media of imported.media)
      if (media.data) await fs.unlink(path.join(dataDir, 'media', media.id)).catch(() => {});
    throw error;
  }
  for (const id of reconciliation?.redundantMedia || [])
    await fs.unlink(path.join(dataDir, 'media', id)).catch(() => {});
  return { ...reconciliation, skipped: false };
}

function inputConfig(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw Error('同步配置不正确');
  return {
    url: normalizeBase(input.url),
    username: String(input.username || '').trim(),
    password: input.password,
  };
}

export function createRoutes({ dataDir, getDb, mutate, body, reply, fail }) {
  let busy = false;
  return async (req, res, p) => {
    if (p === '/api/sync/status' && req.method === 'GET') {
      const value = syncSettings(getDb());
      return reply(res, 200, {
        configured: !!(value.url && value.username),
        url: value.url || '',
        username: value.username || '',
        encryption: 'legacy-plaintext',
        lastSyncAt: value.lastSyncAt || null,
        lastRemoteSha: value.remoteSha256 || null,
        lastRemoteEtag: value.remoteEtag || null,
        pendingRemoteSha: value.pendingRemoteSha || null,
      });
    }
    if (p !== '/api/sync' || req.method !== 'POST') return false;
    let input;
    try {
      input = JSON.parse((await body(req, 1024 * 1024)).toString('utf8'));
      if (!['sync', 'pull', 'test'].includes(input.action))
        throw Error('请选择测试、拉取或同步操作');
    } catch (error) {
      throw fail(400, error.message || '同步请求格式不正确');
    }
    const action = input.action;
    let config;
    try {
      config = inputConfig(input);
      if (!config.username || typeof config.password !== 'string' || !config.password)
        throw Error('请填写 WebDAV 用户名和密码');
    } catch (error) {
      throw fail(400, error.message);
    }
    // The Android-compatible diary.json is not an end-to-end encrypted container.
    // Never upload a real library without a deliberate acknowledgement in the UI.
    if (action === 'sync' && input.allowUnencrypted !== true)
      throw fail(400, '原版兼容同步文件不是端到端加密。请先确认已了解此限制，再选择上传。');
    if (busy) throw fail(409, '已有同步正在执行，请等本次完成');
    busy = true;
    try {
      const saved = syncSettings(getDb());
      const previous = saved.url === config.url && saved.username === config.username ? saved : {};
      const mediaManifest = await reusableMediaManifest(
        dataDir,
        getDb(),
        previous.mediaManifest || {},
      );
      let remote;
      try {
        remote = await fetchDiarySource(config, {
          etag: previous.remoteEtag,
          mediaManifest,
        });
      } catch (error) {
        throw fail(502, error.message);
      }
      if (remote.notModified) {
        remote.sha256 = previous.remoteSha256 || null;
        remote.mediaManifest = mediaManifest;
      }
      if (action === 'test') {
        return reply(res, 200, {
          ok: true,
          empty: remote.empty,
          notModified: !!remote.notModified,
          remoteSha256: remote.sha256,
          remoteEntries: remote.imported?.entries?.length || previous.remoteEntries || 0,
          remoteMedia: remote.imported?.media?.length || previous.remoteMedia || 0,
        });
      }
      const shouldPull =
        !remote.empty &&
        !remote.notModified &&
        remote.sha256 !== previous.remoteSha256 &&
        remote.sha256 !== previous.pendingRemoteSha;
      let pulled = { entries: 0, media: 0, conflicts: 0, skipped: true };
      if (shouldPull) {
        try {
          pulled = await saveRemoteImport({ dataDir, getDb, mutate, remote, previous });
        } catch (error) {
          throw fail(500, '合并云端数据失败：' + error.message);
        }
      }
      if (action === 'pull') {
        await mutate((db) => {
          db.settings ||= {};
          db.settings.sync = {
            ...syncSettings(db),
            url: config.url,
            username: config.username,
            remoteSha256: remote.sha256,
            remoteEtag: remote.etag || previous.remoteEtag || null,
            mediaManifest: remote.mediaManifest || mediaManifest,
            remoteEntries: remote.imported?.entries?.length || previous.remoteEntries || 0,
            remoteMedia: remote.imported?.media?.length || previous.remoteMedia || 0,
            pendingRemoteSha: pulled.conflicts ? remote.sha256 : null,
            lastPullAt: new Date().toISOString(),
          };
        });
        return reply(res, 200, {
          ok: !pulled.conflicts,
          action,
          status: pulled.conflicts ? 'conflicts' : 'pulled',
          remoteSha256: remote.sha256,
          pulled,
          message: pulled.conflicts ? '已保留不同版本，请先处理冲突再同步。' : undefined,
        });
      }
      if (pulled.conflicts) {
        await mutate((db) => {
          db.settings ||= {};
          db.settings.sync = {
            ...syncSettings(db),
            url: config.url,
            username: config.username,
            pendingRemoteSha: remote.sha256,
            remoteEtag: remote.etag || previous.remoteEtag || null,
            mediaManifest: remote.mediaManifest || mediaManifest,
            remoteEntries: remote.imported?.entries?.length || previous.remoteEntries || 0,
            remoteMedia: remote.imported?.media?.length || previous.remoteMedia || 0,
            lastSyncAt: new Date().toISOString(),
          };
        });
        return reply(res, 200, {
          ok: false,
          action,
          status: 'conflicts',
          remoteSha256: remote.sha256,
          pulled,
          message: '云端有内容与本地不同，已保留两份。请先处理冲突，再次同步。',
        });
      }
      if (
        previous.pendingRemoteSha &&
        getDb().conflicts?.some((conflict) => conflict.status === 'open')
      ) {
        return reply(res, 200, {
          ok: false,
          action,
          status: 'conflicts',
          remoteSha256: remote.sha256,
          pulled,
          message: '仍有未处理的同步冲突。请在冲突管理中选择保留版本后再同步。',
        });
      }
      const current = getDb();
      let payload;
      try {
        payload = toDiarySource(current, {
          previousSource:
            remote.source || (previous.sourceSt ? { st: previous.sourceSt } : undefined),
        });
        for (const media of payload.mediaFiles) {
          media.filePath = path.join(dataDir, 'media', media.id);
          await fs.access(media.filePath);
        }
      } catch (error) {
        throw fail(error.status === 409 ? 409 : 500, '生成安卓兼容同步数据失败：' + error.message);
      }
      const payloadSha = createHash('sha256').update(JSON.stringify(payload.source)).digest('hex');
      // Both sides already have this exact Android projection. Avoid a full
      // diary.json PUT even though the original client always rewrites it.
      if (!remote.empty && remote.sha256 === payloadSha) {
        await mutate((db) => {
          db.settings ||= {};
          db.settings.sync = {
            ...syncSettings(db),
            url: config.url,
            username: config.username,
            remoteSha256: remote.sha256,
            remoteEtag: remote.etag || previous.remoteEtag || null,
            localSourceSha256: payloadSha,
            sourceSt: payload.source.st,
            mediaManifest: remote.mediaManifest || mediaManifest,
            remoteEntries: JSON.parse(payload.source.json).length,
            remoteMedia: Object.keys(remote.mediaManifest || mediaManifest).length,
            pendingRemoteSha: null,
            lastSyncAt: new Date().toISOString(),
          };
        });
        return reply(res, 200, {
          ok: true,
          action,
          status: 'synced',
          remoteSha256: remote.sha256,
          pulled,
          pushed: { skipped: true, uploadedMedia: 0, bytes: 0, uploadedMediaBytes: 0 },
        });
      }
      if (remote.notModified && previous.localSourceSha256 === payloadSha) {
        await mutate((db) => {
          db.settings ||= {};
          db.settings.sync = {
            ...syncSettings(db),
            url: config.url,
            username: config.username,
            lastSyncAt: new Date().toISOString(),
          };
        });
        return reply(res, 200, {
          ok: true,
          action,
          status: 'synced',
          remoteSha256: remote.sha256,
          pulled,
          pushed: { skipped: true, uploadedMedia: 0, bytes: 0, uploadedMediaBytes: 0 },
        });
      }
      let pushed;
      try {
        pushed = await putDiarySource(config, payload, {
          remote: {
            ...remote,
            mediaManifest: { ...(remote.mediaManifest || {}), ...mediaManifest },
          },
        });
      } catch (error) {
        throw fail(502, error.message);
      }
      await mutate((db) => {
        db.settings ||= {};
        db.settings.sync = {
          ...syncSettings(db),
          url: config.url,
          username: config.username,
          remoteSha256: pushed.sha256,
          remoteEtag: pushed.etag || remote.etag || null,
          localSourceSha256: payloadSha,
          sourceSt: payload.source.st,
          mediaManifest: {
            ...mediaManifest,
            ...(remote.mediaManifest || {}),
            ...(pushed.mediaManifest || {}),
          },
          remoteEntries: JSON.parse(payload.source.json).length,
          remoteMedia: payload.mediaFiles.length,
          pendingRemoteSha: null,
          lastSyncAt: new Date().toISOString(),
          wireFingerprints: wireFingerprints(payload.source),
        };
      });
      return reply(res, 200, {
        ok: true,
        action,
        status: 'synced',
        remoteSha256: pushed.sha256,
        pulled,
        pushed,
      });
    } finally {
      busy = false;
    }
  };
}
