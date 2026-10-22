# 媒体压缩：一本日记静态证据与拾页实现建议

核对日期：2026-09-14。仅只读查看原 Android 反编译资料、现有项目文件及本机工具版本；没有压缩真实媒体、下载工具、执行旧迁移脚本或修改原件。本文区分原版可见行为与拟议默认值，不能将库的存在等同于功能已经接入。

## 原版证据位置

以下路径以 `F:\<个人目录>\日记软件本地化\research\2026-09-10\android` 为根。`sources/` 是本地 JADX 输出；涉及反编译失败的分支仅作为有限证据。

| 项目                | 文件与行号                                                                    | 可确认内容                                                                                                                                                                          |
| ------------------- | ----------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 普通图片压缩入口    | `sources/o4/c.java:1041–1063`                                                 | 方法 `n(Context,File)` 按后缀跳过 GIF；只有字节数严格大于 307200 且小于 41943040（300 KiB 与 40 MiB）时调用 Luban。先写缓存结果，随后以结果覆盖传入的应用内文件。                   |
| Luban 调用参数      | `sources/o4/c.java:1049`                                                      | `.k(z.h()).j(是否PNG).h(50).i(file).g()`；50 是 KiB 忽略阈值，并非 JPEG 质量。外层 300 KiB 条件比该阈值更严格。                                                                     |
| Luban 大小阈值      | `sources/rd/e.java:67,104–106,141–157`；`sources/rd/EnumC1810.java:198–203`   | builder 默认忽略阈值 100；`.h(n)` 设置该阈值；检查 `file.length() > (n << 10)`。缓存目录名为 `luban_disk_cache`（`rd/e.java:175`），日志标记 Luban（`rd/EnumC1810.java:117–121`）。 |
| Luban 图片采样      | `sources/rd/b.java:39–80`                                                     | 按长短边比例和尺寸分段计算 `inSampleSize`，涉及 1664、4990、10240 和 1280，不是固定缩放为某个长边。                                                                                 |
| Luban 编码质量      | `sources/rd/b.java:91–109`                                                    | 读取图片、处理方向后，调用 `Bitmap.compress(PNG或JPEG,60,输出流)`；JPEG 质量 60。PNG 路径质量参数不能解释为有损 JPEG 的同等比例。                                                   |
| 原图开关            | `sources/o4/h.java:731–732`                                                   | `ori_image_check` 默认为 false。                                                                                                                                                    |
| 开关界面            | `sources/com/chenupt/day/record/RecordActivity.java:3620–3629,3694–3703,3914` | “原图上传”写 true，“压缩上传”写 false；有两种明确选择。                                                                                                                             |
| 同步阶段调用        | `sources/com/chenupt/day/sync/C0770.java:514–518`                             | JADX 恢复片段显示原图开关为 false 时调用 `o4.c.n`。主方法在 1577 行标记未反编译成功，不能声称完整云同步、失败回退和删除优先级已复原。                                               |
| 选择图片后复制      | `sources/com/chenupt/day/record/RecordActivity.java:4956–4970`                | `l2` 为图片建立 UUID 文件名并复制输入流。不能把同步压缩概括成每次选择图片时立即压缩。                                                                                               |
| 日记背景            | `sources/com/chenupt/day/record/RecordActivity.java:1646–1666`                | 背景单独使用 Compressor 参数 1080、1920、JPEG 100，再经过 Luban `.h(50)`；最后拒绝大于 10 MiB 的背景。背景参数不等于普通日记图片默认值。                                            |
| 模板背景            | `sources/com/chenupt/day/setting/RecordModelActivity.java:418`                | 另一背景路径是 Compressor 1080、1920、WebP 70。                                                                                                                                     |
| Compressor 参数含义 | `sources/id/zelory/compressor/Compressor.java:15–24,31–33,46–59`              | 默认宽高参数 612、816，默认 JPEG 80；`.e`、`.d`、`.f` 分别设置尺寸参数与质量。`C1370.java:68–82` 是按 2 的幂次采样，因此传入 1080/1920 也不是承诺精确输出尺寸。                     |
| 视频实际入口        | `sources/com/chenupt/day/record/RecordActivity.java:4993–5004`                | `m2` 建立 UUID 文件名后直接复制字节；该方法没有编码器、码率或帧率设置。                                                                                                             |
| 视频选择上限        | `sources/com/chenupt/day/record/RecordActivity.java:4674`                     | PictureSelector 的选择大小上限有条件地为 524288000 或 2147483647 字节；这是选择限制，不是目标压缩大小。                                                                             |
| 视频库残留          | `sources/com/hw/videoprocessor/VideoProcessor$Processor.java:1–18`            | 只有 Context、布尔字段和构造器；未发现其调用处、编码方法、码率/分辨率/帧率配置。不能据此宣称原版已经实现视频压缩。                                                                  |
| 设置说明            | `resources/res/values-zh-rCN/strings.xml:679–681,771–772,833–836`             | 原版文案说明服务器图片会压缩、可选择原图上传，推荐压缩以节省流量。资源文案只能确认产品意图，不替代代码与设备验证。                                                                  |

