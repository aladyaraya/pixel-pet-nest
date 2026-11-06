# 最终交付验收

## 2026-11-06 GitHub 源码更新：0.1.1

已按用户“更新 APK”的要求同步 `package.json`、lockfile、应用常量和壳 manifest 为 0.1.1，`versionCode` 从 1 增至 2；包标识仍为 `ai_p_0b48bb06f8c0d4dd`。更新包含读档失败缓存修复、恢复后的生命周期订阅、错误分类及翻面传感器单请求保护。

用户随后确认“更新到 GitHub 上就行”，本次交付范围调整为 `aladyaraya/pixel-pet-nest` 的 main 分支源码、测试和交接文档；不触发平台打包或发布 APK。来源基线为 `9ad557588b4835b8bd59c9ea4d0685b47e235be7`，最终提交以 GitHub 和 `git log -1` 为准。

新版类型检查、客户端构建和 15 项存档／连接单测均通过。客户端 JS／CSS 资源与前述通过 7 项恢复及 2 项后台诊断的最终资源一致；此次改动是版本信息同步。构建目录 `dist/client/` 是供原平台壳打包的文件，**不是 APK**。

当前缺少原平台 APK 构建入口；仓库没有 Android 壳源码、Gradle 工程、GitHub Actions 打包工作流或 GitHub Release APK。原平台专用打包技能／工具在当前会话不可用。现有本地证书为此前生成的调试证书，尚未与手机安装包核对，不能声称可覆盖安装，也不应把它替换到原平台项目。最终打包应沿用原项目身份和签名，并核对平台已发布的 versionCode；若平台版本高于当前仓库记录，需要在平台选择更高的递增值。

此前在本机 `dist/delivery/` 准备的修复源码归档和客户端文件归档不进入 Git，均排除签名私钥及环境文件，不包含可安装 APK。当前交付以 GitHub 源码为准；未上传平台、发布安装包或更改手机应用。

## 2026-11-06 页面重载原因继续排查

用户确认暂时无法取得真机日志，本轮限定代码审查、实际客户端构建包的模拟接口诊断及可复现风险修复。用户没有提供异常发生的精确秒数；下列后台切入时间均为测试选择。

**主动重载路径审查：** 应用业务代码的 `location.reload()` 在 PWA 更新组件内，native 入口不挂载该组件；客户端产物没有 PWA 更新标识、Service Worker 注册或 Vite HMR。产物仍包含 React Router 自带的路由模块动态导入失败刷新分支，不能称为“整个 bundle 没有 reload”；本应用使用 HashRouter 和静态导入的三个页面，没有启用该框架路由加载流程。EggProvider 位于路由外且没有变化的 key，普通换页、阶段推进、背屏失败与内存警告均不主动重建它。当前仓库没有 Android Activity／WebView 宿主源码，不能从这里检查原生的重建或崩溃恢复策略。

**确定风险及修复：** 到期后开启翻面检测时，原有异步 interval 每 400ms 发一次 getSensor，上一条未回执也继续发送。旧生产包故障注入 20 秒得到 50 个并发未完成请求。现增加跨阶段和前后台保持的请求占用标记，只在原 Promise 完成后释放；迟到数据仍受原代次／会话校验保护，不改变传感器接口、翻面判断或手动揭晓入口。这属于已证实的请求堆积风险，但它发生在到期且翻面开启时，尚不能解释用户所述中途重载。

**完整长局检查：** `scripts/diagnose-background-reload.mjs` 通过内存路由加载生产包，先完成 3 颗 10 秒蛋，再运行 3:10 的一局；使用测试时钟 runFor 逐次执行定时器，后台跨过 50%、85% 和到期，注入 9 次 memoryWarning 后恢复并揭晓。脚本不调用 reload。修复前诊断报告在 `.acceptance-final/reload-investigation/report.json`：文档加载与 getStorage 次数始终为 1，无页面异常、后台背屏命令为 0、背屏最大并发为 1，收藏正常增加。单能力 setKeepScreenOn 最大并发为 2，存储写入最大并发为 1。该测试验证 JS 行为，不模拟操作系统真实回收、真实内存压力或马达／驱动行为。

