# 应用图标

0.7.4 使用原创矢量图标：青绿色圆角底、奶白活页纸、浅金色书签。应用图标与用户个人头像独立。

- 可编辑源文件：public/icons/shiye.svg。
- 网页资源：32、64、192、512、1024px PNG 与 SVG。0.7.5 起按目标 DPI 从矢量直接渲染，不放大低分辨率中间图片。
- Windows：shiye-hd.ico 包含 16、20、24、32、40、48、64、96、128、256 像素十档；build-launcher.ps1 通过 /win32icon 嵌入启动器。shiye.ico 保留为相同内容的兼容文件。
- public/index.html 引用 SVG 与 PNG favicon，服务器沿用已有静态文件访问规则。

生成资源：用可用的 sharp 开发依赖运行 node tools/build-icons.mjs。若 sharp 不在项目依赖中，可将 SHIYE_SHARP_MODULE 指向其绝对模块目录；该环境变量只在生成时使用。生成后运行 npm run build:launcher。图标资源已经包含在源码包里，使用应用或重新构建 EXE 不需要安装 sharp。

启动快捷方式的 IconLocation 指向 public/icons/shiye-hd.ico,0。网页 favicon 使用版本查询参数刷新缓存。已打开的独立浏览器窗口可能需要重新打开才能更新 Windows 窗口图标；不要为刷新图标终止用户其他浏览器窗口。
