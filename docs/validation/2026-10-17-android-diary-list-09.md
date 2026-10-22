# Android 0.9 思绪列表与页面复用验收

2026-10-18收尾。0.9.0-diary-list/code11，APK `outputs/2026-10-17-android-diary-list-09/Shiye-Android-0.9.0-e0023751.apk`，SHA-256 `e00237515041754101aa1bc1976e5af4e11c7c859392ff8b6ddee6024a2834ea`。保留数据安装主AVD，用户手动打开后验证；已由0.10继续覆盖，不是当前最新包。手机仍0.6/code8。

## 实现与证据

- 思绪改为日期/搜索图标/设置、横向分类、四行正文预览和真实小字信息；连续记录/篇数、置顶优先与加深底色、文字和日期筛选、日期选择及清除、下拉刷新。无重复刷新按钮，不臆造地点/天气。
- SQLite schema2只增pinned，版本保护更新；20项合成真实SQLite与12项列表日期/连续天数定向通过。见 `ANDROID-ENTRY-PIN-09.md`、`ANDROID-DIARY-LIST-09.md`。
- MainActivity复用聊天WebView和兼容分类目录下的原生思绪页；返回先显示本地数据、后台静默刷新，保留筛选/滚动/草稿。9项浏览器resume检查通过，实际切回聊天的performance.timeOrigin不变。
- 输入法出现立即把底栏退出布局，旧位置快照120ms淡出；收起后160ms恢复，快速反向取消旧过渡。真实软件输入法mIsInputViewShown=true时导航隐藏，关闭后恢复，临时show_ime_with_hard_keyboard从0改1后已恢复0。
- 最终AVD15项检查通过，见 `outputs/2026-10-17-android-diary-list-09/avd-ui-verification.json`，截图 `avd-diary-final.png` / `avd-native-search-ime.png`。下拉刷新前后合成置顶行bounds均 `[53,710][1027,1072]`，未把刷新状态插入布局造成跳动。

两次脚本失败保留：第一次程序focus仅请求IME但输入视图没出现，真实点输入框后核实；第二次置顶后仍按未置顶accessibility名称断言，截图实际可见，改用正确名称。不是隐藏失败后把旧测试计为新通过。AVD文件选择器此前出现shell/设备离线，已保留数据重启AVD恢复；系统选择器原件导入/混合视频全链路继续未验，不宣称已定位原因。

## 边界与位置

本轮没有实现云同步/outbox、电脑canonical写入、归档worker；不把本地缓存说成跨设备同步，不保证物理120FPS。0.8的聊天UI证据只按未变资产复用；0.10的存储与编辑适配另验。

安装前备份 `var/android-backups/2026-10-18T04-07-01-avd-before-090/app-private.tar`。产物 `outputs/2026-10-17-android-diary-list-09`，临时 `tmp/android-diary-list-09`。未操作手机或桌面正式数据/运行程序。
