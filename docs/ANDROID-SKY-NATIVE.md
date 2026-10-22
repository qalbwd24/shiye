# Android 思绪独立外观与原生天蓝样式

2026-10-17。实现于0.4.0/code6。主AVD已构建、覆盖安装并启动；此页记录原生部分，界面实测以本轮QA回执为准。手机仍用户手测0.3.0，本轮未操作手机。

## 原生视觉

主色 `#B6DEF0`，正文 `#111827`，次文 `#475569`，强调 `#327DB2`。思绪列表天蓝到浅蓝渐变，保留原月份/搜索/分类/摘要/阅读/继续编辑与返回位置。底栏继续随想/写日记/思绪，浅蓝白底和细分隔，不改三入口、触控尺寸、保存或键盘inset逻辑。随想系统栏使用 `#EAF5FC` 衔接Web A，附件选择面板也统一蓝调。

## 思绪独立壁纸

新增 `DiaryAppearance.java`。在日记更多→思绪外观或思绪列表更多→思绪外观打开；提供天空蓝/无壁纸/选择更换图片、不透明度0–100%、填充cover/contain/tile、居中/上下左右、模糊0–20px。设置只影响思绪写作/阅读，聊天保留独立壁纸机制。

壁纸通过系统文件选择复制到App私有 `files/appearance/<UUID>.<ext>`，只接受可解码PNG/JPEG/WebP/GIF，单文件最大20MiB，不保存外部URI依赖。偏好单独存Activity SharedPreferences `android-diary-appearance-v1`；不进入SQLite Entry/asset、richdoc或消息、导出ZIP，换外观不改变日记内容时钟。

本次设置会话明确创建的新文件有归属清单，失败、取消或未采用的重选文件仅按准确路径回收，不扫目录，不清理旧已保存壁纸、未知文件或备份。导入完成前不允许提交旧草稿偏好；旧会话导入回调不能清掉新会话busy状态。偏好保存使用io线程commit，确认后才提示已保存；取消还原原偏好预览，不重建编辑器。

## 前端桥与资源

- `rpc('getAppearance')`返回既有外观对象：`{backgroundMode:'sky'|'none'|'custom',background:null|{url,fill,position,opacity},blur}`。
- `rpc('showAppearance')`只打开原生设置并回复`{opened:true}`；即时预览与保存/取消调用 `window.shiyeApplyAppearance(value)`，只改变CSS层。
- `/appearance/<UUID>.<ext>`由本App既有固定HTTPS origin路径拦截返回。路径/文件名白名单、媒体解码与大小限制保持，无INTERNET或广泛文件权限新增。
- 时间戳额外3个公共源文件由Gradle原封复制，桌面公共核未修改；Telegram11711资源除适配CSS外11710项与0.3一致。

手机配置同步、跟随电脑所有自定义外观/时区、自动取色、裁剪与完整迁移不是本轮已实现功能。0.4是本地外观/交互预览，不把相似配置字段称为已跨端同步。

来源：[电脑思绪外观](../public/features/quick-appearance.js)、[偏好规范](../public/shared/quick-appearance.js)、[需求](ANDROID-SKY-UI-REQUIREMENTS.md)、[日记页面](ANDROID-SKY-DIARY.md)、[聊天](ANDROID-SKY-CHAT.md)。产物 `outputs/2026-10-17-android-sky-ui/`，临时 `tmp/android-sky-ui/`；私有备份 `var/android-backups/`。