Luban 的 JPEG 采样大致按短长边比 `(0.5625,1]` 时：长边小于 1664 使用 1 倍采样；小于 4990 使用 2；大于 4990 且小于 10240 使用 4；其余按长边/1280处理。长条图走另一组比例公式。反编译文本中的整数/浮点类型表达可能有误，尤其不应直接复制表达式为新版算法。PNG 开关也存在边界：builder 有 `.j` 字段，但当前可见 `rd/e` 构造器没有明显将其复制给压缩器字段，因此无法凭这份输出保证原版透明度行为。

## EXIF 与时间保留

原版 Luban 路径只可见方向读取与旋转，随后生成新位图编码（`rd/b.java:96–109`），没有可见的 EXIF 时间字段复制。Compressor 也只读取 `Orientation`（`id/zelory/compressor/C1370.java:42–66`）再压缩写文件（23 行）。不能声称这些路径保留完整 EXIF。

uCrop 裁剪是另一路径：`sources/com/yalantis/ucrop/task/BitmapCropTask.java:100–107` 在 JPEG 裁剪后调用 `ImageHeaderParser.copyExif`。其实现（`sources/com/yalantis/ucrop/util/ImageHeaderParser.java:122–136`）复制 22 个字段，包括 `DateTime`、`DateTimeDigitized`、`SubSecTimeOriginal` 和部分 GPS 字段，并更新宽高和方向；可见名单中**没有 `DateTimeOriginal`**。这也不能成为完整保留拍摄时间的依据。

新版应明确区分以下数据：

| 字段                 | 含义与保存规则                                                                                                                                                                                    |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `lastModified`       | 来源 `File.lastModified` 的毫秒时间；压缩后仍传源文件的值。它是文件修改时间，不等于拍摄时间。当前后端已经支持 `X-File-Last-Modified`。                                                            |
| `importedAt`         | 后端实际首次接收时间；不能用它覆盖来源时间。重复字节复用旧记录时保留旧记录。                                                                                                                      |
| EXIF 拍摄时间        | 优先读取 `DateTimeOriginal`，同时保留 `OffsetTimeOriginal`、`SubSecTimeOriginal`；可补存 `DateTimeDigitized` 等原始字符串，不能用当前时间或文件修改时间补造。                                     |
| 拍摄时间时区         | 没有 offset 的 EXIF 时间是没有时区的相机本地时间；保留原始字符串与“时区未知”状态，不擅自转换为 UTC。                                                                                              |
| `sourceLastModified` | 前端预处理返回源 `File.lastModified`，构造新 File 时也使用源值；这是传输辅助值，可最终落入已有 `media.lastModified`，不必再建立两个含义相同的永久字段。                                           |
| 来源记录（建议）     | 若新增 `source` 或 `compression` 对象，保留源文件名、源字节数、原 MIME、尺寸、算法与参数、是否压缩；原始 SHA-256 只有真正计算后才能登记。现有 `sha256/size/type` 必须继续描述实际保存的输出字节。 |

