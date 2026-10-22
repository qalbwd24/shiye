# 组件与 AI 数据接入

0.9.10 提供独立的日记开放数据格式。日记和壁纸、日历、待办项目各自维护结构，不要求合并数据库。现有 `data/diary.json` 已是明文 JSON，本次不迁移正式数据、不重写旧正文；完整备份仍保持加密。

## 使用入口

“设置 → 组件与 AI 数据”可查看读取地址、打开组件示例、进入结构化导出。“本地导出”也提供 JSON，范围为当前日记、当前列表、全部非隐藏日记；评论默认不导出，按需勾选。当前日记／当前列表保留你的显式选择，包括主动打开的隐藏记录。

JSON 是明文，包含正文源格式、分类标签、时间、状态和已登记附件元信息，不含媒体实体、历史、旧导入原始对象、设置和凭据。媒体地址为本机 `/media/:id`。JSON 用于分析和展示，完整迁移请使用备份；此格式目前没有独立导入入口。导出文件由浏览器选择保存位置。

## 版本化读取接口

默认地址 `http://127.0.0.1:18765/api/open/v1`。所有接口只读：

| 路径           | 用途                                                |
| -------------- | --------------------------------------------------- |
| `/schema`      | 可机器读取的版本、字段和能力说明                    |
| `/entries`     | 筛选、排序、分页日记                                |
| `/entries/:id` | 单篇日记                                            |
| `/random`      | 随机回忆；每次默认使用新 seed，可提供 seed 复现顺序 |
| `/anniversary` | 往年同月同日；date 参数为 YYYY-MM-DD                |
| `/export`      | 可下载的分页 JSON；使用相同筛选规则                 |

共有筛选项：`from/to`（包含边界的 YYYY-MM-DD）、`category/tag`（精确名称）、`q`（文字子串）、`ids`（逗号分隔 UUID）。`timeZone` 默认 Asia/Shanghai，用于 recordedDate 和周年日期，原始 date 不改动。`sort` 为 date-desc、date-asc、updated-desc；同值由 ID 排序。`limit` 默认 50、最大 200；`offset` 默认 0。随机默认 limit=1，支持 `seed`、`exclude`。往日此时只匹配早于指定年份的同月同日。

默认过滤隐藏、草稿、已删除记录。只有显式 `includeHidden=true/includeDrafts=true/includeDeleted=true` 才读取对应状态。`includeComments=true` 返回未删除评论，包括作者快照、回复关联与评论附件。未知参数、错误日期／时区、非法枚举会返回 400；单篇被默认过滤时返回 404。

列表响应含 `apiVersion/schemaVersion/entries/total/limit/offset/nextOffset/snapshot/timeZone`。下一页必须携带上页 snapshot；库变化返回 409，调用方应重新读取整次结果，不能把两次快照混在一起。snapshot 不代表服务器保存了历史库。随机分页同时固定 seed。单篇响应将 entries 换成 entry。`/export` 另外包含 format 和 exportedAt，仍需按 nextOffset 逐页读取。界面导出则一次写出所选日记，无分页上限。

记录字段：`id/revision/title/date/recordedDate/createdAt/updatedAt/category/tags/mood/weather/location/document/state/attachments`，可选 comments。`document.format` 是 markdown 或 html，`document.source` 为完整可编辑源文，`document.html` 为原 HTML 投影；旧富文本不强制转 Markdown。显示 HTML 必须清洗。附件包含 `id/name/type/size/sha256/url`，保留已知来源时间和 EXIF 字段，不重新解释或修改照片时间。完整字段以 `/schema` 为准。

## 本机访问边界

服务只监听回环地址；没有新增外网端口，也没有开放跨域 CORS。开启本地锁后，接口和媒体需要已有解锁 Cookie；schema 同样受锁保护。接口不是可对外分享的匿名令牌服务。普通桌面程序可以通过本机 HTTP 请求；若开启锁，应使用已解锁的浏览器宿主或明确管理同一个会话。另一个端口的网站不能直接跨域读取，需使用自己的本机后端或加载同服务组件。

没有接入任何外部 AI、没有自动发送数据。AI 工具可读取你选择导出的文件，或由你控制本机调用范围。浏览器组件不需要修改原始文件。

```powershell
# 仅在自己的本机服务未启用访问锁时直接读取。
$diaryPage = Invoke-RestMethod 'http://127.0.0.1:18765/api/open/v1/entries?limit=20'
$diaryPage | ConvertTo-Json -Depth 40 | Set-Content -LiteralPath '.\diary-page.json' -Encoding UTF8
```

## 可复用组件客户端

`public/integrations/diary-client.js` 不依赖主界面。`createDiaryClient()` 默认使用所在页面的同源服务，支持配置 baseURL 和 fetchImpl。提供 list、getEntry、schema、random、anniversary、iterateEntries、setPinned、addComment。

```javascript
import { createDiaryClient } from '/integrations/diary-client.js';
const diary = createDiaryClient();
for await (const entry of diary.iterateEntries({ category: '生活', limit: 100 })) {
  // 使用 entry.document.source；渲染 HTML 时先清洗。
}
const entry = await diary.getEntry('日记UUID');
await diary.setPinned(entry.id, true, entry.revision);
// await diary.addComment(entry.id, {body:'新的感想', entryRevision:entry.revision});
```

开放接口本身只读。客户端互动复用现有写接口，写入前读取完整对象，保留未知旧字段；必须提交读取时 revision，冲突返回 409，调用方提示刷新后重新确认，不自动覆盖。`addComment` 保存时需要 entryRevision；回复等扩展请按现有评论 API 实现。

示例地址 `/components/diary-card.html`，提供最近记录、随机回忆、往日此时、下一篇和置顶。媒体按自然比例展示，正文复用清洗器；可作为壁纸 WebView 的独立页面参考。示例不是桌面壁纸安装器，也没有跨项目数据同步。完整接口验证和 UI 实测结果见本次验收记录。
