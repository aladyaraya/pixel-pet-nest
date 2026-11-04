# 交接文档 ·「这颗蛋快孵出来了」

> 面向接手的开发者 / AI：本文是二次开发的唯一入口。先读本文，再读 `README.md` 与 `docs/acceptance.md`。
> 项目性质：STEPX Neo 背屏孵蛋小玩具（React + TypeScript + Vite，本地存储，无后端、无登录、无支付）。

## 1. 产品一句话

点「孵一颗」→ 把手机正面朝下 → 背面 17×23 点阵屏显示一颗蛋，随时间出现裂纹 → 到点轻振一次 → 翻回主屏揭晓 6 个角色之一。三页面：开始页 / 孵化及揭晓页 / 收藏页。正式模式可选 1 / 3 / 5 / 10 分钟（默认 3 分钟），演示模式 20 秒。

完整产品需求见仓库内 `docs/这颗蛋快孵出来了-PRD.docx`（评审稿 V0.1）。

## 2. 运行与验证命令

```bash
npm install        # 或 npm run deps（沙箱回收后 node_modules 会丢，先自愈）
npm run dev        # 本地预览：http://127.0.0.1:5173/preview/p_0b48bb06f8c0d4dd/ （必须带尾斜杠）
npm run typecheck  # tsc --noEmit
npm run build      # 产出 dist/client/（壳侧 bundle，可打 APK）
node scripts/acceptance-web.mjs   # 网页验收 33 项（需 dev server 在线）
node <app-creator-skill>/scripts/validate.mjs . --build   # 工程门禁 39 项
```

验收记录与截图：`docs/acceptance.md`、`.acceptance/`（截图本地留存，不提交）。

## 3. 代码地图

| 文件 | 职责 |
| --- | --- |
| `src/app/App.tsx` | 路由：`/` 开始页、`/hatch` 孵化及揭晓、`/collection` 收藏 |
| `src/app/pages/StartPage.tsx` | 开始页：时长 chips、主按钮、音效开关、隐私提示 |
| `src/app/pages/HatchPage.tsx` | 孵化页：倒计时、阶段预览、翻面开关、结束确认、揭晓（1 秒破壳两帧） |
| `src/app/pages/CollectionPage.tsx` | 收藏页：6 格、次数/最近日期、剪影、小喇叭 toast 反馈 |
| `src/shared/egg/EggProvider.tsx` | **核心**：状态机、计时（deadline 驱动）、阶段效果、背屏提交、生命周期恢复、动作（start/reveal/abort/retrySave） |
| `src/shared/egg/types.ts` | 类型 + 时长常量 + `formatDuration` + 阶段边界（50% / 85%） |
| `src/shared/egg/patterns.ts` | 蛋的阶段点阵帧（waiting/wobble/cracking/almost/ready/readyAlt） |
| `src/shared/egg/pets.ts` | 6 个角色字符串点阵 + 短句 + 等概率抽取 |
| `src/shared/egg/matrix.ts` | 帧运算：patternToFrame / carveLine / shiftFrame / toSilhouette |
| `src/shared/egg/backScreen.ts` | 背屏接入层：`window.mcp.callTool`，dev 走模拟、生产无壳不假装成功 |
| `src/shared/egg/audio.ts` | Web Audio 合成音效（start/stage/due/crack/meet），默认关 |
| `src/shared/egg/storage.ts` | 本地记录：带版本号、串行写入、损坏/拒绝时抛错由上层处理 |
| `src/app/components/MatrixView.tsx` | 17×23 CSS grid 点阵预览（点亮 / 剪影两态） |

## 4. 核心机制（改代码前必读）

