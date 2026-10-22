# 完整资料包独立 Android data QA 候选

2026-10-19：只完成候选构建/冻结，等待Sol高组合窄审；未启动5582、未安装APK、未读取/传入真实整包、未连接后端或正式18765。

冻结目录：`outputs/2026-10-19-full-seed-data-qa/candidate-1792451236003`。最终`candidate-manifest.json` SHA256 `c623cef5662d8fb5b24636789c861c267f20c57e28265673674175129ff43cbc`，36项交付artifact，另以`input-manifest.json`封闭11,824项stage输入。独立入口与完整runbook见同目录`HANDOFF.md`。

独有package `dev.shiye.dataqa.fullseed`，code1/name`0.1.0-fullseed-dataqa-ddc74`；APK SHA `a793ddbd18b575800416c137c81e2af9c12686a2d70292c7fc0febaca76cc394`，92,422,309 bytes；QA证书SHA `24e2b783a4e9a1f574e6403734be6aeefc9b702db5aaba0106828c502899dfe6`，与普通包分离。DEX逐项SHA及asset等值证明在`apk-inspection.json`。

精确来源：已审Android import UI v3.1/c7659fe冻结46原生类与两UI JS，叠已审client66/ddc740ab的Android bundle/22Java（含knownrefs/localfirst/HLC桥），完整support assets仅从已交付普通测试APK f42a321552fc只读解包。未抓live MainActivity/TelegramFrontend/023，未采用未审v3.2。新增仅独立QA manifest/minimal res/loopback network resource、永久禁网络同步的同shared IDB数据页及外部测试driver。所有来源逐文件记录，普通APK和旧guard未改。

隔离Gradle工程Java17/AGP8.13.2/Gradle8.13离线实际编译成功，46Java、11,775最终assets全量封闭校验。真实Chrome DOM5项覆盖实际导入UI选择按钮→固定native choose取消与无激活库拒QA；picker native源链编译入DEX。另8项真实Chrome IndexedDB合成Entry覆盖完整HTML正文追加、草稿及固定operationId持久、reload+重建runtime的原pending wire相同、未知字段/已有草稿保护、未知richdoc明确blocked，网络0。不是Android系统picker/3.33GB验证。driver12项mock守卫通过，无ADB调用。

QA页仅按实体类型盘点全量持久计数、按40项分页/按需读正文与256KiB原件块；HTML普通Entry可追加<=4096转义纯文字，先同库sidecar存完整草稿+op，再仅本机提交，冷开同op回读。Markdown/richdoc/chat/hidden/deleted/draft及已有用户草稿保护；保原字段/附件。不存在通用新编辑器或第二业务库。Product原生日记主页仍未接shared，不能称整页可用。

新driver只有独立5582固定目标，复用原marker/SDK/qemu/PID/唯一AVD/端口严格验证，校验APK+证书+候选SHA及独审私有marker；唯一install尝试先durable消费、无-r/重装/循环/超时重试。默认/真机/5554/5580/任意adb/正式18765均拒。无启动AVD或后端命令。启动资源门槛D>=96GiB、物理>=3GiB、提交>=4.5GiB，真实包传入前/data>=24GiB且>=4x包+2GiB预算；取消/清理大规模待真实包另验。候选资源只读检查达到门槛但后续须重核。

真实包locator未放入public交付；后续截图/正文/XML只准私有QA目录。真实离线导入/指纹pin/冷开/正文与原件/孤立clone续同步均未验。QA修改绝不得写正式18765；以后只用保真实身份/key/receipt的稳定私有clone独立dataDir/port/凭据，当前QA页永久禁sync，driver无配对或同步动作，需后继窄审才接clone。

## 独审新增实际包绑定反例：driver-only v2待复审

c623组合的APK/asset/DEX、QA DOM正文及原12+独立3安装守卫证据保留；原driver存在“candidate/APK审批不能限定实际seed”反例，旧版本不得执行真实包操作。独立失败原日志`outputs/2026-10-19-shared-business-independent-review/fullseed-seed-approval-before.log`不改。

仅driver/fixtures/runbook新冻：`outputs/2026-10-19-full-seed-data-qa/driver-seedbound-1792453032478`，manifest SHA `d761e0e18897b4e5c49148530a65e7c51cd476665a0e67404482d8bdcdf8ac84`，13项artifact；APK仍a793ddbd…cc394，数据页/签名/DEX/asset完全不变。其base-reference锚住原c623来源和stage，未重编/重跑无关场景。

