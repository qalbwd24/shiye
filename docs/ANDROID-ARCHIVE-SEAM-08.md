# Android 0.8 会话归档接缝审计

2026-10-17，本轮先做 UI，用户要求未来直接复用电脑算法；本任务只读审计冻结资产和源码，不修改后端、数据、vendor、版本或设备。结论：**本轮不启用归档**。冻结 ui18 worker 不支持 `set-state`，不能仅补 Android 包装层按钮使其成为可靠功能。

## 实际来源与限制

Android `android/telegram-adapter/build.mjs` 复用 `outputs/desktop-maintenance/releases/2026-10-17T18-38-43-932Z-3b4b2c77/app`，消息单独存于 `shiye-android-telegram-v2`。其 `worker-DVw1Ca6d.js.map` 内精确 `shiyeLocal.ts` 源码 SHA-256 是 `e46a567b545419a4d0928525a377f05deb8311985c842f23f94f4881d1728c86`，没有 `set-state` 白名单或处理分支，也没有 `localWriteRevision` 并发保护。未识别命令直接返回，不会产生 ACK；现有 Android `command()` 会在 12 秒后超时。

已验桌面 ui25 的来源是 `outputs/2026-10-17-room-management/candidate-ui25-accessible/app`。其 `worker-DVBOlheC.js.map` 内 `shiyeLocal.ts` SHA-256 为 `38a3755bce5299097f0caadd914795f9d55f4ecb4453bae88a69fb777372b4f9`。该实现完整持有 worker 内的 `client.mockData`、`decode/encode`、`migrateLocalRooms`、`saveLocalPreview`、`localWriteRevision` 和写入队列，归档/恢复移动原 dialog，保存并解决并发写入后才返回 `{requestId,id,rooms}`。发送拒绝已归档会话，草稿定位兼容归档 dialog；这些保护同属桌面实现。

当前 vendor 本地源码存在同类实现，但仍有其他会话改动，不能把当前工作树当作已验冻结源码。ui25 源码较 ui18 还包含其他历史功能；替换整个压缩 worker 会引入额外能力和依赖变化，不能作为此次局部 UI 修改的无风险接缝。仅抽取 `set-state` 函数也无法保留其写入版本、草稿和发送保护；在包装层直接写 IDB 会另造写入路径，违反共用算法与数据边界。

## UI 与后续接入

本轮归档入口应禁用，并直接说明“归档等待接入电脑共用会话能力”。不要发送当前 worker 不支持的命令，不以仅隐藏列表行冒充归档；既有置顶保持原有实现，本审计未将其迁移到新的存储字段。

后续先固化电脑共用 worker 模块与能力版本，再由受控构建输出手机资产，保持相同 `set-state` ACK、活跃/归档列表分区及原 ID/消息/草稿不变。核心验收至少覆盖归档/恢复重开、保存失败不确认、并发发送/草稿不覆盖，以及归档房间禁止发送；这一步需要明确的 worker 构建与数据能力接入任务，不能默认为本轮 UI 工作已完成。

## 证据与产物

- 机器可读来源摘要：`outputs/2026-10-17-android-chat-ui-08/archive/source-audit.json`，含两个冻结 sourcemap 的 SHA-256 和各模块 SHA-256。
- 临时精确源码摘出：`tmp/android-chat-ui-08/archive/ui18-{shiyeLocal,MockClient}.ts` 与 `ui25-{shiyeLocal,MockClient}.ts`，仅用于本次对比。
- 本轮没有修改构建脚本、GPL 资产或许可证；现有构建仍保留 Telegram GPL 正文、来源 archive 和对应 sourcemap，不产生无来源新 worker。
- 验证限于真实冻结 sourcemap 与当前调用链静态审计；未运行 AVD/手机、未发归档命令、未写任何用户库、未替换或重编 worker。
