# 数据模型与兼容规则

## 本地库 schema 1

`data/diary.json` 的顶层为 `schema、entries、media、categories、imports、templates、settings`。存储层保留未知顶层字段。schema 与应用版本不同：应用0.3.0不意味着需要把数据schema改成3。

| 对象            | 主要字段                                                 | 约束                                                   |
| --------------- | -------------------------------------------------------- | ------------------------------------------------------ |
| 日记 Entry      | id、title、content、date、createdAt、updatedAt、revision | id稳定；content是HTML；日期使用可解析的时间字符串      |
| 分类与标签      | category、tags                                           | 分类是名称字符串，标签是去重字符串数组                 |
| 状态            | pinned、deleted、hidden、draft、demo                     | 隐藏／草稿／删除按视图过滤；删除是可恢复状态           |
| Markdown        | markdownSource、markdownHtml                             | HTML仍等于生成时快照才复用源码；直接改富文本后源码失效 |
| 媒体关联        | attachments                                              | 数组元素是media.id；不是路径或文件名                   |
| 编辑历史        | history                                                  | 保存之前的日记快照，最多20项，不递归保存history本身    |
| 原格式信息      | legacy.original、legacy.mediaReferences及其他legacy字段  | 原始未知字段、媒体缺失信息继续保留，不展示不等于可删除 |
| 媒体 Media      | id、name、type、size、sha256（可能有）                   | 实体文件为data/media/id；name只用于展示／下载          |
| 导入原件 Import | id、name、kind、sha256、tables等                         | 实体文件为data/originals/id；按原件哈希判断重复导入    |
| 模板            | id、name、content、category、deleted等                   | 删除标记可恢复；旧模板原字段保留                       |
| 设置            | settings.shortcuts、settings.preferences                 | 偏好与快捷键分别更新，避免互相覆盖                     |

访问锁另存在 `data/access.json`，保存盐和密码派生哈希，不保存明文密码。访问会话只驻留进程内存，重启后可能需要重新解锁。

## 写入与并发

所有数据库写入由 library-store 的 mutate 串行执行。先复制当前库，在副本上修改，写 diary.json.tmp，rename成功后才发布新内存库；回调抛错时不提交。

日记更新携带 revision。后端发现旧revision返回409，前端保留编辑内容供用户处理。不要用“无条件重试覆盖”掩盖冲突。不要在服务运行时外部编辑JSON，它可能被进程中的旧快照覆盖。

## 旧格式映射

Android `createTime` → 新 `date`；`recordTime` → 新 `createdAt`。分类／标签ID映射为名字，原对象同时留在legacy。contentType=1转Markdown HTML；复杂自定义富文本和媒体位置还不是完全一比一。

原始加密字节保存在originals。resources/legacy/backup_reader.py提供既有格式的静态兼容常量；Node仅读取其定义，不执行Python，不向浏览器公开该文件。格式常量不等于用户新备份密码，不应作为日志或文档示例输出。

## 新旧备份协议

- `.syvault`：version 1整包JSON加密，旧容量边界保留。
- `.syvault2`：version 2逐行记录；头、manifest、文件分块、认证结束记录。当前记录压缩标记为gzip-records；旧未压缩v2仍可读取。每个分块有序号，头和序号参与AES-GCM认证。
- 密钥派生与加密参数属于协议，不是可随意调整的性能设置。变化必须有新版本、向后读取分支和错误密码／篡改／截断测试。
- 恢复先暂存并核对每个文件大小与SHA-256，再追加日记；重映射日记与媒体ID，以及历史里的附件引用。不能仅恢复当前正文而丢掉历史关联。
- 恢复默认保留当前偏好和快捷键，不用外部库设置覆盖正在使用的配置。

## 容量与保存边界

上限统一在 public/shared/limits.js。旧格式元数据、完整库JSON和备份manifest仍整体处理；大附件采用流式/分块流程。不能把64GiB ZIP上限理解成任意大小文本库都能运行。

本地库、媒体、开发验收副本都是明文；只有新加密备份和保留的旧加密原件带加密层。本地访问锁不是磁盘加密。

## 将来进行结构迁移

先复制工作库并校验原件，迁移在隔离目录运行；每个版本有明确输入schema、输出schema、默认值与失败回退。验证记录数、ID唯一性、分类、日期、未知字段、媒体哈希和历史关联。全部通过后再切换正式数据位置。当前0.3.0结构整理没有对工作库执行schema迁移。

## 0.5.0 向后兼容扩展

- 顶层可选 tags:string[] 用于保存尚未附到日记上的独立标签；显示与 entries[].tags 取并集。
- media[].purpose=background 标记外观图片；文件仍是 media/id，MIME 按文件签名识别。相册与日记统计仍只计算日记实际引用的媒体。
- settings.preferences.appearance={accent,backgrounds:[{region,id,opacity,fill,position}]}；region 为 app/sidebar/list/editor/topbar，opacity 为 0–1，fill 为 cover/contain/tile，position 为 center/top/bottom/left/right。
- settings.preferences.layout={categories,tags,list}，布尔值 true 表示折叠。兼容读取旧 shiye.collapsed 浏览器偏好，首次切换后保存到库。
- 首次升级复制第四版被引用的 data/backgrounds 图片到 media 并登记引用；旧文件保留，缺失原件不编造。
- .syvault2 仍使用相同加密协议。恢复请求可选 restoreAppearance:true；仅此时恢复 theme、appearance、layout，并映射背景 ID。默认保留当前偏好。旧 .syvault 设置恢复行为不变。
