# Magic7 覆盖安装 Android 019

2026-10-19，用户“帮我下载过去吧检测看看”授权覆盖安装和界面检查；沿用保留手机数据要求。本轮不构建新APK，不修改桌面运行版/正式库或手机壁纸偏好，不发送测试消息。

- 实际设备：荣耀 Magic7，ADB指定<测试手机序列号>，正常包dev.shiye.app。
- 安装前0.18.0-qq-rebuild/code20。通过现有QQ source的flush确认草稿保存后停止App，保存完整私有tar备份，包括files、databases、shared_prefs、app_webview、no_backup。
- 备份：`var/android-backups/2026-10-19-magic7-before-019-084555Z/private.tar`，64,824,832 bytes，SHA-256 `d038ceb248d737e22fb43b12710a81e48c8d4bb14d141346da45cb4f536e1a79`。前后文件hash清单保存在同一私有目录；没有导出正文到聊天或公开验收JSON。
- APK：`outputs/2026-10-19-android-integration-019/Shiye-Android-0.19.0-d9a256d0.apk`，SHA-256 `d9a256d01080f6ae6b788895ba0e6d0f97c50258948fc6da14358fbb270a3104`。先核SHA，再`adb install -r`，返回Success。
- 安装后首次启动前，files/databases/shared_prefs/no_backup的30个持久文件与备份逐个SHA一致，无差异；没有卸载、清数据、导入模拟器测试资料或替换整SQLite。此证据不冒称启动后缓存/迁移表所有字节永远不变。
- 安装回读0.19.0-ui-product/code21，ADB启动Status ok，冷启动回执478ms；不是页面完整渲染或交互耗时指标。

## 手机实际检查

资产守卫019、QQ/原生偏好均ready，没有实时样式注入；实际第一会话QQ渲染6个消息节点、无错误，旧MiddleColumn隐藏，消息气泡右边界都在可见宽度内。iframe/壳/顶栏/消息区/输入区均320CSS px，原0.18宽度被撑至约455px的故障在本次手机回读中已修复。

检查时用户手机已在会话内，缓存会话列表移到x=-320为隐藏状态；只验证行宽320，不把隐藏状态的偏移当作列表留白，也不冒称本轮额外验证了手机可见列表贴边。模拟器可见列表x0/320的证据按最终同包复用。未发消息、改正文/草稿、调整字号/壁纸或启用同步。手机中文输入、连续发送后的键盘保持、滚动/长按/所有日记操作和120Hz动效由后续实际使用继续验；先前模拟器/Chromium相关证据仍分别标明范围。

原始安全回执：`outputs/2026-10-19-android-integration-019/phone-install/{save,installation,smoke}.json`；临时脚本`tmp/android-integration-019/phone-{flush,install,smoke}.*`。旧只读脚本曾复用018命名的输出，当前019回读已重命名为phone-install下的019状态，原018故障几何独立保留。

本轮APK仍有 [019后端边界](../ANDROID-019-PRODUCT-CHAT.md)：默认聊天legacy owner，完整迁移、seed、持续同步与朝花夕拾真实收件/评论入口未随安装启用。
