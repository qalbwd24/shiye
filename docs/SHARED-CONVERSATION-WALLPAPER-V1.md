# 每会话壁纸共同数据契约（待双方与独立审批）

2026-10-19，依据 Android023 与本会话已获用户确认的行为。后端候选已实现固定业务口/增量和两调用端隔离测试，独立审批待进行，不代表界面已接或可合包。它更新早期“wallpaper 全部本机”的范围：共同图片绑定、每端独立图片及同步开关属于共同业务；显示参数仍属于本端。

用户新增明确回答：关闭同步的独立图片也必须随服务器资料保留，用于换机/重装分别恢复电脑与安卓图片。每个 canonical conversation 的业务字段拟为 `wallpaper:{version:1,revision:0,syncEnabled:true,sharedAssetId:null,independent:{desktop:{revision:0,assetId:null},android:{revision:0,assetId:null}}}`。旧房缺字段按默认值读取，不自动把任何旧本机图片上传或绑定。`syncEnabled` 是本会话的共同开关，不影响其他房；独立图片按稳定端scope desktop/android在同一业务owner持久保存，各自CAS版本，避免不同端修改相互覆盖；关开开关都不删除它们。重新开启仅使用 `sharedAssetId`，绝不将本端独立图自动提升为共享图。

固定 `wallpaper-read` 和 `wallpaper-save` 业务动作复用 shared/v1 command。读取 `{conversationId}` 返回上述完整对象；共享保存 `{conversationId,scope:'shared',expectedRevision,syncEnabled?,sharedAssetId?}`（scope省略默认shared）；独立图保存 `{conversationId,scope:'desktop'|'android',expectedRevision,assetId}`。共享revision与两个independent各自revision分别CAS，不能拿共同增量envelope.revision代替业务域revision。外层稳定operationId，明确修改共享图时才传sharedAssetId（null明确清除）。写入原JSON conversationServices.wallpapers并以单独wallpaper实体进入增量，旧conversation/state不覆盖此域。并发不符409保留选择；同op重放最小回执不重绑。只开关的保存不得携带sharedAssetId；两项同时改仅用于明确选择并保存共享图片。

共享图片必须先通过同库媒体口得到持久原件ACK，assetId/SHA/size/type有效且是图片；之后才提交绑定并等待绑定ACK显示保存成功。媒体ACK只代表原件到库，不代表壁纸绑定完成。缺原件或绑定失败保留选图草稿和旧绑定，不能用本地路径/blob URL/缩略图作共同身份。缺图片的另一端显示可恢复状态，不回写旧背景。原件由媒体固定读口/哈希校验获取，不能因改变壁纸删除被其他消息/房间引用的资源。

本端显示记录拟 `wallpaperDisplay[conversationId] = {position,zoom,maskOpacity,...}`，它按库+会话+本机安装身份保存，不进入共同wallpaper业务。手机默认cover并保持比例，IME不触发重新裁切，位置/缩放/遮罩不串端。独立图片引用为上面的服务器独立域；即使复用已上传assetId，开关操作也不修改sharedAssetId。旧本机独立图保留，待显式上传/映射，不因共同域缺图自动清除。

缺图规则：旧desktop wallpaperAssetId/Android roomBackgrounds保留。目标域revision0且未选择过服务器图时，前端可只读显示本机旧图并标明待映射，不写回服务器；服务端明确清除后的null不回退复活旧图。共享开关开而sharedAssetId为空，显示无共享图片；已有绑定但原件暂缺则可恢复占位，不能自动换绑旧图。迁移须先上传/去重取得稳定asset，再绑定ACK，不按同名/路径猜身份，不把显示参数迁入共同域。

候选实现：src/server/conversation-services/wallpaper.mjs；公共shared-wallpaper-client（save强制显式业务expectedRevision、返回pending/ack状态），Android runtime.wallpaper已暴露。服务端做原件SHA/size/MIME+文件头预检，不等于完整像素解码；显示端仍负责解码失败恢复。tests/shared-wallpaper.test.mjs两真实HTTP调用端通过共享/独立切换、重开恢复、异房隔离、各端CAS、同op丢ACK重放不覆盖后来图、缺/坏原件拒绝及旧state保存保持。前端真实解码/旧图映射/键盘及独立G2/G3/G8仍未验，禁止据接口测试称手机已完成。