Canvas `toBlob` 将画布内容重新编码，支持 0–1 的质量参数，并为支持的格式写入 96 dpi 分辨率；该接口没有承诺复制输入文件的 EXIF。不能把“画面方向正确”当作“EXIF 已保留”。见 [MDN toBlob 文档](https://developer.mozilla.org/en-US/docs/Web/API/HTMLCanvasElement/toBlob)。

建议：压缩前读取来源时间；JPEG 输出应将支持的 EXIF 时间字段写回并验证。如果解码已经应用方向，不能原样写回非 1 的 Orientation，否则客户端可能再次旋转。宽高、嵌入缩略图也应与新像素一致。若当前实现不能可靠解析/重写某个文件的 EXIF，直接保留原图并说明跳过原因。仅在数据库旁存拍摄时间可保住应用信息，但不能宣称“下载的压缩文件仍含原 EXIF”。

## 新版合理默认值建议

以下是面向本地日记可读性的拟议参数，**不是原版精确参数**。原版 JPEG 60 偏重节流，文字截图和细节照片宜使用更保守的默认值。

| 模式 |            大小门槛 |  最长边 | JPEG 质量 | 行为                                                       |
| ---- | ------------------: | ------: | --------: | ---------------------------------------------------------- |
| 原图 |                  无 |    不变 |  不重编码 | 字节原样保存，保留格式与元数据。                           |
| 均衡 | 大于 300 KiB 才尝试 | 2048 px |      0.82 | 等比缩小、绝不放大；仅保存确实变小且元数据核对通过的输出。 |
| 清晰 | 大于 300 KiB 才尝试 | 2560 px |      0.90 | 更适合文字、学习记录；仍不放大。                           |

- GIF、检测到的动画 WebP/APNG 保留原件；无法可靠确认动画时保守跳过，避免只留下第一帧。
- 透明 PNG/WebP 默认保留；普通 PNG 文字截图也不宜在首次实现中强制改成 JPEG。
- 首版宜仅压缩可验证的 JPEG；其他格式、过大解码内存、EXIF 无法保全、解码失败或结果变大时回退原件，并给出具体原因。
- 附件顺序与身份保持稳定；压缩是一份新上传文件的预处理，不能通过同名匹配替换历史日记中的图片。
- 验收至少覆盖旋转 JPEG、含拍摄时间及 offset 的 JPEG、无 offset 的 JPEG、透明 PNG、GIF、动画 WebP、小图、大图、压缩后反而增大的图，以及压缩图片随备份往返后仍能读出来源时间。

## 本机视频工具与可行范围

只读确认 PATH 已有以下工具，版本输出均为 `9.0-full_build-www.gyan.dev`：

- `C:\Users\<用户名>\AppData\Local\Microsoft\WinGet\Links\ffmpeg.exe`
- `C:\Users\<用户名>\AppData\Local\Microsoft\WinGet\Links\ffprobe.exe`

链接实际指向 `C:\Users\<用户名>\AppData\Local\Microsoft\WinGet\Packages\Gyan.FFmpeg_Microsoft.Winget.Source_8wekyb3d8bbwe\ffmpeg-9.0-full_build\bin`。`ffmpeg -encoders` 确认具有 `libx264` 与 `aac`。本项目 resources 与 `F:\一本日记虚拟机` 的文件名扫描未发现另外的 ffmpeg/ffprobe；没有下载、复制或安装。此发现仅证明本机工具可用，不能推定别的 Windows 主机或交付包自带工具，也未执行真实视频编码验收。

视频若本轮实现，应作为独立可选功能，默认保留原件；不能用浏览器画布方案处理视频，也不能宣称沿用了原版转码参数。建议先只接受普通 SDR 输入，使用 H.264/AAC、最长边 1280、CRF 23、preset veryfast、AAC 128k、不提高源帧率；HDR、透明视频、未知色彩信息或不支持容器暂保留原件。上述为起步建议，实际大小与速度必须实测，不能保证固定压缩比。

编码前用 ffprobe 记录尺寸、旋转、时长、音轨和时间字段，编码后核对播放、时长与元数据。`-map_metadata 0` 是显式选择元数据来源，不代表任何容器都保留所有私有标签；必要时单独保留源 `creation_time` 原始值和来源文件时间，不把文件系统创建时间当作拍摄时间。见 [FFmpeg 命令文档](https://www.ffmpeg.org/ffmpeg.html)与 [封装格式文档](https://ffmpeg.org/ffmpeg-formats.html)。调用应通过参数数组，使用独立暂存输出；失败或取消保留源文件，禁止对真实原件原地转码。

## 范围与未完成项

本文是证据及实现参考，不是压缩功能验收报告。未运行 Android 设备比较压缩产物，未核验所有被混淆或未反编译成功的同步路径，未实测本机视频转码速度、硬件编码兼容性或所有 EXIF 厂商扩展。新版实现与合成/浏览器验证由对应功能模块另行记录。
