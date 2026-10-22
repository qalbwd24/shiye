/* Own dropped bytes during the drop task; a sender's filename/MIME is only a hint. */
(() => {
  const isMedia = (type) => /^(image|video)\//i.test(type || '');
  const prefix = (bytes, values, offset = 0) =>
    values.every((value, i) => bytes[offset + i] === value);
  const text = (bytes, offset, length) =>
    String.fromCharCode(...bytes.subarray(offset, offset + length));
  function detectType(bytes, declared, name) {
    if (prefix(bytes, [137, 80, 78, 71, 13, 10, 26, 10])) return 'image/png';
    if (prefix(bytes, [255, 216, 255])) return 'image/jpeg';
    if (['GIF87a', 'GIF89a'].includes(text(bytes, 0, 6))) return 'image/gif';
    if (text(bytes, 0, 4) === 'RIFF' && text(bytes, 8, 4) === 'WEBP') return 'image/webp';
    if (text(bytes, 0, 2) === 'BM') return 'image/bmp';
    if (text(bytes, 4, 4) === 'ftyp' && /avif|avis/.test(text(bytes, 8, 24))) return 'image/avif';
    if (
      text(bytes, 4, 4) === 'ftyp' &&
      /isom|iso[2-9]|mp4[12]|avc1|M4V |qt  /.test(text(bytes, 8, 24))
    )
      return /qt  /.test(text(bytes, 8, 4)) ? 'video/quicktime' : 'video/mp4';
    if (prefix(bytes, [26, 69, 223, 163]) && /\.webm$/i.test(name || '')) return 'video/webm';
    // Do not turn arbitrary HTML/text into an image just because it is named .jpg.
    if (/^video\//.test(declared || '')) return declared;
    return undefined;
  }
  function isCandidate(data) {
    return (
      !!data &&
      ([...(data.types || [])].some(
        (type) =>
          ['Files', 'text/html', 'text/uri-list', 'text/plain', 'DownloadURL'].includes(type) ||
          /image|weixin|wechat|x-qt|filegroupdescriptor/i.test(type),
      ) ||
        [...(data.items || [])].some((item) => item.kind === 'file'))
    );
  }
  function capture(event) {
    const data = event.dataTransfer;
    if (!data) return null;
    const listed = [...(data.files || [])];
    const items = [...(data.items || [])]
      .filter((item) => item.kind === 'file')
      .map((item) => item.getAsFile?.())
      .filter(Boolean);
    const files = listed.length
      ? listed.map((file, index) => (!file.size && items[index]?.size ? items[index] : file))
      : items;
    if (!files.length || files.every((file) => !file.size)) {
      const handles = [...(data.items || [])]
        .filter((item) => item.kind === 'file' && item.getAsFileSystemHandle)
        .map((item) => {
          try {
            return Promise.resolve(item.getAsFileSystemHandle());
          } catch {
            return Promise.resolve(null);
          }
        });
      if (handles.length)
        return Promise.all(
          handles.map((handle) =>
            handle.then((value) => (value?.kind === 'file' ? value.getFile() : null)),
          ),
        ).then((owned) => {
          const available = owned.filter((file) => file?.size);
          if (!available.length)
            throw Error('来源没有交付可读取的图片原件；请在微信另存原图后拖入，或复制后粘贴');
          return capture({ dataTransfer: { files: available } });
        });
    }
    if (files.length) {
      // Start every read synchronously. Files/handles from other applications may expire after drop.
      const reads = files.map((file) => {
        let read;
        const large = file.size > 64 * 1024 * 1024;
        try {
          read = large && file.slice ? file.slice(0, 64).arrayBuffer() : file.arrayBuffer();
        } catch (error) {
          read = Promise.reject(error);
        }
        return Promise.resolve(read).then(async (buffer) => {
          const bytes = new Uint8Array(buffer);
          if (!bytes.length) throw Error('拖入的文件内容为空，请从来源重新拖入');
          const type = detectType(bytes, file.type, file.name);
          if (type?.startsWith('image/') && (large || bytes.byteLength > 64 * 1024 * 1024))
            throw Error('拖入图片超过64 MiB，请先缩小原图；动图不会静默转成静态图');
          if (!type) {
            if (isMedia(file.type) || /\.(jpe?g|png|gif|webp|avif)$/i.test(file.name || ''))
              throw Error('未读到有效图片原件，来源可能只提供了占位文件');
            return new File([large ? file : buffer], file.name || '拖入文件', {
              type: file.type || 'application/octet-stream',
            });
          }
          if (type === 'image/bmp') {
            const bitmap = await createImageBitmap(new Blob([buffer], { type }));
            try {
              const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
              canvas.getContext('2d').drawImage(bitmap, 0, 0);
              const png = await canvas.convertToBlob({ type: 'image/png' });
              return new File([png], (file.name || '拖入图片').replace(/\.[^.]+$/, '') + '.png', {
                type: 'image/png',
              });
            } finally {
              bitmap.close();
            }
          }
          const extension = {
            'image/gif': 'gif',
            'image/png': 'png',
            'image/jpeg': 'jpg',
            'image/webp': 'webp',
            'image/avif': 'avif',
          }[type];
          let name = file.name || '拖入媒体';
          if (
            extension &&
            !new RegExp('\\.' + (extension === 'jpg' ? 'jpe?g' : extension) + '$', 'i').test(name)
          )
            name = name.replace(/\.[^.]+$/, '') + '.' + extension;
          return new File([large ? file : buffer], name, {
            type,
            lastModified: Number.isFinite(file.lastModified) ? file.lastModified : Date.now(),
          });
        });
      });
      return Promise.all(reads).then((result) => {
        const media = result.filter(Boolean);
        if (!media.length) throw Error('这次拖入没有可读取的图片或视频');
        return media;
      });
    }
    const html = data.getData?.('text/html') || '';
    const image = /<img\b[^>]*\ssrc\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i.exec(html);
    const raw =
      image?.[1] ||
      image?.[2] ||
      image?.[3] ||
      data.getData?.('text/uri-list')?.trim() ||
      data.getData?.('DownloadURL') ||
      (/^(data:image\/|file:\/\/)/i.test(data.getData?.('text/plain') || '')
        ? data.getData('text/plain')
        : '') ||
      '';
    const inline = /^data:(image\/(?:png|jpeg|gif|webp|avif));base64,([a-z0-9+/=\s]+)$/i.exec(raw);
    if (inline) {
      return Promise.resolve().then(() => {
        if (inline[2].length > 90 * 1024 * 1024) throw Error('拖入图片超过当前 64 MiB 读取上限');
        const bytes = Uint8Array.from(atob(inline[2]), (char) => char.charCodeAt(0));
        if (bytes.byteLength > 64 * 1024 * 1024) throw Error('拖入图片超过64 MiB');
        const type = detectType(bytes, inline[1]);
        if (!type || !type.startsWith('image/')) throw Error('拖入内容不是有效图片');
        const ext = type.split('/')[1].replace('jpeg', 'jpg');
        return [new File([bytes], '拖入表情.' + ext, { type })];
      });
    }
    for (const type of [...(data.types || [])].filter(
      (value) => /^image\//i.test(value) || /x-qt-image/i.test(value),
    )) {
      const value = data.getData?.(type);
      if (!value || value.length > 90 * 1024 * 1024) continue;
      try {
        const rawBytes = /^[a-z0-9+/=\s]+$/i.test(value) ? atob(value) : value;
        const bytes = Uint8Array.from(rawBytes, (character) => character.charCodeAt(0));
        const mime = detectType(bytes, type);
        if (mime?.startsWith('image/'))
          return capture({
            dataTransfer: { files: [new File([bytes], '拖入图片', { type: mime })] },
          });
      } catch {
        /* A proprietary transfer is not automatically an image. */
      }
    }
    if (
      image ||
      raw ||
      [...(data.types || [])].some(
        (type) => type === 'Files' || /image|weixin|wechat|x-qt|filegroupdescriptor/i.test(type),
      )
    )
      return Promise.reject(
        Error('来源没有提供可读取的图片文件；这次只收到了链接或虚拟文件，未发送任何内容'),
      );
    return null;
  }
  window.shiyeDroppedMedia = {
    isCandidate,
    capture,
    detectType,
    async normalize(file) {
      const result = await capture({ dataTransfer: { files: [file] } });
      return result[0];
    },
  };
})();
