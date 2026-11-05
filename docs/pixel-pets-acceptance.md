# 复古像素界面与触摸伙伴验收

日期：2026-11-05。本轮冻结源码完成 52／52 项业务回归、21／21 项像素与手势验收，均无失败。最后一处 Toast 直角样式修补后，另行通过 3／3 项布局复查并刷新截图；这 3 项是已有宽度场景的重跑，不计为新增场景。下列结果均来自本轮执行，未借用历史报告。

## 需求与验收落点

| 已确认需求 | 验收落点 |
| --- | --- |
| 整体复古温暖像素界面，覆盖所有 UI | 首页、孵化、相遇、收藏、详情、确认框、失败与重试状态；标题、计时、分秒数字和标志使用本地 Fusion Pixel 24px，正文保留系统中文字体以保证可读性 |
| 只靠触摸发现，无独立动作按钮 | 角色本体轻点／长按；移除重听文案按钮；保留开始、揭晓、选择、停止与重试等业务操作 |
| 轻点与长按有不同回应 | 轻点回应 1000ms；按住 600ms 触发亲昵回应 1800ms；一次手势只计一次，抬手不补触发轻点 |
| 手势不妨碍浏览 | 移动超过 10px、滚动、多指、pointer cancel、切页、隐藏取消；Enter／Space 为轻点，Shift+Enter 为亲昵替代 |
| 不增加养成系统 | 手势不改变时长、截止时间、抽签、等级、收藏次数、日期或已保存选择 |
| 蛋仍按原流程孵化 | 互动不提前增加裂纹或揭晓；自然 50%／85%／ready 阶段照常；1200ms 破壳保持结果隐藏 |
| 只联动当前背屏伙伴 | 已收集且当前选中者可联动；浏览其他角色只在前屏回应；未揭晓蛋和破壳过场优先 |
| 背屏间歇短动作 | 8／10／12 秒节奏、人工回应优先于自主动作；所有帧在上一帧实际完成后至少间隔 1 秒；不并发、不补播旧目标 |
| 减少动态和静止卡片 | 减少动态保留文字回应、固定动作帧；卡片缩略图保持静止，只有详情／相遇角色承担互动 |

## 实测结果

| 检查 | 状态 | 证据与限制 |
| --- | --- | --- |
| 既有业务网页回归 | 52／52 通过 | `.acceptance-pixel/regression/report.json`；保留时长边界、分档、迁移、收藏、保存／连接失败和串行断言，仅为新增帧间隔推进时钟等待 |
| 像素与手势浏览器验收 | 21／21 通过 | `.acceptance-pixel/pixel-report.json`；真实浏览器触摸事件、键盘、可控时钟和隔离 MCP 模拟 |
| 12 角色与蛋阶段视觉 | 自动检查及人工看图通过 | `art-resource-report.json`：12 角色共 252 张前屏资源、48 组背屏动作、104 张蛋帧；0 资源错误、0 页面异常，闭合蛋壳 mask 与破壳分片连续性通过；主 agent 与视觉 agent 查看联系图 |
| 320／375／390px 布局 | 通过；样式补丁后 3／3 复查通过 | 三个主页面和详情无水平溢出，互动目标不小于 44px；实际本地字体加载、24px 标题／计时及 Toast `border-radius: 0px` 通过；最新截图在 `layout-refresh/` |
| 375×480 模拟键盘视口 | 通过 | 52 项回归中验证聚焦秒输入完整可见，无测试脚本主动滚动补救；这是缩短视口模拟，不是真机输入法实测 |
| 类型检查与构建 | 退出码 0 | 主 agent 在最终源码上执行 `npm run typecheck`、`npm run build`；native finalize 成功，`dist/client` 就绪；Toast 样式补丁后构建再次通过 |
| 背屏适配器与调度器单测 | 38／38 通过 | 主 agent 执行 `npm run test:back-screen`：17 项适配器与 21 项调度器测试；包含过期帧、同目标失败、人工抢占和帧间隔 |
| 用户接口契约追踪 | 通过 | `contract-trace.json`：7 个流程阶段、30 条命令，最大并发 1，0 契约／页面错误；接口回执不代表真实面板已显示 |
| 原生与平台边界 | 保护文件未改 | 主 agent 核对 bridge、native、capsule manifest、capability 文件差异为空；本轮不修改设备显示模式、电源策略或后台运行机制 |
| 平台专项 validate 门禁 | 未执行 | 本机缺少既有文档所述 `app-creator-skill/validate.mjs`，不引用历史平台通过数 |
| STEPX Neo 真机与系统读屏 | 未验证 | 浏览器指针／键盘／可控时钟／MCP 注入不能证明真实面板、系统手势、读屏或后台运行行为 |

