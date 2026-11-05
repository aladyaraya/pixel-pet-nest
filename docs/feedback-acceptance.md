# 音效与倒计时结束震动验收

日期：2026-11-05。本轮浏览器反馈验收 16／16、业务回归 52／52、背屏适配器与调度器单测 38／38 通过，类型检查与构建退出码均为 0，native finalize 成功。结果来自本轮执行，未沿用前一版验收。

## 行为与实测

| 行为 | 本轮验证 |
| --- | --- |
| 音效默认关闭，开关记忆 | 点击开启立即试听，设置保存；刷新保留开关，但读取设置不创建 AudioContext；首次有效手势才解锁 |
| 12 只宠物与蛋的回应 | 12 个轻点旋律各不相同；每只轻点与亲昵不同，蛋的两种回应也不同；互动前后收藏与孵化记录保持一致 |
| 流程声音 | 开始、50% 阶段提示、到期、破壳均产生对应音型；揭晓只入藏一次，刷新不重播破壳 |
| 静音与到期震动独立 | 静音下仍调用两次 `vibrateShort({ type: 'medium' })`，相隔 250ms；揭晓的 `light` 短振单独区分 |
| 每局提醒去重 | 同页等待、到期标记保存失败后重试、标记成功保存后刷新均不重复到期提醒 |
| 隐藏与恢复 | visibility 隐藏立即停止声音并取消尾振；后台到期仅保留首振，不播放声音或安排尾振；返回前台不补播 |
| pagehide 与原生生命周期 | pagehide 停声并取消尾振；pageshow 不覆盖仍存在的原生 appHide；appShow 恢复后只响应新手势，不补播旧声音或尾振 |
| 关闭音效与延迟解锁 | 关闭立即停止并断开活动音源；慢 resume 只容许 150ms 内最后一条声音，过期或隐藏即丢弃，不积压播放队列 |
| 能力缺失 | AudioContext 不可用或振动接口拒绝时，仍可正常完成孵化与揭晓 |
| 真实浏览器音频 | 真实 AudioContext 在按钮手势内首次创建后为 running，实时 Analyser 捕获非零声音；另用真实 OfflineAudioContext 渲染 6 份 WAV，波形非零、有限且峰值小于 1 |

真实 AudioContext 的本次 Chromium 实测在手势内创建后已经处于 running，未额外调用 resume；延迟 resume 的分支由独立注入测试覆盖。声音在本地 Web Audio 合成，无外链音频；低音角色的亲昵回应保留可听音区，其他角色适当降低音高并放慢。

## 证据与复现

本轮输出位于 `.acceptance-feedback/`：

- `report.json`：16 项反馈验收；`regression/report.json`：52 项业务回归。
- `case-*.json`：合成音源与短振接口时序；`pet-signatures.json`：12 角色轻点／亲昵音型。
- `real-audio-context.json`：真实 AudioContext 状态、用户激活和实时音频分析；`real-audio-render.json`：6 份离线合成波形统计。
- `sound-start.wav`、`sound-due.wav`、`sound-crack.wav`、`sound-egg-hold.wav`、`sound-whale-tap.wav`、`sound-whale-hold.wav`：48kHz、16 位单声道代表音效，可直接试听。
- `sound-enabled-pet.png`：开启音效后的宠物详情。

首次安装环境执行 `npm ci` 与 `node node_modules/playwright/cli.js install chromium`。保持开发服务在线，本轮使用 `http://127.0.0.1:5179/`：

```powershell
$env:FEEDBACK_ACCEPTANCE_OUT = '.acceptance-feedback'
$env:FEEDBACK_ACCEPTANCE_FILTER = ''
npm run test:feedback -- http://127.0.0.1:5179/

$env:ACCEPTANCE_OUT = '.acceptance-feedback/regression'
$env:ACCEPTANCE_FILTER = ''
npm run test:e2e -- http://127.0.0.1:5179/

npm run test:back-screen
npm run typecheck
npm run build
```

## 尚未证明的范围

浏览器测试验证音频合成、手势解锁和振动接口调用，不证明 STEPX Neo 的扬声器听感、系统静音策略、实际马达强度、锁屏唤醒或后台进程持续运行。WAV 供试听，不能替代手机实听。平台专用 `app-creator-skill/validate.mjs` 在本机缺失，本轮未执行。

到期去重沿用现有记录中的 `session.hintedPhases` 和当前页面内存。若到期标记保存失败，且在重试成功前彻底刷新或退出进程，旧快照无法知道已经提醒，可能再次提醒；本轮未增加旁路存储机制。原生调用回执也无法证明用户实际感知到震动。后台已停止执行的页面无法保证到时发出提醒。

本轮新增独立反馈脚本，不修改既有 52／21 项测试文件或历史报告；未提交、推送或更改设备系统显示设置。