仍有以下待真机检查的开销，未作为重载根因处理：未揭晓局在后台保留 250ms 计时刷新；阶段切换仍沿用既有亮屏调用；音频被系统挂起时每个手势可以重试 resume。前屏自主动作和背屏待发动画已经暂停；像素资源为有界缓存，正常音频声部会结束并断开，没有发现每局新增 AudioContext。浏览器堆统计包含诊断数组，且不含原生宿主内存，不能据此宣称“无内存泄漏”或确诊 OOM。本轮未改变已约定的后台提醒／亮屏策略。

**真机排查方向：** 锁屏／切后台之后发生宿主进程恢复、Activity 或 WebView 重建，是需要优先确认的分支；原生桥接／背屏实现异常和 WebView 渲染进程崩溃也未排除。Android 文档说明系统回收和渲染崩溃都可能让宿主重建 WebView，`onRenderProcessGone` 的 `didCrash()` 可区分两者。参考 [WebView 终止处理](https://developer.android.com/develop/ui/views/layout/webapps/managing-webview)、[RenderProcessGoneDetail](https://developer.android.com/reference/android/webkit/RenderProcessGoneDetail#didCrash())、[应用进程生命周期](https://developer.android.com/guide/components/activities/process-lifecycle)。下一步原生侧证据应包含安装包与 WebView 版本、Activity 创建／销毁、进程退出原因、`onRenderProcessGone`、异常堆栈，以及异常前后 appHide/appShow 的时间。H5 的 memoryWarning 回调仅记录警告；缺少该事件也不能排除系统回收。

严格回归入口为 `npm run test:background-runtime`，其中包括：挂起 20 秒最大一个传感器请求；后台后回前台不放开旧占用；旧面朝上数据不能揭晓；请求完成后正常继续采样；新面朝上数据只增加一次收藏；手动揭晓与结束按钮仍可操作。保留旧包诊断作为修复前证据，不用“诊断执行完成”代替“最大并发为 1”的断言。

本轮最终执行结果：

| 检查 | 结果／证据 |
| --- | --- |
| 严格传感器与完整后台长局 | 2／2，退出码 0；传感器最大并发从 50 降至 1；`.acceptance-final/reload-investigation/after/report.json`，`assertSingleSensor: true` |
| 原生重载与存档恢复回归 | 7／7，退出码 0；`.acceptance-final/native-reload/sensor-regression/report.json` |
| TypeScript 与客户端构建 | `npm run typecheck`、`npm run build:client` 均退出 0 |
| 交付状态 | 修复纳入本次 0.1.1 GitHub 源码交付；未发布安装包，未进行真机验收 |

本轮最终资源快照 SHA-256 为 `bca8cf5e71f27286683ed44b34a5188de68b89e42095a1e0dd0a30a131b9f7c2`，资源摘要规则同下文恢复验收。修复后的长局仍只有一次加载和读档，无后台背屏发帧或未捕获页面异常。模拟测试不能确认实际手机首次重载的根因。

## 2026-11-06 后台重载读档恢复修复

状态：源码和客户端构建完成，随后纳入本次 0.1.1 GitHub 源码交付；未发布 APK、未连接真机。基于提交 `9ad557588b4835b8bd59c9ea4d0685b47e235be7`；下面 2026-11-05 的 137 项结果为历史冻结版本，不计为本次重新执行结果。

用户反馈：手机安装版连续几颗 10 秒蛋正常，之后 3 分 10 秒的一局在中途出现读取进度／收藏失败；重新读取后仍失败，之前发生过锁屏、熄屏或切后台。

已复现的确定缺陷是 `loadBridge()` 永久缓存失败 Promise。初次 SDK 缺失、探测拒绝或超时后，SDK 即使恢复，重试仍沿用失败结果，完全不会进入 `getStorage`。修复只在失败时清除该次缓存，成功与进行中的探测仍共享；读档成功后重新安装原生前后台监听。新增错误分类及安全日志，未知记录继续保留原值，不转为空收藏。

| 本次实际执行 | 结果 | 证据／入口 |
| --- | --- | --- |
| 旧生产包故障注入 | 3／6；三种连接恢复全部失败，恢复后存储读取次数均为 0；三种异常数据保护通过 | `.acceptance-final/native-reload/before/report.json` |
| 首版修复后相同生产包场景 | 6／6 通过，退出码 0；后续补测读取期间的后台切换 | `.acceptance-final/native-reload/after/report.json` |
| 生命周期边界补测，最终修复前 | 6／7；读取期间漏记 appHide，读完后后台错误发出 3 帧，预期 0 帧 | `.acceptance-final/native-reload/lifecycle-before/report.json` |
| 最终修复生产包 | 7／7 通过，退出码 0；包含上述读档期间切后台场景 | `.acceptance-final/native-reload/after-final/report.json` |
| 桥接恢复与存档单测 | 15／15 通过 | `npm run test:recovery-unit` |
| 背屏适配器与调度器回归 | 38／38 通过 | `npm run test:back-screen` |
| TypeScript 与客户端构建 | 通过；native finalize 成功 | `npm run typecheck`、`npm run build:client` |
| 错误页／恢复页检查 | 390px 截图已检查，重试入口、排查代码和恢复后的倒计时可见 | after 及 after-final 目录的 `missing-read-error.png`、`missing-recovered.png` |

生产包脚本 `scripts/acceptance-native-reload.mjs` 在每种连接故障前完成 3 颗 10 秒蛋，再由首页设置 3:10 并计时 65 秒，触发 appHide 后主动重载页面。恢复 SDK 并重新读取后，校验原 sessionId、截止时间、时长、宠物、等级和收藏不变，倒计时按原截止时间继续；再验证 appHide 停止背屏动画、appShow 恢复静帧。另有 JSON 解析异常、未知版本及缺 data 的零写入保护。原生接口均为模拟，页面重载由测试主动注入；这证明重试缺陷及修复，不证明真机最初重载的原因。

最终生命周期处理保留首次尽早订阅，并在读档成功后重新安装订阅，避免先等待读取完成而漏掉中途的 appHide。第 7 个场景在 SDK 就绪、getStorage 挂起期间只发原生 appHide，不发 DOM 隐藏事件；读档完成后推进 9 秒仍发送 0 帧，直到 appShow 才恢复静帧。

最终修复资源快照 SHA-256：`212c00ca01235f14e3fd71353eb1bbaa354fe6651edcaf61e35e082dc99bf0ac`（脚本按资源路径排序，对路径、分隔符和文件内容累计计算）。测试通过内存路由加载实际 native 构建资源，不启动服务器；报告与截图本地留存。复测命令：

```powershell
npm run test:recovery-unit
npm run test:back-screen
npm run typecheck
npm run build:client
node scripts/acceptance-native-reload.mjs .acceptance-final/native-reload/recheck
```

仍需平台将修复源码重新打包，在发生问题的手机上复测“数颗短局 → 3:10 → 锁屏／切后台 → 恢复”。当前源码中，运行计时和背屏错误不会直接进入读档失败页；该页出现在 Provider 初始化／重新加载失败时。尚无真机日志，不能确认最初是否发生原生崩溃、WebView 回收或其他重载，也不能确认当时具体的存储回包。若仍失败，保留原数据并采集页面排查代码、安装包版本和相应原生日志。此次未调整设备桥接协议、电源策略或记录格式。

## 2026-11-05 功能交付历史

命名更新（2026-11-05）：用户最终定名为“破壳倒计时”，已同步首页标识、浏览器标题、应用常量、壳名称、README与交接文档，并刷新首页预览图。本次命名调整后重新完成类型检查、客户端构建及320／375／390px名称布局检查，均通过；下方137项功能测试仍对应命名前的功能冻结版本，业务逻辑没有变化。

同步命名时已合入远端平台适配及背屏验证提交，保留其样式token命名、协议资料和失败路径脚本。远端PRD路径曾被转义成Windows不可检出的名称，现恢复原正常文件名；文档blob保持一致，内容未改。旧Git历史包的移除亦按远端更新保留。

日期：2026-11-05，Asia/Shanghai。最终修复后的完整业务回归 52／52、音效与到期反馈 16／16 通过，退出码均为 0。本轮在已有 `http://127.0.0.1:5179/` 服务上重新执行，使用 Node.js v24.17.0 和项目锁定的 Playwright／Chromium。未重启服务；反馈测试仅修正已定位的首振采样前置等待，业务、双振间隔及取消尾振断言保留，历史报告保留。

## 本轮浏览器验收

| 检查 | 本轮结果 | 本地证据 |
| --- | --- | --- |
| 存档／生命周期补丁后的最终业务回归 | 52／52 通过，退出码 0 | `.acceptance-final/regression-final/report.json` |
| 最终完整反馈复测 | 16／16 通过，退出码 0 | `.acceptance-final/feedback-verified/report.json` |
| 最后业务补丁前的完整回归 | 52／52 通过，退出码 0，保留为过程证据 | `.acceptance-final/regression/report.json` |
| 音效与到期反馈首轮 | 14／16 通过，2 项失败；不能作为最终通过结果 | `.acceptance-final/feedback-initial/report.json` 及 `error-13.png`、`error-14.png` |
| 首次冻结后的完整反馈复测 | 15／16 通过；首振采样前置等待导致失败，保留为过程证据 | `.acceptance-final/feedback-final/report.json` |

首轮反馈执行时，主 agent 修正了 HTML 页标题和 manifest 的旧描述；保存 `index.html` 触发 Vite 整页重载，第 13 项出现 `Execution context was destroyed`。第 14 项未收到预期首振，冻结复测后仍复现，不能归因于热更新。隔离探针确认：模拟时间到截止点时，250ms 阶段定时器尚未取样；继续约 120ms 后出现首振，随后 pagehide 断言通过。测试据此改为到截止点后最多推进一个 250ms 采样周期、每 10ms 观察首次提醒，仍要求恰好一次首振，并保留后续取消尾振及原生生命周期交叉断言；双振间隔仍在独立场景精确验证为 250ms。原失败报告和 `.acceptance-final/feedback-probe/` 探针证据均保留，最终 16 项完整复测通过。

52 项回归覆盖分秒边界与非法输入、四档抽取、当前局锁定、旧记录迁移、连续墙钟调整、收藏与保存重试、背屏伙伴选择、破壳身份隐藏、减少动态、连接挂起与失败恢复、串行命令和隐藏恢复，以及 320／375px 页面与 375×480 模拟键盘视口。模拟视口不等于真机输入法。

16 项反馈验收覆盖开关记忆与首次手势解锁、12 角色及蛋的轻点／亲昵声音、流程提示、静音仍到期双短振、250ms 间隔与去重、保存失败重试、隐藏／揭晓取消尾振、后台不积压、pagehide/pageshow 与原生生命周期交叉、无能力时继续完成业务。真实 AudioContext 的实时 Analyser 检查和 6 份 OfflineAudioContext WAV 渲染独立于注入音频测试；统计与音频随最终反馈证据保存。

## 主 agent 最终集成记录

以下均为本轮实际执行；最终业务源码冻结后补做全套回归，不把前几轮结果计入本轮通过数：

| 集成事项 | 最终结果／版本 |
| --- | --- |
| `npm run typecheck` | 退出码0 |
| `npm run build` 与壳侧产物 | 退出码0；native finalize成功，`dist/client/`就绪，字体和许可一同打包；主JS约636.36kB、gzip190.69kB，保留既有chunk大小提示 |
| 干净目录安装与构建 | 不复制node_modules、环境文件或签名私钥；`npm ci --no-audit --no-fund`安装214个依赖，类型检查和默认构建均退出0；用已安装JDK的keytool现场生成调试签名 |
| 背屏适配器／调度器测试 | 38／38通过 |
| 存档保护／后台翻面专项恢复 | 10／10通过；`.acceptance-final/recovery/results.json` |
| 最终像素交互与三宽布局 | 21／21通过；`.acceptance-final/pixel-final/pixel-report.json`；读取错误界面另做18／18组合检查和人工看图，覆盖3宽×3页×2种损坏记录 |
| 像素资源与联系图 | 12角色、252张前屏资源、48组背屏动作、104张蛋帧；全部通过；`.acceptance-final/art/art-resource-report.json` |
| 用户背屏协议契约 | 7流程阶段、30条命令，最大并发1，0契约及页面错误；`.acceptance-final/contract/contract-trace.json`；没有真实设备参与 |
| 交付仓库与版本定位 | `aladyaraya/pixel-pet-nest`私有仓库，main分支；验收针对本报告随附的源码，准确提交号用`git rev-parse HEAD`获取；旧仓库来源保留为upstream |
| 仓库交接与文件排除 | 运行与构建说明、四套网页脚本、单测、来源与字体许可、精简截图随仓库交付；本地日志、环境变量、签名私钥、完整测试运行目录不上传；候选文件及已有历史的常见令牌／私钥特征检查无命中 |

本轮五套功能测试共137项通过（52业务＋21像素＋16音效＋10恢复＋38背屏单测），另有18个错误界面组合检查和资源／协议验证。首页标签标题改为已确定的应用名称；壳描述从固定三分钟改为自定义时长。未更改应用ID、版本号、权限、设备桥接协议或17×23规格。

## 版本边界与真机待验

- 三个页面、12 个固定角色；时长 1 秒至 180 分钟，3:00 普通、7:00 高级、10:00 华丽。轻互动不增加养成数值，不改变计时、抽取或收藏。
- 记录保持 v2，继续使用 `egg.record.v1`；旧 ID、次数、日期和已开始的一局保留，旧局不重新抽取或推断等级。背屏伙伴选择仍在同一记录内。
- 最终修补区分首次无存档与读取失败：仅明确 `data: null` 作为新用户；读取失败、损坏或未知版本保持原值并提供“重新读取”，成功加载前禁止写入。pagehide 后不重新开启翻面轮询，隐藏前发出的旧传感器回执在恢复后仍丢弃；由专项恢复测试验证。
- 音效默认关闭，需当前页面的用户手势解锁；静音仍可调用到期短振。已保存提醒标记的局刷新不重复；标记保存失败且在重试成功前彻底刷新／退出进程，旧快照可能再次提醒，不承诺该异常下跨重启恰好一次。
- 仍使用既有连接器、Capsule 桥接和电源机制。背屏命令成功回执只证明接口路径；浏览器音频波形和短振调用只证明软件逻辑，不证明真实面板显示、扬声器听感或马达效果。
- STEPX Neo 的背屏刷新、方向、亮度、系统抢占、翻面传感器、音量／静音策略、振动、读屏、真实输入法、减少动态系统设置及锁屏／切应用／来电恢复仍需真机验收。后台页面已被系统挂起时不保证到期唤醒；宠物展示不额外保持正面常亮，不承诺锁屏持续动画。
- 本机缺少平台专用 `app-creator-skill/validate.mjs`，未执行该专项门禁。源代码构建产物须由平台打包为 APK，网页通过不等于 APK 真机通过。

## 复现与交接入口

首次环境先运行 `npm ci` 和 `node node_modules/playwright/cli.js install chromium`，保持开发服务在线。若不是 5179，替换为实际预览地址：

```powershell
$env:ACCEPTANCE_OUT = '.acceptance-final/regression-final'
$env:ACCEPTANCE_FILTER = ''
npm run test:e2e -- http://127.0.0.1:5179/

$env:FEEDBACK_ACCEPTANCE_OUT = '.acceptance-final/feedback-verified'
$env:FEEDBACK_ACCEPTANCE_FILTER = ''
npm run test:feedback -- http://127.0.0.1:5179/

$env:PIXEL_ACCEPTANCE_OUT = '.acceptance-final/pixel-final'
npm run test:pixel -- http://127.0.0.1:5179/
npm run test:recovery -- http://127.0.0.1:5179/

$env:PIXEL_ART_OUT = '.acceptance-final/art'
node scripts/verify-pixel-art.mjs http://127.0.0.1:5179/
npm run test:back-screen
npm run typecheck
npm run build
```

后续复测请换用新的证据目录，避免覆盖本次首轮和最终报告。`.acceptance-final/` 是本地生成证据，不进入Git；可复现脚本、本文以及`docs/previews/`中的三张精简预览随仓库交付。全部截图来自隔离测试存档。默认签名不作为正式发布凭据共享；本次推送源码，没有部署网站或发布APK。

二次开发从 [交接文档](handover.md) 开始；音效和存储提醒边界见 [反馈验收](feedback-acceptance.md)，像素视觉与手势规则见 [像素伙伴验收](pixel-pets-acceptance.md)，用户提供的背屏协议对照见 [背屏接口核验](back-screen-verification.md)。原始 PRD.docx 保留为历史，不覆盖之后明确的需求。
