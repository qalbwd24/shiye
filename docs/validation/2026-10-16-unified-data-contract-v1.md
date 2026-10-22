# 统一数据 v1 草案检查

日期：2026-10-16。范围：数据契约设计、现有代码只读核对、虚构样本校验。未修改业务代码、UI、正式数据或运行程序，没有执行迁移、升级或重新启动。

## 产物与边界

- `docs/UNIFIED-DATA-CONTRACT-V1.md`：字段、关系、朝花夕拾自动评论/引用优先级、只读归篇、撤回与模块适配顺序。
- `docs/contracts/unified-data-v1.schema.json`：JSON Schema Draft-07 设计草案，非当前运行库 schema。
- `docs/contracts/unified-data-v1.example.json`：全虚构闭合对象图；有 6 条内容、3 个篇目、1 个固定回看上下文，包含跨年组评论和单条引用评论。媒体仅为占位元数据，没有实际图片字节，不是可恢复包。
- 相关需求、数据模型/API/功能索引仅增加设计入口；既有研究的相反建议已按本轮确认修订。共享技术主题与索引已同步。
- 临时生成/校验脚本位于 `tmp/unified-data-contract-v1/`。复用已安装 Ajv 6，没有新增或安装依赖。

## 结果

`node tmp/unified-data-contract-v1/validate-contract.cjs`：22 项通过，结果及 schema/示例 SHA-256 在 `outputs/unified-data-contract-v1/validation.json`。

正例覆盖：完整虚构对象图；改当前规则不改既有上下文；删除当前规则仍保留规则快照；分类改名不失联；来源后来撤回仍保留关联身份且无正文。

反例覆盖：重复 ID；撤回保留正文；组评论悄悄丢目标；单条回复多目标；评论作为回看来源；回看规则包含评论；聊天篇目标为可编辑；评论伪装原消息；缺来源/媒体；重复图片出现位置 ID；伪造观察版本；错误块引用；无效时区；评论冒用历史时间；用 history 保存撤回原文；来源身份重复。

本轮编辑的项目文档与 JSON 定向格式检查通过。共享目录 `validate_catalog.py` 通过，结果在 `F:/agent规范/outputs/2026-10-16-unified-data-v1-catalog.json`。

## 未验证

- schema 与关系检查不证明服务器已阻止正文编辑、撤回原文已清理、真实 UI 自动绑定正确、Markdown 可无损往返或媒体/备份已完整恢复。
- 当前 `/api/chat-journal/*` 仍是原有新增/回执桥接，候选 `/api/unified/v1/*` 尚未开放。
- 未运行应用全量 `npm run check`、编辑器/IME/安卓交互、大库性能或跨端同步测试；本轮没有业务实现改动。
- 起草期间另一对话继续 UI 工作，不能把其他对话的代码变化或运行验收归入本报告。
