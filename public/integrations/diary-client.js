/** Same-service client. Cross-origin access remains subject to the server's access policy. */
export function createDiaryClient({
  baseURL = globalThis.location?.origin && globalThis.location.origin !== 'null'
    ? globalThis.location.origin
    : 'http://127.0.0.1:18765',
  fetchImpl = globalThis.fetch,
} = {}) {
  const base = new URL(baseURL);
  const error = (status, message) => Object.assign(new Error(message), { status });
  const entryPath = (id) => `/api/entries/${encodeURIComponent(id)}`;
  const requireRevision = (revision) => {
    if (!Number.isSafeInteger(revision) || revision < 1)
      throw error(400, '请提供刚刚读取的有效日记 revision');
  };
  async function request(path, parameters = {}, { method = 'GET', data } = {}) {
    const url = new URL(path, base);
    for (const [key, value] of Object.entries(parameters)) {
      if (value !== undefined && value !== null)
        url.searchParams.set(key, Array.isArray(value) ? value.join(',') : String(value));
    }
    const response = await fetchImpl(url.href, {
      method,
      credentials: 'same-origin',
      headers: {
        Accept: 'application/json',
        ...(method !== 'GET'
          ? { 'Content-Type': 'application/json', 'X-Diary-Client': 'desktop' }
          : {}),
      },
      ...(data === undefined ? {} : { body: JSON.stringify(data) }),
    });
    let payload;
    try {
      payload = await response.json();
    } catch {
      throw error(response.status, '服务返回了无法识别的响应，请刷新重试');
    }
    if (!response.ok)
      throw error(response.status, payload?.error || `请求失败 (${response.status})`);
    if (!payload || typeof payload !== 'object') throw error(502, '服务返回了无效的数据结构');
    return payload;
  }
  const list = (parameters = {}) => request('/api/open/v1/entries', parameters);
  const getEntry = async (id, parameters = {}) => {
    const result = await request(`/api/open/v1/entries/${encodeURIComponent(id)}`, parameters);
    if (!result.entry) throw error(404, '日记不存在或未包含在筛选范围内');
    return result.entry;
  };
  const readSaved = (id) =>
    getEntry(id, {
      includeHidden: true,
      includeDrafts: true,
      includeDeleted: true,
      includeComments: true,
    });
  return {
    list,
    getEntry,
    schema: () => request('/api/open/v1/schema'),
    random: (parameters = {}) => request('/api/open/v1/random', parameters),
    anniversary: (parameters = {}) => request('/api/open/v1/anniversary', parameters),
    async *iterateEntries(parameters = {}) {
      let offset = parameters.offset ?? 0;
      let snapshot = parameters.snapshot;
      if (!Number.isSafeInteger(offset) || offset < 0) throw error(400, 'offset 须为非负安全整数');
      do {
        const page = await list({ ...parameters, offset, snapshot });
        if (typeof page.snapshot !== 'string' || !page.snapshot)
          throw error(502, '服务未提供分页快照');
        if (snapshot !== undefined && snapshot !== page.snapshot)
          throw error(409, '日记库已更新，请重新开始读取');
        if (!Array.isArray(page.entries) || page.offset !== offset)
          throw error(502, '服务返回了无效的分页内容');
        if (
          page.nextOffset !== null &&
          (!page.entries.length ||
            !Number.isSafeInteger(page.nextOffset) ||
            page.nextOffset !== offset + page.entries.length)
        )
          throw error(502, '服务返回了无效的分页位置');
        snapshot = page.snapshot;
        for (const entry of page.entries) yield entry;
        if (page.nextOffset === null) return;
        offset = page.nextOffset;
      } while (true);
    },
    async setPinned(id, pinned, revision) {
      requireRevision(revision);
      if (typeof pinned !== 'boolean') throw error(400, 'pinned 须为布尔值');
      const current = await request(entryPath(id));
      if (current.revision !== revision) throw error(409, '日记已更新，请刷新后核对再操作');
      await request(entryPath(id), {}, { method: 'PUT', data: { ...current, pinned, revision } });
      return readSaved(id);
    },
    async addComment(id, { body, attachments = [], entryRevision } = {}) {
      requireRevision(entryRevision);
      await request(
        entryPath(id) + '/comments',
        {},
        {
          method: 'POST',
          data: { body, attachments, entryRevision },
        },
      );
      return readSaved(id);
    },
  };
}
