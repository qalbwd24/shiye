# 本地 API 说明

默认地址 `http://127.0.0.1:18765`。JSON成功响应为业务对象，错误响应为 `{ "error": "说明" }`，HTTP状态表达成功或失败。二进制附件和备份下载不返回JSON。

写请求必须带 `X-Diary-Client: desktop`；JSON请求带 `Content-Type: application/json`。浏览器Origin必须匹配本地服务；外部来源请求被拒绝。开启本地锁后，业务API与媒体下载需要服务颁发的会话Cookie。此表不授权任何对外联网或数据上传。

| 方法与路径                                   | 行为                                             | 所属模块       |
| -------------------------------------------- | ------------------------------------------------ | -------------- |
| GET /api/health                              | 应用标识与版本                                   | app            |
| GET /api/library                             | 全部库元数据                                     | app            |
| POST /api/entries                            | 创建完整日记对象                                 | entries        |
| PUT /api/entries/:id                         | 完整对象+revision更新，冲突409                   | entries        |
| POST /api/categories                         | 添加分类名称                                     | entries        |
| PUT /api/settings                            | 更新shortcuts命令绑定                            | settings       |
| PUT /api/preferences                         | 更新允许的偏好字段                               | organization   |
| POST /api/taxonomy                           | kind/category或tag，from、to、action重命名／移除 | organization   |
| POST /api/templates                          | 新增模板                                         | organization   |
| PUT /api/templates/:id                       | 编辑、删除标记或恢复模板                         | organization   |
| POST /api/media                              | 原始媒体流；Content-Type及URL编码X-File-Name     | media          |
| GET /media/:id                               | 读取媒体，支持Range                              | media          |
| POST /api/import-upload                      | 原备份流暂存，返回id                             | imports        |
| POST /api/import-upload/:id/commit           | 解压、读取旧格式、合并库；重复原件409            | imports        |
| GET /api/original/:id                        | 下载逐字节保留的原件                             | legacy-backups |
| GET /api/export                              | 明文元数据JSON，不含附件实体                     | legacy-backups |
| GET /api/bundle                              | 旧版整包数据，128MiB上限                         | legacy-backups |
| POST /api/import                             | 旧内存上传接口，保留兼容                         | legacy-backups |
| POST /api/restore                            | 恢复旧解密bundle                                 | legacy-backups |
| GET /api/backup-manifest                     | 日记快照、所有文件大小／哈希                     | backups        |
| GET /api/backup-file/:folder/:id             | Range读取media或originals供浏览器加密            | backups        |
| GET /api/backups                             | 列出完整syvault2文件                             | backups        |
| POST /api/backups                            | 创建备份会话，body为格式头                       | backups        |
| POST /api/backups/:id/record                 | 追加有序加密记录                                 | backups        |
| POST /api/backups/:id/finish                 | 核对记录数，发布完整备份                         | backups        |
| POST /api/backups/:id/cancel                 | 取消当前会话及其临时文件                         | backups        |
| GET /api/backups/:id                         | 下载完整加密备份                                 | backups        |
| POST /api/restore-jobs                       | 用已解密manifest建立暂存会话                     | backups        |
| POST /api/restore-jobs/:job/file/:folder/:id | 文件块，X-Offset保证顺序                         | backups        |
| POST /api/restore-jobs/:job/commit           | 全文件哈希校验通过后追加库                       | backups        |
| POST /api/restore-jobs/:job/cancel           | 清理本会话暂存                                   | backups        |
| GET /api/access                              | 查询启用与解锁状态                               | access         |
| PUT /api/access                              | 设置／修改／关闭本地锁                           | access         |
| POST /api/unlock                             | 校验密码并颁发会话                               | access         |
| POST /api/lock                               | 撤销当前会话                                     | access         |

新增／修改日记示例仅用于隔离开发库：

```json
{
  "title": "合成样本",
  "content": "<p>测试正文</p>",
  "date": "2026-09-14T08:00:00.000Z",
  "category": "开发测试",
  "tags": [],
  "attachments": [],
  "mood": "",
  "weather": "",
  "location": ""
}
```

更新时先GET库取得日记完整对象，修改所需字段，携带原revision执行PUT。删除是同样的PUT将deleted设为true；恢复设为false。当前不提供永久删除日记或自动清除所有未引用媒体的接口。

完整备份协议由 public/shared/vault2.js 驱动；调用方必须验证结束记录，不能只收到部分文件就提交恢复。服务器不知道备份密码，不能代替客户端验证AES认证标签。
