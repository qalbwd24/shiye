# Android 0.14 本地表情联想与QQ参考边界

2026-10-18。用户追加：参考QQ表情管理/推送路径，收藏时可附文字说明或注释，输入文本时推荐几个候选表情。本子任务只新增本地索引/独立Android候选模块/独立CSS和测试；收藏说明继续使用已确认name/note字段，不新增消息正文或后端schema。根会话负责打包装配、APK与AVD，手机未由本子任务操作。

## QQ已有证据和不能据此推出的内容

先只读检查了既有 `outputs/2026-10-17-android-mt-qq-reference/`。qq-ui-mapping.json明确QQ9.3.70/code16410、静态只读、范围为会话列表与页面/系统栏；已存RecentAdapter的getView/长按/菜单关闭窗口，以及QQNT输入类列表和AIO面板类列表。qqnt-input-classes只返回12类，包含InputAt/InputSetting接口；aio-panel-classes只有PanelIconLinearLayout与ChatPanelBarLinearLayout两类。它们证明当次保存了这些UI入口，**没有证明QQ收藏管理数据结构、文字推荐索引、候选排序或服务器推送算法**。这不是已完整检查QQ表情相关DEX；空检索也不能证明QQ没有该功能。

官方主源交叉核对：

- [Tencent Cloud自定义表情接入文档](https://www.tencentcloud.com/document/product/1047/52227)公开描述小图表情以本机资源名匹配，大图资源以配置路径/资源表关联，允许配置表情集合。这是其公开Chat UI Kit实现合同，不能当作消费版QQ推荐服务器的源码或算法。
- [Tencent ISUX的QQ超清表情技术说明](https://isux.tencent.com/articles/HD_QQ_emoticon_lottie_design.html)介绍QQ表情视觉/动画及消息格式兼容取舍。它支持把资源/渲染/消息兼容分开考虑，但未给出收藏关键词索引、用户推荐模型或服务推送实现。

因此本轮没有调用QQ私人接口、读取QQ账号/聊天、控制手机或MT实时选择，也未声称得到QQ服务器推荐算法。将“资源库＋文字关联索引＋候选UI＋原消息发送链路分离”用于拾页，是本项目的工程选择；不能写成逆向还原QQ。当前也没有新增QQ式服务器资源推送/商城/远端推荐服务。

## 拾页已实现的本地路径

`public/shared/sticker-suggestions.js`构建一次metadata倒排索引：收藏name、已有note、kind=sticker快捷alias关联到稳定本地assetId。NFKC/Unicode大小写归一化，中日韩汉字段落生成单字/双字key，英文等词生成有限前缀。输入时仅查命中postings并排名，不重新列资产库或扫描全部收藏；长草稿只处理末尾有限文本。alias权重高于name，高于note，稳定ID打破同分，最多5个实际候选（不足3个不编造补齐）。

匹配是本机文字相关，不是情绪/语义理解：例如note含“睡觉”，输入“我要睡觉啦”可以命中；否定、讽刺和上下文含义未做模型判断。用户可以通过已支持的名称/备注/快捷alias改变可匹配文字。note仍是后台最多2000 UTF-16码元的收藏备注，不附到消息caption或评论。未实现OCR或分析图片像素来推断含义。

只索引有本机非空原Blob、允许图片MIME且≤64MiB、未removed的sticker项。纯远端目录占位、尚无本机原件、未知格式、空文件、超限旧项不会因为打字而被下载或推荐；原项/文件继续保留在库中。候选查询没有fetch、服务调用或正文外发，不调用AI/API。

独立 `android/telegram-adapter/android-sticker-suggestions.js`：

1. 等已有shiyeLocalAssets/shiyeStickers可用后安装；输入150ms debounce，首次/收藏或alias变化时重建缓存。只观察既有资产put/saveMapping/remove的成功ACK与已存在更新事件，保持原函数返回值/失败语义，失败不标索引已更新。previewBlob写入若metadata没有变化不会重建索引。destroy可移除监听/恢复自身wrapper。
2. 读取当前真实编辑器文本；IME compositionstart立即隐藏，组词期间不展示/不发送，compositionend后重新防抖。遇原斜杠命令、dialog/原命令面板时不争用。没有keydown/Enter拦截，原输入回车行为保持。
3. 用独立fixed浮层放在Composer上方，最多5个可点预览，不改输入DOM、消息列表高度或滚动位置；独立CSS使用现有主题tokens，文字保持不透明。pointerdown保留编辑器焦点，不引入全页缩放或消息动画。
4. 点击重新核验原asset，复用shiyeStickers.materialize原件，确认当前input/房间未变化，再通过shiye-editor-request取得的sendSticker发送。File携带既有shiyeOriginalSticker标记，空caption、原字节、现有引用/草稿沿原发送管线；等待实际本地持久ACK后关闭候选。同一发送期间按钮禁用，失败保留候选/错误信息并可点同项重试，不显示假成功。

## 打包装配约定

根会话装配：将shared索引复制到 `assets/telegram/shared/sticker-suggestions.js`，Android模块使用精确相对import `./shared/sticker-suggestions.js`，不越出/telegram访问/public。另复制独立JS/CSS，index通过module script与link加载，并依项目精确importmap版本化缓存。模块不依赖网络后端或shiyeNative联网成功才能建立本地索引；若素材/收藏模块尚未ready，最多等待约30秒，不无限后台轮询。

没有修改android-chat.js、共享shiye-input.js、shiye-stickers.js、旧android-chat.css或Java。原件收藏/上传/备注管理由父任务及相关代理维护，本模块复用它们的真实ACK和身份，不承担远端同步权威。

## 已验证和未验证

5项Node合成测试通过：中文短词/整句/alias、全角/大小写/组合Unicode、removed/无本机原件/空/错MIME/超限过滤、alias/name/note排序与稳定前5及查询不再读取原metadata、编辑/移除后的新索引。样本均为合成资料。

真实移动Chrome320px、实际TL完整构建/worker与本地IndexedDB，13项浏览器定向通过，pageerror为空：真实收藏素材→五候选；浮层不改变Composer高度；IME立即隐藏/组词不重开；Enter未选择候选；点选经过真实sendSticker的空caption媒体本地ACK且输入草稿保持；原引用目标身份保持；metadata/alias成功写回后刷新索引；removed成功写回后不再显示；读取失败保留候选可重试，恢复后实际ACK成功。原Tiptap会为自己的换行处理preventDefault，本模块没有新增Enter监听；不能把该上游行为误算为候选截键。

已查看 `candidates-320.png` 与 `retry-320.png`。测试用013完整依赖，路由精确覆盖当前014相关源码与本模块；所有具体override与源码hash见browser-report.json。未宣称APK已装配/AVD/手机/真实输入法或物理触摸已验；跨房准备迟到由本模块身份检查及既有sendSticker拒绝，完整设备切房压力测试由根接续。未测物理帧率、长期后台或QQ推送。

最终源码SHA-256：

| 文件 | SHA-256 |
| --- | --- |
| public/shared/sticker-suggestions.js | `83d4b987ff5b028d427078e65d2674a0293ee632cb780db8299a56a5ee1bb043` |
| android/telegram-adapter/android-sticker-suggestions.js | `362967655e4f07397a7cd6290b53483b9b94259ec7c54a935431d9f258db5d1b` |
| android/telegram-adapter/android-sticker-suggestions.css | `93691a109722f51057eeaeaf7030f798759dd5ce8adec13a7f8313e9a553739e` |
| tests/sticker-suggestions.test.mjs | `842423b00d0129d5e615e1d876629781db97fb00a2ec45fe19755d9dca402fdf` |

专属ESLint/Prettier通过。产物 `outputs/2026-10-18-android-media-014/suggestions/`：receipt.json、browser-report.json、candidates-320.png、retry-320.png。早期failure.png属于Enter测试断言误把Tiptap原行为当候选截获的中间失败，不作最终验收图；最终report无failure、13项通过。临时 `tmp/android-media-014/suggestions/verify.mjs`。本轮未操作手机或正式数据。
