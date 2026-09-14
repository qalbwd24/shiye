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
  if (!r.ok) throw Error(result.error || '请求失败');
  return result;
}

export function uploadMediaFile(file, onProgress = () => {}) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', '/api/media');
    xhr.setRequestHeader('X-Diary-Client', 'desktop');
    xhr.setRequestHeader('X-File-Name', encodeURIComponent(file.name));
    xhr.setRequestHeader('Content-Type', file.type || 'application/octet-stream');
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress(e.loaded / e.total);
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
  });
}