新approval须含私有approvedSeed七字段path/bytes/sha256/libraryId/epoch/packageId/keyFingerprintSha256；seed-input逐字段严格相等，固定绝对路径实文件全SHA/长度且hash期间未变。push/select/confirm/两cold-open在任何ADB/inspect/installed/预约之前校验；缺字段/换任一身份或路径/字节均拒，不触发安装/消费重试。保留原privateState/candidateId，绝不因driver换冻另开install预算。AST证实仅approval、seed_binding、push_seed、ui_step四函数变化＋一个validator/字段常量，其余17函数与原常量保持，原12+3同scope证据复用。

新7项synthetic定向通过，包括原换SHA/library反例、七字段×五动作ADB前拒、缺字段/未批/坏schema、实际文件篡改/丢失与hash中改变；证据同目录seed-approval-tests.log/driver-scope.json。真实绑定仅在固定私有状态seed-input与approved=false的approval.pending.json准备，未创建/授予approval.json，公开outputs不含真实IDs/指纹/源文件名。准备只读有界manifest头、复用owner全包校验回执，未另扫全包。待同一Sol高复审及root统一授权，仍未启动5582/安装/传包/访问正式API。

## 首次5582执行遇安装前pm absent返回值阻断（未安装）

root统一授权后fresh资源D333425090560/physical8071778304/commit21658951680、原marker/无冲突核过，沿原hidden wrapper启动唯一5582；实际SDK/qemu/AVD/port/boot及/data inspect成功。随后install-once在查询未安装包的固定pm path时返回exit1，被旧check_output作为异常阻断，发生在durable install预约及唯一install ADB之前。私有initial-inspect/install-command.err等原始证据保留，install-attempt.json和install-result.json均不存在，未装/未传包/未开页面/无正式API或CDP forward。未自动重试；已用原stop.py核身份正常关停自有5582并确认PID退出，其他实例未操作。

最小driver-only候选`outputs/2026-10-19-full-seed-data-qa/driver-pm-absent-1792453548902`，manifest SHA `2e373f891c337babfe5bb0e91664b99945d558a92220f7451b1f83143b37ddab`。仅adb函数对exact QA pm path新增严格分类：exit1+stdout/stderr均空才absent；现包/其它exit/错误文本仍拒、无新增命令/目标。APK a793/seed binding/预算预约与其余21函数不变。4个新mock定向反例通过，原driver异常仍可复现；复用既有同scope12+3+7，不重跑全套或把fixture重试称实装。私有新pending审批false，原approval未改，需Sol高窄审/root继续授权后才可重新进入**尚未执行的第一次install调用**；不是已失败install的重装重试。真实离线首导/原件/正文冷开均仍未到达。

## 唯一真实安装调用已消费；只读恢复候选待审

pm窄修独审/root续授权后fresh资源D333279842304/physical8319758336/commit21508501504，唯一wrapper重开同userdata5582，实际inspect通过。唯一真实install ADB随后以exit0返回，但旧driver要求返回文本严格等于Success而报失败；原代码未持久保存该stdout，实际文本/前缀未知，不推断。install-attempt.json已存在，install-result.success=false原样保留，安装预算已消费，不得再次install/clear/删除台账。尚未核实际已装包身份，未传seed/launch/导入/原件/正文/正式操作。已原stop.py正常关停owned5582并核PID退出，其它设备未操作。

root同意仅只读取证。新freeze `outputs/2026-10-19-full-seed-data-qa/driver-install-readonly-1792454065999`，manifest `0b7cf9bffae8987c9e343d809ed716b03f71ec7c8a9615e5a6f3af5106e4c272`（14artifact）；APK a793不变、adb/install_once及其余20原函数同AST，只有installed/main接新verify-install-readonly+三个helper。新action须原attempt+false result同scope/预算；fresh owned guard后仅pm唯一base路径、固定pull完整SHA、实际pulled APK apksigner单证书与aapt包/版本、native locator核验，成功另create-exclusive/fsync验证receipt，绑定原attempt/result全文SHA及installedbase/apk/cert/version，不覆原false结果。installed仅接受原成功链或此精确复核链，并继续核实际包字节。缺包/错包/分包/证书或版本不符/原receipt改变/取证失败均停，永不安装补救。原stdout未保全作为未验边界明确保留。

新6项mock命令白名单/原失败保留/不存在或坏包/坏原receipt/坏复核链反例通过。最初新fixture漏私有policy导致5项fixture错误，留excerpt和会话原trace；仅修fixture，未放宽生产guard，不称首轮全过。原12+3+7+pm4同scope证据复用。私有approval.install-readonly.pending=false，原approval未改。候选已交同Sol高窄审；复审授权后只能正常重开并执行只读复核，绝不再install-once。真实整包首导仍未开始。