- **计时**：以 session 的 `deadlineAt` 计算进度，页面 250ms tick 只负责刷新；恢复时先读记录再算阶段。设备时间跳变 >3s 时按 `performance.now()` 已运行时长重算 deadline 并提示用户。
- **背屏**：连接器 `ic_atomic_990001`，先 `await window.mcp.connect()` 再 `callTool`。核心能力 `set_back_screen_frame`，入参 `{frame: number[391]}`（17 列×23 行**行优先**，下标 `y*17+x`，0 灭 / 255 亮，**不支持 text 参数**）；另有 `clear_back_screen_frame`、`wake_up_back_screen`、`sleep_back_screen`（均无参）。提交带自增 seq，过期响应丢弃；回前台只提交当前阶段。
- **阶段**：waiting 0–50%（8 秒两帧轻晃，减少动态时跳过）/ cracking 50–85%（一条锯齿裂纹）/ almost 85–100%（裂纹扩展+上部偏移）/ ready（裂开蛋+问号）/ revealed（角色剪影）。
- **存储**：一份带版本号记录 = settings（sound / flipReveal / lastDurationMs / privacyAgreed）+ session + 6 角色计数；session 字段 sessionId、mode、durationMs、startedAt、deadlineAt、petId、phase、revealedAt、hintedPhases。揭晓与计数同一份记录一起更新，写成功才算收藏完成；失败显示「这次收藏还没保存」可重试（同 sessionId 不重复计数）。
- **壳接口**：`getSensor` / `vibrateShort` / `setKeepScreenOn` / `setStorage` / `getStorage` / `privacy.getStatus` / 事件 `appShow` / `appHide`，均为普通权限（manifest `permissions: []`）。到期未揭晓最多保持亮屏 30 秒后释放。
- **预览链路**：平台预览走 `https://studio.stepx.com/preview/p_0b48bb06f8c0d4dd/`，代理到本地 dev server（端口见 `PREVIEW_PORT`，当前 5173）。dev 时 HTML 会注入 `@id/virtual:stepfun-preview-runtime`（仅 dev，生产产物不含）；**不要 kill / 重启预览服务**；`.env.local` 被平台更新时 Vite 会自动重启，重启窗口期预览会瞬报资源加载失败，刷新即恢复。

## 5. 当前状态

- 已完成：三页面、6 角色、阶段点阵、自定义时长、收藏、背屏接入层、音效、存储与异常处理。
- 验证：typecheck / build / 门禁 39/39 / 网页验收 33/33 全过（见 `docs/acceptance.md`）。
- 环境限制：本开发环境无 STEPX Neo 真机，以下为**待真机验证项**（接入层已隔离，APK 装真机后按 `docs/acceptance.md` 末节步骤补测）：
  1. 背屏实际显示（方向、亮度、释放、系统抢占恢复）；
  2. 到期短振可感知性、切后台是否执行；
  3. `getSensor` 轴向与翻面阈值（当前 z < -5 朝下 / z > +5 朝上）；
  4. 锁屏 / 切应用 / 接电话恢复；
  5. 系统读屏（TalkBack / 旁白）；
  6. 现场可读性试玩（30cm / 60cm，4 人至少 3 人区分三种状态）。

## 6. 下一步建议（按优先级）

1. **真机补测**后，把 `src/shared/egg/types.ts` 的 `flipReveal` 默认值改 `true`，并去掉 `HatchPage` 开关上「实验功能，真机验证后生效」标注（PRD：前台翻面自动揭晓验证通过后启用）。
2. 若背屏点阵方向与设计相反，在 `src/shared/egg/matrix.ts` 输出前做一次转置（PRD 03 章：落地时校正设备方向）。
3. 后续增强（PRD「可进入下一版」）：Amoo 语音创建一局、5/10 分钟以上时长、点阵主题、用户自画角色。
4. 交付物：`dist/client/` 随 `capsule/` 构成壳侧 bundle 打包 APK；应用名/桌面图标在平台项目设置里改，不要改源码兜底。

## 7. 注意事项

- 颜色只用语义 token（`src/shared/styles/tokens.css`，当前为深色暖调 + 琥珀主色）；组件里禁止色值字面量。
- 图标用 `lucide-react` 具名导入；禁止运行时动态注入脚本；禁止外部 CDN 资源。
- 高度用 `h-dvh` 系，不用 `100vh`；滚动条默认隐藏（`.ui-app`）。
- 数据只走 `src/shared/egg/storage.ts`（壳 setStorage / 浏览器 localStorage 适配）；不要新建 supabase 客户端（本应用无后端）。
- 提交前跑：`npm run typecheck` + `npm run build` + `validate.mjs . --build`。
