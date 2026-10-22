# Android 标准数据与调用契约补全

2026-10-18用户要求：开发文档保证后续Android按标准数据格式接好前端/本地Repository后，可以直接调用既有后端。

## 本轮产物

- `docs/ANDROID-PRODUCT-SYNC-CONTRACT.md`：统一版本、字段/身份、时间、正文权威、事务端口、调用依赖、恢复/错误/容量及验收门槛。
- `docs/contracts/android-product-sync-v1.fixture.json`：9个纯合成业务信封，含richdoc/canonical、独立图片时间、GIF原件、分类/会话配置/收藏、长整数字符串消息/引用，完整push写入和业务请求示例。
- `tools/verify-android-sync-contract.mjs`：默认只读验证fixture；`--write-fixture`仅在显式更新golden样本时使用。实际调用现有业务/底层操作校验器，检查规范ID、手打北京时间、独立图片时间、未知字段、原件hash和评论目标。
- `outputs/product-sync-contract/verification.json`：本轮验证回执与fixture SHA-256，无真实日记或凭据。

## 源码核对与歧义澄清

已核对sync-product服务实际route/action、共用业务客户端/队列、codec/canonical规则、朝花夕拾comments/context，以及Android015和桌面沉浸式最新文档。

区分“UI没点引用”和“HTTP未传deliveryId”：当前UI规范默认最近历史单条，调用时同样要带deliveryId；API只带batchId才是整组。显式组评论兼容、不改变旧关联。不更改既有后端行为或UI默认。

产品18789只提供库级revisit接缝，既有日常多实例registry是另一服务；不把通用binding实体写成功当作实例运行。文档还明确：productValue输出不含_canonical、未hydrate payload不能直接传productLibraryView、本地事务不能由独立CRUD桥拼成、sourceId/长消息ID/各种revision与cursor分开。

## 验证与边界

合成fixture通过共用业务/底层操作校验、稳定ID、canonical重组及时间、未知字段、原件字节、单条/组/媒体评论字段验证。工具ESLint/格式与新文档/fixture格式检查通过，文档相对文件链接核验通过。采用定向文档/DTO验证，不重复上一轮128项后台或无关UI矩阵。

本轮不改服务器运行代码、不调用线上写入、不操作手机/正式窗口、不安装APK、不写旧日记或切换canonical。没有声称Android实际本地事务、强杀恢复、真机同步或正式电脑增量登记已实现。既有后端运行/128项证据仍以[上一轮](2026-10-18-product-sync.md)为准，历史PID/地址须现场查询。

已同步工作区、交接、API、Android015、数据模型和功能索引入口，以及F:/agent规范的主题引用。正式文档位于docs/，回执位于outputs/product-sync-contract/；本轮无需新增临时目录。
