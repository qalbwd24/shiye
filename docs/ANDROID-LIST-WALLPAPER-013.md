# Android 0.13 思绪列表独立背景

2026-10-18。本子任务只改 `DiaryAppearance.java`、`DiaryListPage.java`，新增 `NativeWallpaperDrawable.java`。MainActivity入口/207回调、AppSettings入口及全局主题由根会话和对应代理集成；没有操作设备、系统文件选择器或正式数据。

## 行为与保存范围

原 `new DiaryAppearance(host)` 继续使用写作scope：`android-diary-appearance-v1`、私有`appearance/`、`/appearance/`、PICK204。新增 `new DiaryAppearance(host,true)` 使用 `android-diary-list-appearance-v1`、私有`appearance-list/`、`/appearance-list/`、PICK207。两者都由同一设置实现管理，互不迁移或覆盖；fileForPath按自身前缀/安全文件名验证，draft导入回收也限定自身私有目录。

列表设置标题“思绪列表背景”，预览直达缓存DiaryListPage.applyAppearance；取消/关闭恢复已保存配置。保存使用私有preferences的异步commit回执，不写内容Entry/media，不将仅预览当保存成功。更换或取消仅处理本次新导入草稿，不清理旧正式原图。

主题由全局appTheme提供。current与preview在配置副本上覆盖theme，持久旧theme字段保留；构造时global未就绪继续原值。设置不再出现逐页主题选择，只提示跟随全局；独立壁纸仍可选无膜/浅膜/深膜。无膜不额外强制白色遮罩。

## 原生显示

NativeWallpaperDrawable仅绘制背景：天空渐变/纯色、自选Bitmap、cover/contain/tile、center/top/bottom/left/right、透明度、独立浅/深遮罩。透明度只影响bitmap Paint，不对页面或文字setAlpha。列表ListView/cache透明，搜索/分类/日记行采用半透明读板，置顶加深；深色白字和次级文字一起适配。点击、筛选、置顶、滚动锚点和正文数据写口沿原代码。

原图在h.io线程按最长边最多2048px采样解码；当前源bitmap缓存，opacity/fill/position/veil连续预览不会反复解码。相同在途源合并，回调检查最新需要的文件，取消/切源后迟到图片不覆盖当前选择。失败或内存不足保留原文件并显示安全底色。当前GIF壁纸使用Bitmap首帧，未实现动画；列表分支不展示模糊控件，写作已有blur保留。

## 验证与交接

实际NativeWallpaperDrawable.draw使用记录式graphics stub运行10项几何/绘制合同断言：cover中心裁切、contain底部完整显示、左右锚点、tile重复与偏移、50%/0%/NaN透明度、无膜、浅/深膜及深色底。此为实际draw代码控制流/绘制参数测试，不是Android像素渲染。

全Java通过Android36 SDK javac；由于并行主题新资源尚未更新共享R.jar，最终独立编译使用从实际styles.xml名字生成的临时R常量stub。未构建APK或证明aapt/安装成功。早期共享R.jar编译失败保留在javac.log：AppThemeDark未生成，以及当时并行TelegramFrontend.applyAppTheme未落地；后者落地后最终javac-resource-stubs.log退出0，仅source8引导路径/弃用提示。正式资源编译与AVD像素/保存重开/取消/大图/真实picker由根会话接续，不能把此回执当这些已通过。

冻结源码SHA-256：

| 文件                         | SHA-256                                                            |
| ---------------------------- | ------------------------------------------------------------------ |
| DiaryAppearance.java         | `73a98aa46124a7207b986c405ca948e1f3db7738b5783bb471686bd1086a6604` |
| DiaryListPage.java           | `63c40c4a4c757cb406ce440841f649d0933cafa9a17e6f50eb015b09a2269917` |
| NativeWallpaperDrawable.java | `8d58e254d5c144b17eb7c2e679522a00e8f3dcb088e4dab335140006166a72c8` |

产物 `outputs/2026-10-18-android-compact-013/list-wallpaper/`（drawable-contract.json、javac.log、javac-resource-stubs.log）。临时脚本/记录式stub/编译classes/R常量stub在 `tmp/android-compact-013/list-wallpaper/`。本子任务未生成设备截图。

## 追加：原生遮罩与写作页精确对齐

根会话复核指出初次原生veil使用0.65 alpha，与当前editor.css不一致。本增量仅改NativeWallpaperDrawable的两个可选遮罩常量：浅膜CSS `#ffffff38` 对应Android ARGB `0x38ffffff`，深膜CSS `#08131d66` 对应 `0x6608131d`。无膜逻辑与原图/透明度/其他两个Java文件保持。更新记录Canvas断言的精确颜色后10项再次通过，实际draw源码新SHA-256为 `cfa6eb95a8a8b2843ba1cd27493c23e9c527d34bc7c2aa5f2287cebdde9f04bd`，覆盖上表NativeWallpaperDrawable初次hash。

drawable-contract.json已更新最终hash；该测试同时重新编译实际drawable与记录式graphics stub，不是Android像素/全包资源构建或设备证明。未操作AVD/手机；正式统一重建和实际截图由根会话继续。

## 用户纠正：连续摘要列表，取消卡片

用户明确要求沿一本日记参考的连续摘要、小字信息、细分割线，否定大块圆角卡片。本增量只改DiaryListPage视觉：普通条目完全透明；月份/置顶heading取消整块背景；置顶只保留约8%alpha的平面色调与原有小字“置顶”，无圆角卡片。已有页面左右20dp边距保留，words取消内层12dp横向留白，纵向15dp；标题15sp、摘要14sp/最多4行、meta11sp及原字段保留，分割线改0.5dp/至少1物理像素。

原生壁纸绘制、独立scope、全局主题、稳定身份、元数据解释、排序、点击/长按、保存和滚动路径均未改。上文半透明“日记行读板”的早期设计由此次用户要求覆盖，搜索栏/分类控件不在此次改动范围。DiaryListPage最终SHA-256 `1ec4f551bf8c1a99a305824392758b156b8721ac4de8dbd1ac48b89a57c7f3e2`，替代上表初次hash。

本次只做源码局部复核，没有造布局镜像测试、没有操作AVD/手机或写入正式数据。最终源码编译与实际布局截图由根会话统一验证，不能复用上文旧圆角行的截图作为此次布局验收。