21 项新增验收覆盖 599／600ms 长按边界、10／11px 移动边界、多指与实际滚动取消、隐藏／pagehide／切页取消、键盘替代、12 角色轻点与亲昵采样、静止缩略图、当前伙伴联动、蛋与短局优先、破壳身份隐藏、减少动态、恢复不补播、8／10／12 秒背屏节奏、人工抢占与同目标旧帧失败。各场景均检查无未捕获页面异常、背屏命令不并发，以及相邻帧从前一帧实际完成起至少间隔 1 秒；互动前后核对保存记录不被无关动作改变。

真实背屏刷新速度、显示结果、亮度与旋转、翻面传感器、触觉反馈、系统读屏、真实输入法以及锁屏／后台进程存活仍需 STEPX Neo 实测。保留原孵化期前屏亮屏机制及 ready 后 30 秒释放逻辑；宠物展示不额外保持前屏常亮，也不承诺锁屏持续动画。减少动态已在浏览器媒体偏好下验证，尚未验证真机系统设置联动。

## 复现与证据保存

保持现有开发服务在线，首次安装环境先执行 `npm ci` 与 `node node_modules/playwright/cli.js install chromium`。本机预览地址为 `http://127.0.0.1:5179/`；不要为测试重启服务。

```powershell
# 原有业务回归，证据另存，不覆盖此前版本
$env:ACCEPTANCE_OUT = '.acceptance-pixel/regression'
$env:ACCEPTANCE_FILTER = ''
node scripts/acceptance-web.mjs http://127.0.0.1:5179/

# 新像素／手势验收，完整运行时不设置筛选
$env:PIXEL_ACCEPTANCE_OUT = '.acceptance-pixel'
$env:PIXEL_ACCEPTANCE_FILTER = ''
node scripts/acceptance-pixel.mjs http://127.0.0.1:5179/

# 资源合同检查
node scripts/verify-pixel-art.mjs http://127.0.0.1:5179/

# 最后 Toast 样式补丁的定向复查；输出单独保存
$env:PIXEL_ACCEPTANCE_OUT = '.acceptance-pixel/layout-refresh'
$env:PIXEL_ACCEPTANCE_FILTER = 'px像素三页面'
node scripts/acceptance-pixel.mjs http://127.0.0.1:5179/

# 无需开发服务的检查
npm run test:back-screen
npm run typecheck
npm run build
```

证据全部保存在 `.acceptance-pixel/`：

- 完整网页回归：`regression/report.json`；完整新验收：`pixel-report.json`；样式补丁复查：`layout-refresh/pixel-report.json`。
- 资源与接口报告：`art-resource-report.json`、`contract-trace.json`、`idle-timing.json`、各场景 `commands-*.json`。
- 人工走查联系图：`art-contact-sheet.png`、`art-tap-sheet.png`、`art-hold-sheet.png`、`egg-contact-sheet.png`、`back-motion-sheet.png`。
- 12 角色轻点／亲昵的 24 张采样截图与索引：`action-samples/`、`action-samples.json`；浏览器录屏：`pixel-interactions.webm`。
- 最新三宽页面截图：`layout-refresh/pixel-start-*.png`、`pixel-hatch-*.png`、`pixel-gallery-*.png`、`pixel-detail-*.png`；模拟键盘截图：`regression/storybook-keyboard-viewport-375x480.png`。

Fusion Pixel 字体从本地服务实际加载，701520 字节的 WOFF2 随构建打包，不依赖远程字体服务。原有 `.acceptance-current/`、`.acceptance-storybook/` 和 `.acceptance-back-screen/` 报告保留。本轮自动化使用隔离的本地记录与模拟设备接口；未修改用户设备的显示模式、亮度、相机联动或自动旋转设置，未提交或推送仓库。
