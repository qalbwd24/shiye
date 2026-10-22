/* Shared collection adapter. Original blobs/local alias IDs remain recoverable offline. */
(() => {
  const assets = () => window.shiyeLocalAssets;
  let transport;
  let libraryReader;
  let syncing;
  let retryTimer;
  let retries = 0;
  function retrySync() {
    if (retryTimer || retries >= 3) return;
    retryTimer = setTimeout(() => {
      retryTimer = undefined;
      retries++;
      sync()
        .then(() => {
          retries = 0;
          window.dispatchEvent(new Event('shiye-stickers-updated'));
        })
        .catch(retrySync);
    }, [1000, 3000, 8000][retries]);
  }
  const assetOperations = new Map();
  function serializeAsset(id, operation) {
    const next = (assetOperations.get(id) || Promise.resolve()).catch(() => {}).then(operation);
    assetOperations.set(id, next);
    const cleanup = () => {
      if (assetOperations.get(id) === next) assetOperations.delete(id);
    };
    next.then(cleanup, cleanup);
    return next;
  }
  const mimeAllowed = (type) => /^image\/(png|jpeg|webp|gif|avif)$/.test(type || '');
  const backend = () => transport || window.shiyeJournal;
  async function call(action, payload) {
    if (!backend()?.stickers) throw Error('收藏服务尚未连接，已有本地表情包仍可使用');
    return backend().stickers(action, payload);
  }
  const metadataKeys = ['name', 'note', 'group', 'deleted'];
  const own = (value, key) => Object.prototype.hasOwnProperty.call(value || {}, key);
  const metadata = (fields) =>
    Object.fromEntries(
      metadataKeys.filter((key) => fields[key] !== undefined).map((key) => [key, fields[key]]),
    );
  async function hashBlob(blob) {
    return [...new Uint8Array(await crypto.subtle.digest('SHA-256', await blob.arrayBuffer()))]
      .map((byte) => byte.toString(16).padStart(2, '0'))
      .join('');
  }
  async function acceptReceipt(base, result, sent = {}) {
    const current = (await assets().get(base.id)) || base;
    const sticker = result.sticker || result;
    // A local replacement original belongs to a different upload. An old ACK
    // may not attach that upload's server identity to the replacement bytes.
    if (
      base.blob instanceof Blob &&
      current.blob instanceof Blob &&
      (base.blob.size !== current.blob.size ||
        base.blob.type !== current.blob.type ||
        (await hashBlob(base.blob)) !== (await hashBlob(current.blob)))
    )
      return current;
    if (sticker.updatedAt && current.serverUpdatedAt && sticker.updatedAt < current.serverUpdatedAt)
      return current;
    const next = {
      ...current,
      // This is a lossless last-confirmed DTO cache, never a second authority or write payload.
      serverStickerSnapshot: JSON.parse(JSON.stringify(sticker)),
      ...(sticker.id !== undefined ? { serverStickerId: sticker.id } : {}),
      ...(sticker.mediaId !== undefined ? { serverMediaId: sticker.mediaId } : {}),
      ...(sticker.updatedAt !== undefined ? { serverUpdatedAt: sticker.updatedAt } : {}),
      ...(result.media !== undefined || sticker.media !== undefined
        ? { media: JSON.parse(JSON.stringify(result.media ?? sticker.media)) }
        : {}),
    };
    for (const key of [...metadataKeys, 'createdAt', 'updatedAt']) {
      if (!own(sticker, key) || current[key] !== base[key]) continue;
      if (
        own(current.pendingMetadata, key) &&
        (!own(sent, key) || current.pendingMetadata[key] !== sent[key])
      )
        continue;
      next[key] = sticker[key];
    }
    if (
      own(sticker, 'deleted') &&
      current.removed === base.removed &&
      (sticker.deleted || current.removed !== undefined)
    )
      next.removed = !!sticker.deleted;
    const pending = { ...current.pendingMetadata };
    for (const key of Object.keys(sent))
      if (own(sticker, key) && pending[key] === sent[key] && current[key] === base[key])
        delete pending[key];
    if (Object.keys(pending).length) next.pendingMetadata = pending;
    else delete next.pendingMetadata;
    await assets().put(next);
    return next;
  }
  async function link(asset, source) {
    return serializeAsset(asset.id, () => linkAsset(asset, source));
  }
  async function linkAsset(asset, source) {
    asset = (await assets().get(asset.id)) || asset;
    if (asset.removed) return asset;
    if (asset.serverStickerId && !source) return asset;
    if (!asset.contentHash) {
      const digest = await crypto.subtle.digest('SHA-256', await asset.blob.arrayBuffer());
      asset = {
        ...asset,
        contentHash: [...new Uint8Array(digest)]
          .map((byte) => byte.toString(16).padStart(2, '0'))
          .join(''),
      };
      await assets().put(asset);
    }
    const uploadBase = asset;
    const mediaId = asset.serverMediaId || (await backend().uploadSticker(asset));
    const uploadedCurrent = (await assets().get(asset.id)) || asset;
    if (
      uploadedCurrent.removed ||
      (uploadBase.blob instanceof Blob &&
        uploadedCurrent.blob instanceof Blob &&
        (await hashBlob(uploadBase.blob)) !== (await hashBlob(uploadedCurrent.blob)))
    )
      return uploadedCurrent;
    // Persist the upload ACK first, so retries reuse its identity even if collection fails.
    asset = { ...asset, ...uploadedCurrent, serverMediaId: mediaId };
    await assets().put(asset);
    source ||= asset.source;
    const result = source
      ? await call('from-message', {
          version: 1,
          source,
          mediaId,
          name: asset.name,
          note: asset.note,
          group: asset.group,
        })
      : await call('collect', { mediaId, name: asset.name, note: asset.note, group: asset.group });
    return acceptReceipt(asset, result);
  }
  async function sync() {
    if (syncing) return syncing;
    syncing = (async () => {
      // Read before upload: an unavailable/locked server must never replace local favorites.
      const local = await assets().list('sticker:');
      const catalog = await call('catalog');
      if (catalog.version !== 1 || !Array.isArray(catalog.items)) throw Error('收藏目录格式不兼容');
      const byId = new Map(catalog.items.map((item) => [item.id, item]));
      for (const asset of local) {
        if (!asset.serverStickerId) {
          if (asset.blob && !asset.removed) {
            const linked = await link(asset);
            if (linked.pendingMetadata) await edit(linked, linked.pendingMetadata);
          }
          continue;
        }
        const latest = (await assets().get(asset.id)) || asset;
        if (latest.pendingMetadata && !latest.removed) {
          await edit(latest, latest.pendingMetadata);
          continue;
        }
        await serializeAsset(asset.id, async () => {
          const current = await assets().get(asset.id);
          // Ignore a stale catalog response if another local operation already changed this item.
          if (
            !current ||
            current.serverUpdatedAt !== asset.serverUpdatedAt ||
            current.removed !== asset.removed ||
            JSON.stringify(current.serverStickerSnapshot) !==
              JSON.stringify(asset.serverStickerSnapshot) ||
            current.pendingMetadata
          )
            return;
          const item = byId.get(current.serverStickerId);
          if (!item) await assets().put({ ...current, removed: true });
          else if (
            !current.removed ||
            !current.serverUpdatedAt ||
            item.updatedAt > current.serverUpdatedAt
          )
            await acceptReceipt(current, item);
        });
      }
      const after = await assets().list('sticker:');
      for (const item of catalog.items) {
        if (after.some((asset) => asset.serverStickerId === item.id)) continue;
        await acceptReceipt({ id: 'sticker:server:' + item.id }, item);
      }
    })().finally(() => {
      syncing = undefined;
    });
    return syncing;
  }
  async function materialize(asset) {
    if (asset.blob instanceof Blob && asset.blob.size > 0) return asset;
    const media = asset.media;
    if (
      !media ||
      !mimeAllowed(media.type) ||
      !Number.isSafeInteger(media.size) ||
      media.size <= 0 ||
      media.size > 64 * 1024 * 1024
    )
      throw Error('原图片不可用或超过当前 64 MiB 读取上限');
    const chunks = [];
    let offset = 0;
    while (offset < media.size) {
      const part = await call('media', { mediaId: asset.serverMediaId, offset });
      const bytes = Uint8Array.from(atob(part.bytes), (char) => char.charCodeAt(0));
      if (
        part.offset !== offset ||
        !bytes.length ||
        bytes.length > 262144 ||
        offset + bytes.length > media.size ||
        part.mime !== media.type
      )
        throw Error('原图分块校验失败，请重试');
      chunks.push(bytes);
      offset += bytes.length;
    }
    const blob = new Blob(chunks, { type: media.type });
    if (media.sha256) {
      const digest = new Uint8Array(
        await crypto.subtle.digest('SHA-256', await blob.arrayBuffer()),
      );
      const hash = [...digest].map((byte) => byte.toString(16).padStart(2, '0')).join('');
      if (hash !== media.sha256) throw Error('原图校验失败，请重试');
    }
    const current = (await assets().get(asset.id)) || asset;
    if (current.blob instanceof Blob && current.blob.size) return current;
    if (current.serverMediaId !== asset.serverMediaId) throw Error('原图片已改变，请重新打开');
    const next = { ...asset, ...current, blob };
    await assets().put(next);
    return next;
  }
  async function readLibrary() {
    if (libraryReader) return libraryReader();
    const db = await new Promise((resolve, reject) => {
      const request = indexedDB.open('shiye-telegram-preview-v1', 1);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    try {
      return await new Promise((resolve, reject) => {
        const request = db.transaction('preview').objectStore('preview').get('library');
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
    } finally {
      db.close();
    }
  }
  async function preview(asset) {
    const current = (await assets().get(asset.id)) || asset;
    if (current.previewBlob instanceof Blob) return current.previewBlob;
    const owned = await materialize(current);
    if (owned.blob.size > 64 * 1024 * 1024)
      throw Error('原表情包超过64 MiB，已保留文件但暂不生成预览');
    if (!globalThis.createImageBitmap || !globalThis.OffscreenCanvas) return owned.blob;
    const bitmap = await createImageBitmap(owned.blob);
    try {
      const scale = Math.min(192 / Math.max(bitmap.width, bitmap.height), 1);
      const canvas = new OffscreenCanvas(
        Math.max(1, Math.round(bitmap.width * scale)),
        Math.max(1, Math.round(bitmap.height * scale)),
      );
      canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      const blob = await canvas.convertToBlob({ type: 'image/webp', quality: 0.75 });
      await assets().put({ ...owned, ...(await assets().get(asset.id)), previewBlob: blob });
      return blob;
    } finally {
      bitmap.close();
    }
  }
  async function saveMessage({ roomId, messageId, name: givenName, note }) {
    // A new bubble can be visible before its IndexedDB transaction commits.
    await window.shiyeRoomUi?.command('flush');
    const library = await readLibrary();
    const message = library?.messages?.[roomId]?.find(
      (item) => String(item.id) === String(messageId),
    );
    if (
      !message?.media ||
      message.shiyeWithdrawn ||
      library.shiyeWithdrawnMessages?.some(
        (item) => item.roomId === String(roomId) && item.messageId === String(messageId),
      )
    )
      throw Error('原消息或图片已不可用');
    const document = library.documents?.find((item) => item.id === message.media.id);
    const actualType =
      document?.bytes?.length && window.shiyeDroppedMedia
        ? window.shiyeDroppedMedia.detectType(new Uint8Array(document.bytes), document.mimeType)
        : document?.mimeType;
    if (!document?.bytes?.length || !mimeAllowed(actualType))
      throw Error('这条消息没有可收藏的图片或 GIF 原文件');
    const name =
      document.attributes?.find((item) => item.fileName)?.fileName ||
      (document.mimeType === 'image/gif' ? '表情包.gif' : '表情包图片');
    const blob = new Blob([new Uint8Array(document.bytes)], { type: actualType });
    if (blob.size > 64 * 1024 * 1024) throw Error('表情包原件超过64 MiB，请先缩小文件');
    const hash = [
      ...new Uint8Array(await crypto.subtle.digest('SHA-256', await blob.arrayBuffer())),
    ]
      .map((byte) => byte.toString(16).padStart(2, '0'))
      .join('');
    const all = await assets().list('sticker:');
    let asset = all.find((item) => item.contentHash === hash && !item.removed);
    asset ||= {
      id: 'sticker:' + crypto.randomUUID(),
      name,
      blob,
      contentHash: hash,
      localSource: { roomId: String(roomId), messageId: String(messageId) },
    };
    if (givenName !== undefined || note !== undefined)
      asset = {
        ...asset,
        ...(givenName !== undefined ? { name: givenName.trim() || name } : {}),
        ...(note !== undefined ? { note } : {}),
        pendingMetadata: {
          ...asset.pendingMetadata,
          ...(givenName !== undefined ? { name: givenName.trim() || name } : {}),
          ...(note !== undefined ? { note } : {}),
        },
      };
    // Local durability first; remote failure is reported and retried on the next panel opening.
    await assets().put(asset);
    window.dispatchEvent(new Event('shiye-stickers-updated'));
    if (!backend()?.stickers) return { asset, localOnly: true };
    try {
      // Old generic-file messages may have been archived under the wrong MIME.
      // Import a correctly typed favorite without changing that original message or forging its receipt.
      const source =
        actualType === document.mimeType
          ? await backend().stickerSource?.(String(roomId), String(messageId))
          : undefined;
      if (source) {
        asset = { ...asset, source };
        await assets().put(asset);
      }
      asset = await link(asset, source);
      if (givenName !== undefined || note !== undefined)
        asset = await edit(asset, {
          ...(givenName !== undefined ? { name: asset.name } : {}),
          ...(note !== undefined ? { note } : {}),
        });
      return { asset };
    } catch (error) {
      retrySync();
      return { asset, localOnly: true, error: error.message };
    }
  }
  async function edit(asset, fields) {
    fields = metadata(fields);
    return serializeAsset(asset.id, async () => {
      const current = (await assets().get(asset.id)) || asset;
      if (fields.name !== undefined && (!fields.name.trim() || fields.name.length > 250))
        throw Error('表情名称请填写1–250个字符');
      if (fields.note !== undefined && fields.note.length > 2000) throw Error('备注最多2000个字符');
      const staged = {
        ...current,
        ...fields,
        pendingMetadata: { ...current.pendingMetadata, ...fields },
      };
      await assets().put(staged);
      if (!staged.serverStickerId) return staged;
      const receipt = await call('update', { id: staged.serverStickerId, ...fields });
      return acceptReceipt(staged, receipt, fields);
    });
  }
  async function remove(asset) {
    return serializeAsset(asset.id, async () => {
      asset = (await assets().get(asset.id)) || asset;
      const receipt = asset.serverStickerId
        ? await call('update', { id: asset.serverStickerId, deleted: true })
        : undefined;
      // Keep original bytes and alias identity; hide without deleting historical local material.
      if (receipt) await acceptReceipt(asset, receipt);
      else await assets().put({ ...asset, removed: true });
    });
  }
  function promptMetadata(detail, asset) {
    const dialog = document.createElement('dialog');
    dialog.className = 'shiye-dialog shiye-sticker-metadata';
    dialog.setAttribute('data-stricterdom-ignore', '');
    dialog.innerHTML =
      '<header><h2>保存表情包</h2><button type="button" aria-label="关闭">×</button></header>' +
      '<form><label>名称<input name="name" maxlength="250" required></label>' +
      '<label>备注<textarea name="note" maxlength="2000" rows="3" placeholder="可选；仅用于收藏管理，不会随消息发送"></textarea></label>' +
      '<p role="status"></p><div class="shiye-actions"><button type="button" data-cancel>取消</button><button type="submit">保存</button></div></form>';
    const form = dialog.querySelector('form');
    form.elements.name.value = asset?.name || detail?.name || '表情包';
    form.elements.note.value = asset?.note || '';
    for (const button of dialog.querySelectorAll('header button, [data-cancel]'))
      button.onclick = () => dialog.close();
    dialog.addEventListener('close', () => dialog.remove(), { once: true });
    let composing = false;
    form.addEventListener('compositionstart', () => {
      composing = true;
    });
    form.addEventListener('compositionend', () => {
      composing = false;
    });
    form.onsubmit = async (event) => {
      event.preventDefault();
      const submit = form.querySelector('[type=submit]');
      if (composing || submit.disabled) return;
      submit.disabled = true;
      try {
        const fields = { name: form.elements.name.value.trim(), note: form.elements.note.value };
        if (!fields.name) throw Error('请输入表情包名称');
        const result = asset
          ? await edit(asset, fields)
          : await saveMessage({ ...detail, ...fields });
        dialog.close();
        window.getActions?.()?.showNotification({
          message: result?.localOnly ? '已收藏到本机；后台同步将自动重试' : '已保存为表情包',
        });
        window.dispatchEvent(new Event('shiye-stickers-updated'));
      } catch (error) {
        form.querySelector('[role=status]').textContent = error.message;
      } finally {
        submit.disabled = false;
      }
    };
    document.body.append(dialog);
    dialog.showModal();
    form.elements.name.focus();
    form.elements.name.select();
    return dialog;
  }
  window.shiyeStickers = {
    sync,
    materialize,
    preview,
    saveMessage,
    remove,
    edit,
    promptEdit: (asset) => promptMetadata(undefined, asset),
    canSync: () => !!backend()?.stickers,
    setTransport(value) {
      transport = value;
    },
    setLibraryReader(read) {
      libraryReader = read;
    },
  };
  window.addEventListener('shiye-save-sticker', ({ detail }) => promptMetadata(detail));
})();
