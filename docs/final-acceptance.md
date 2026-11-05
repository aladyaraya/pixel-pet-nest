# 最终交付验收

命名更新（2026-11-05）：用户最终定名为“破壳倒计时”，已同步首页标识、浏览器标题、应用常量、壳名称、README与交接文档，并刷新首页预览图。本次命名调整后重新完成类型检查、客户端构建及320／375／390px名称布局检查，均通过；下方137项功能测试仍对应命名前的功能冻结版本，业务逻辑没有变化。

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
