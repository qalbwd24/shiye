export async function uploadLegacyFile(file, status) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', '/api/import-upload');
    xhr.setRequestHeader('X-Diary-Client', 'desktop');
    xhr.setRequestHeader('X-File-Name', encodeURIComponent(file.name));
    xhr.setRequestHeader('Content-Type', 'application/octet-stream');
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable)
        status.textContent = `正在接收备份 ${(e.loaded / 1048576).toFixed(1)} / ${(e.total / 1048576).toFixed(1)} MB`;
    };
    xhr.onerror = () =>
      reject(Error('本地服务连接中断。请重新运行拾页日记启动程序；原备份没有修改。'));
    xhr.onload = () => {
      try {
        const data = JSON.parse(xhr.responseText);
        if (xhr.status >= 400) reject(Error(data.error || '导入上传失败'));
        else resolve(data);
      } catch {
        reject(Error('本地服务返回了无效结果，请重启应用后重试'));
      }
    };
    xhr.send(file);
  });
}
export async function api(url, { method = 'GET', data, raw, headers = {} } = {}) {
  const r = await fetch(url, {
    method,
    headers: {
      ...(method !== 'GET' ? { 'X-Diary-Client': 'desktop' } : {}),
      ...(data ? { 'Content-Type': 'application/json' } : {}),
      ...headers,
    },
    body: raw ?? (data ? JSON.stringify(data) : undefined),
  });
  const result = await r.json();
  if (!r.ok) {
    const error = Error(result.error || '请求失败');
    error.status = r.status;
    error.details = result;
    throw error;
  }
  return result;
}

const videoJobs = new WeakMap();
export async function uploadMediaFile(file, onProgress = () => {}, metadata = {}) {
  const transcode =
    file.type?.startsWith('video/') && ['balanced', 'high'].includes(metadata.quality);
  const existing = transcode ? videoJobs.get(file)?.[metadata.quality] : null;
  const result =
    existing ||
    (await new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open(
        'POST',
        transcode ? '/api/media-compression-upload?quality=' + metadata.quality : '/api/media',
      );
      xhr.setRequestHeader('X-Diary-Client', 'desktop');
      xhr.setRequestHeader('X-File-Name', encodeURIComponent(file.name));
      xhr.setRequestHeader('Content-Type', file.type || 'application/octet-stream');
      if (Number.isFinite(file.lastModified) && file.lastModified >= 0)
        xhr.setRequestHeader('X-File-Last-Modified', String(file.lastModified));
      for (const [field, header] of Object.entries({
        originalSize: 'X-Original-Size',
        sourceCapturedAtRaw: 'X-Source-Captured-At',
        sourceCapturedOffset: 'X-Source-Captured-Offset',
        sourceCapturedTag: 'X-Source-Captured-Tag',
        compression: 'X-Media-Compression',
      })) {
        if (metadata[field] !== undefined && metadata[field] !== null && metadata[field] !== '')
          xhr.setRequestHeader(header, encodeURIComponent(String(metadata[field])));
      }
      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable) onProgress((e.loaded / e.total) * (transcode ? 0.25 : 1), '上传');
      };
      xhr.onerror = () => reject(Error('连接中断，请重试；已完成的文件不受影响'));
      xhr.onload = () => {
        try {
          const result = JSON.parse(xhr.responseText);
          if (xhr.status >= 200 && xhr.status < 300) resolve(result);
          else reject(Error(result.error || '上传失败'));
        } catch (e) {
          reject(e);
        }
      };
      xhr.send(file);
    }));
  if (!transcode) return result;
  videoJobs.set(file, { ...videoJobs.get(file), [metadata.quality]: result });
  let status = result;
  let failures = 0;
  while (!['done', 'error'].includes(status.state)) {
    onProgress(
      0.25 + 0.75 * (Number(status.progress) || 0),
      status.state === 'queued' ? '等待视频压缩' : '视频压缩',
    );
    await new Promise((resolve) => setTimeout(resolve, 750));
    try {
      status = await api('/api/media-compression/' + encodeURIComponent(result.id));
      failures = 0;
    } catch (error) {
      if (/不存在|重启/.test(error.message)) {
        videoJobs.delete(file);
        throw error;
      }
      if (++failures >= 8)
        throw Error('视频状态暂时无法读取。重试会继续查询同一任务；请保持此页面打开。');
    }
  }
  if (status.state === 'error') {
    videoJobs.delete(file);
    throw Error(status.error || '视频压缩失败，可重试或选择保留原件');
  }
  onProgress(1, status.reason || '已完成');
  return status.media;
}
