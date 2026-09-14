# 新增视频压缩

2026-09-14。本模块仅处理用户新添加的视频，不扫描或自动改写旧库附件。

## 页面与接口

设置 → 数据与备份 → 新增媒体的画质与大小，选择均衡、清晰或原件。偏好存于当前浏览器 `shiye.media-quality`（`balanced` / `high` / `original`，默认均衡），只影响之后添加的媒体。

- `POST /api/media-compression-upload?quality=balanced|high`：视频原始请求体，沿用 `X-File-Name`、`X-File-Last-Modified` 和视频 MIME。分块写入 `data/media-staging`，不把视频整体放入内存。返回 202 `{id,state,progress}`。
- `GET /api/media-compression/:id`：状态 queued / processing / done / error。成功带 media；失败带 error。原件方式直接使用既有 `/api/media`。
- 后台任务串行执行；完成只登记较小的成品。转码结果没有变小，则原样登记上传输入并返回 reason。任务自己产生的暂存文件在成功或失败后清理，用户磁盘上的原始 File 不受影响。
- 同源文件、同质量优先复用已有压缩媒体；最终按 SHA-256、大小和 MIME 去重。新媒体保留 originalName、originalSize、originalSha256、compressionQuality、compressed，以及文件时间和可读取的 creationTime。
- 转码失败不登记损坏媒体；客户端可保留 File 重试或切换原件。状态存于进程内，服务重启后需重新上传；若处理期间整个进程被强制终止，可能留下未登记暂存文件，不能把它们当成已保存日记附件。

## 转码参数与保留边界

均衡：长边最多 1280、CRF 26、AAC 128k。清晰：长边最多 1920、CRF 23、AAC 192k。使用 H.264/libx264、MP4、veryfast、yuv420p；不放大小画面，不主动降低帧率，保留音频轨。写入兼容元数据与可解析 creation_time；容器无法表达的厂商私有元数据不承诺逐字段保留。HDR（PQ/HLG）目前要求选择原件，避免缺少色调映射时改变色彩。

参数依据为 [FFmpeg 官方命令说明](https://ffmpeg.org/ffmpeg.html)、[官方过滤器说明](https://ffmpeg.org/ffmpeg-filters.html) 和 [官方编码器说明](https://ffmpeg.org/ffmpeg-codecs.html)。CRF 控制质量，实际体积取决于内容；程序以实际产物大小选择是否保留转码结果，不承诺固定压缩率。

## 外部运行时

使用本机已存在并实际检查过的 Gyan WinGet FFmpeg 9.0 full build（libx264 与 AAC 可用），不是随应用源码提供的二进制：

`C:\Users\微霖\AppData\Local\Microsoft\WinGet\Packages\Gyan.FFmpeg_Microsoft.Winget.Source_8wekyb3d8bbwe\ffmpeg-9.0-full_build\bin\ffmpeg.exe`

FFprobe 位于同目录。可通过绝对路径环境变量 `SHIYE_FFMPEG_PATH`、`SHIYE_FFPROBE_PATH` 覆盖；不依赖 PATH，也不自动下载安装。缺失工具时应选原件。该已安装构建启用了 GPL/version3，源码交付不包含 FFmpeg；重新分发运行时需另行处理其许可证。

## 已执行验证

`tests/video-compression.test.mjs` 用合成视频验证通过：

1. 1600×900 视频压至长边不超过 1280，保留 12fps、AAC 音频、2001-02-03 creation_time 和上传文件 lastModified；仅登记一个较小文件，同源重复上传复用 ID，源测试文件字节不变。
2. 损坏视频失败，未登记媒体，任务暂存清空；无效质量请求被拒绝。
3. 极小视频转码变大时保留原上传字节，暂存清空。

测试没有使用真实日记或用户视频。缺少外部工具的机器会明确跳过编码测试；此机器三项实际编码测试已全部执行通过。大文件耗时、手机 HDR、长视频及客户端真实UI需独立验收，不能由一秒合成样本推断。
