# AI Builder App 工程模板

> 由 AI Builder 的 **app-creator-skill** 生成。改代码前请先读该 Skill 的 `SKILL.md` 与 `references/` 下的规范。

一个工程共享 App 源码与一套设计 token，Admin 按需；默认无参数 build 必须尝试 native + PWA + 工程有则 Admin。native/按需 Admin 为主产物，失败非 0；PWA 副产物缺 context、不支持或失败仅内部记录、对用户静默、不阻断主产物。无后台记 not_requested，半删三件套则 Admin 失败。

| 入口 | 界面 | 面向 | 构建产物 |
| --- | --- | --- | --- |
| [`index.html`](./index.html) → [`src/app/`](./src/app) | App UI（移动端 H5） | App 壳的 WebView | `dist/client/web/**`（与 `capsule/` 一起构成壳侧 bundle，打进 APK） |
| [`index.html`](./index.html) → 同一 App/shared 源码 | PWA App UI | Safari / 主屏幕 Web App | `dist/pwa/**`（平台托管与核验，契约见 Skill `09 §10`） |
| [`admin.html`](./admin.html) → [`src/admin/`](./src/admin)（按需） | Admin UI（桌面为主、手机可用） | 浏览器访问 | `dist/admin/**`（整目录拷到静态服务器） |

## 快速开始

构建命令按本次范围选用，不是顺次执行后合并各轮 report；多端最终收口见下方说明。

```bash
npm install
npm run dev        # http://127.0.0.1:5173/            → App UI
                   # http://127.0.0.1:5173/admin.html  → 管理后台
npm run typecheck  # 类型门禁（构建不含类型检查，两条都要跑）
# PWA context/本地图标由平台冻结物化，缺输入不阻断默认主构建
npm run build      # native + 存在则 Admin 为主，必须伴随尝试 PWA，失败仅内部记录
npm run build:pwa  # 显式请求 PWA-only，需可信 context，失败非 0
npm run build -- --targets native,pwa # 显式双目标均严格，不碰 dist/admin
npm run build:client # 可用的 native 单端构建，可正式交付
npm run build:admin  # 可用的 Admin 单端构建，可正式交付
npm run deps       # 依赖自愈：沙箱回收后 node_modules 丢失时按需重装（dev/build/typecheck 已自动前置）
```

预览插件（`stepai-vite-config`）已配好：`npm run dev` 时提供元素点选定位、预览运行时与错误收集；`npm run build` 不会把任何调试代码打进产物。

> **默认伴随尝试，显式目标严格**。platform/harness 冻结 `VIBE_PWA_CONTEXT_PATH` 指定的 protojson 文件或工程 `pwa-build-context.json` 与本地图标；Agent 仅读取、构建、查看报告，不猜输入、不调用管理 API 补 context、不私改登录。缺 PWA 输入仅内部诊断、不向用户告知，见 [09 §10.4](../../references/09-deployment.md#104-默认伴随-pwa-失败的用户输出静默)，无需为主构建补平台值。单端构建可正式使用，显式请求 PWA 则必须成功；未选目录保留但不取用。默认 `validate . --build` 主产物通用门禁严格，G61 独立非阻断；PWA-only 仍严格。平台只按本轮 `dist/build-report.json` 中 success 目标核验/发布/回链接，不取残留目录或上一轮 report，失败 PWA 不返回入口。旧沙箱同时更新 Skill、工程 PWA 脚本/生成类型与 `pwa.config.json`，完整契约见 Skill `references/09-deployment.md §10`。

工程 [pwa.config.json](./pwa.config.json) 使用 IDE proto `PwaProjectConfig`，Agent 按真实主流程维护所需能力，平台从同 sourceCommit 冻结；缺文件只让 PWA fail closed，不影响默认 APK。context 保持冻结，不混入本地派生值；URL/data URI 图标仅消费 IDE builder 提供的工程内 `VIBE_PWA_ICON_PATH` 绝对路径，不自行下载。wire report 与生成类型的权威及校验见 [09 §10](../../references/09-deployment.md#10-pwa-目标与平台构建上下文)，不复制协议。

正式 PWA 与主屏幕模式均不提供模板级分享安装 UI，引导由平台前端负责；[PwaProvider](./src/shared/pwa/PwaProvider.tsx) 保留离线、更新提示和草稿/多窗口保护。系统手动安装与职责边界见 [ios-pwa 标准 §3](../../../library/ios-pwa/references/01-pwa-contract.md#3-安装与真实体验边界)。旧工程先用 Skill 的 [只读清点工具](../../scripts/check-pwa-integration.mjs)，按 [03 §7](../../references/03-project-skeleton.md#7-pwa-共享运行时落位) 移除旧 UI 接线后重新构建发布，不覆盖业务或 APK 配置；通过不等于已部署。

同工程 build 互斥、参数失败无 success 与报告独立性只按安装的 app-creator-skill `references/09-deployment.md §10` 执行。单端专项后，多端交付最后运行 `node <app-creator-skill>/scripts/validate.mjs . --build`，不拼历史单端结果；PWA-only 单交付用严格 `--target pwa --build`，无需 native。退出码 0 仍需内部核对 JSON warnings/PWA 状态；默认伴随失败对用户静默，见 [09 §10.4](../../references/09-deployment.md#104-默认伴随-pwa-失败的用户输出静默)。`ensure-deps` 跨进程锁仅用于依赖管理，不允许并发 build。

开发前请先读 [AGENTS.md](./AGENTS.md)——它写清了改代码时必须同步维护的东西（`capsule/`、`permissions`、版本号等）。

## 工程里现在有什么

初始只有**一页占位页**（[`src/app/pages/HomePage.tsx`](./src/app/pages/HomePage.tsx)、
[`src/admin/pages/HomePage.tsx`](./src/admin/pages/HomePage.tsx)，带 `@scaffold-placeholder` 标记）——
它只保证“能跑起来”。**交付前必须按需求替换**（门禁 **G47** 会检查标记是否还在）：页面、导航、数据都从需求来。

需要参考实现时，去 Skill 的 `assets/demo-pages/`（单页参考：列表 / 详情 / 后台表格…）与
`assets/scenario-samples/`（电商 / 小游戏场景增量）**按需取用**——参考不是需求，拷进去的要改造成用户要的样子。

后台布局直接复用 [`src/admin/components/`](./src/admin/components) 原语，完整列表 → 详情 → 编辑骨架在 Skill 的参考区，不默认加进工程。
后台交付前按 Skill 的 `references/18-admin-browser-validation.md` 配置实际页面 / 主流程，在 375 / 768 / 1440px 下验收、查看截图、修复后重跑；静态检查绿不替代浏览器验证。

## 构建产物与部署

默认 `npm run build` 构建 native/按需 Admin 主产物并伴随尝试 PWA，各成功目标独立部署；PWA 标准与可信输入看本节末尾的说明：

```
dist/client/              # = <applicationId>/ 的内容，打进 APK
├── manifest.json         # 由 capsule/manifest.json 复制而来
├── signing/              # capsule.p12 + capsule.properties
├── icon/                 # 桌面图标（capsule/icon/ 存在时才有）
└── web/                  # App UI 构建产物（manifest.entry 指向 web/index.html）
    ├── index.html
    └── assets/           # 带内容 hash

dist/pwa/                 # 同 App 源码的 browser 制品，结构/上下文见 Skill 09 §10

dist/admin/               # 按需 Admin UI 静态站点，整目录拷到静态服务器
├── index.html            # 构建末尾由 admin.html 重命名而来
└── assets/
```

- **App UI 打进 APK**：`dist/client/` 整体（含 `manifest.json` / `signing/` / `icon/` / `web/`）
  打包成 `<applicationId>.bundle` 交给壳工程出 APK。`dist/client/` 里少了 `signing/` 会让 APK 构建失败。
- **Admin UI 独立部署**：`dist/admin/` 整个目录拷到静态服务器即可（nginx 用默认 `index index.html`）。
- 各目录之间**没有任何相互引用**（各自单入口构建，不共享 chunk）；PWA 成功后可独立托管，副产物失败不影响主产物交付；显式单端按所请求范围构建。
- App/Admin 都用 HashRouter，不为 PWA 迁移路由模式；hash 不要求通用 SPA fallback，但 PWA 稳定路径映射与平台最终 HTTP 验收仍不可省。
- native/Admin 的 `base: './'` 适配各自子路径；PWA 不能随意搬路径，资源根来自可信平台上下文。
- bundle 打包与出 APK 的完整流程见 **builder-app-packaging** skill（由平台执行，Agent 只需产出 `dist/client/`）；
  缓存与 nginx 参考配置见 app-creator-skill 的 `references/09-deployment.md`。

### 正式 PWA 产物

`dist/pwa/` 是独立 browser 制品，不是 native web 目录重命名，PWA-only 不要求 signing/壳 manifest。target、构建输入与 report 边界只查安装的 app-creator-skill `references/09-deployment.md §10`；公开配置与身份/状态命名看 `references/12-runtime-config.md` 的 PWA 段，不继承全 env 或私自改登录。

PWA 与 native 共用 App 页面，browser 能力接线看 `references/06-js-bridge.md §10`，Provider 接线看 `references/03-project-skeleton.md §7`，布局看 `references/07-mobile-adaptation.md` 的 PWA 段；每次正式打包读 `ios-pwa`，安装/图标/离线/更新/真机验收只查该领域库。DEV mock 不是生产实现，PWA 只 browser，无实现 unsupported；不承诺原生方向锁、退出、状态栏或智能体。内部 report 不公开，`dist/build-report.json` 仅记录逐目标状态/阶段/安全错误码，`pwa-build-report.json` 摘要校验完成才记 PWA success；success 不等于线上 ready，平台独立核验决定可用，未测不写真机已过。

## 目录结构

```
capsule/                     壳侧交付信息（构建时复制进 dist/client/）
├── manifest.json            applicationId / name / version / versionCode / entry / permissions
├── signing/                 capsule.p12 + capsule.properties（.p12 不进版本库，构建时自动生成调试证书）
└── icon/                    桌面图标 XML
scripts/
├── build.mjs                npm run build 入口：依赖自愈 → native + PWA + 按需 Admin 构建 → 各目标收尾（不含类型检查）
├── finalize-build.mjs       构建收尾：校验 manifest、拼装 dist/client/、重命名 dist/admin/index.html
├── pwa-context.mjs         可信 PWA context 校验（pwa-context.d.mts 为类型声明）
├── gen/                    IDE 生成类型/契约（api/v1/pwa.ts、errors/v1/errors.ts、pwa-contract.mjs；不可手改）
├── finalize-pwa.mjs        PWA 收尾与内部报告
├── check-pwa.mjs           直接运行的 PWA 产物 checker
├── make-pwa-icons.mjs      本地图标生成，标准见 ios-pwa
└── gen-debug-signing.mjs    生成调试签名证书
src/
├── app/                     App UI（移动端）
│   ├── App.tsx              路由表
│   ├── layout/AppShell.tsx  内容区 +（页面声明标题时才出现的）顶栏；导航按需求再加
│   ├── layout/PageTitle.tsx 页面级 chrome 注册（usePageTitle() 顶栏标题 / useTopBleed() 顶部穿透；都不声明则无顶栏）
│   ├── layout/TopBleedScrim.tsx 穿透页的状态栏渐变垫底（随正文滚入渐显；AppShell 自动挂载）
│   ├── pages/               页面
│   └── components/          仅 App UI 用的组件
├── admin/                   管理后台（PC）
│   ├── App.tsx
│   ├── layout/AdminShell.tsx
│   └── pages/
└── shared/                  两套 UI 共用
    ├── api/                 数据访问层（原生 request → fetch；带 mock 的完整示例见 Skill 的 demo-pages）
    ├── bridge/              native/browser/DEV mock（browser.ts 与支持白名单 browser-capabilities.json 同放，业务只用 index.ts）
    ├── pwa/                 PwaProvider 与更新屏障（只 PWA 生产注册 SW）
    ├── hooks/               useAsync / useBridgeTask
    ├── lib/                 cn / storage / format
    ├── native/              原生运行态（系统信息、安全区、状态栏前景、网络）
    ├── styles/              tokens.css（唯一色值来源）+ globals.css
    └── ui/                  基础组件
```

## 铁律（改代码时不要违反）

1. **颜色只写在 [`src/shared/styles/tokens.css`](./src/shared/styles/tokens.css)**，组件里禁止出现 `#hex` / `rgb(...)` 字面值；
   也**不要**写 `dark:` 变体——本工程只有一套配色（门禁 G10）。
2. **原生能力只通过 [`@/shared/bridge`](./src/shared/bridge/index.ts) 调用**，不要在业务代码里直接 `window.capsule`。
3. **新页面必须挂到路由表**（[`src/app/App.tsx`](./src/app/App.tsx) / [`src/admin/App.tsx`](./src/admin/App.tsx)），不要在组件里内联定义页面。
4. **`app/` 与 `admin/` 不互相引用**，共享逻辑下沉到 [`shared/`](./src/shared)；各目标产物也必须能单独部署。
5. 新增依赖前先看 app-creator-skill 的 `references/01-tech-stack.md`，Vite 必须停在 6.x。
6. **所有依赖与静态资源必须本地化，禁止引用线上第三方 CDN**：图片/字体/音频先下载到 [`src/assets/`](./src/assets) 再 `import`，JS 库用 `npm install`；
   HTML/CSS 里不允许出现 `<script src="https://...">`、`@import url(https://...)` 这类外链。
   唯一的例外是壳提供的桥接 SDK `/sdk/capsule.js`（跟随当前页面主机：测试包 `appassets.t-stepos.com`，线上包 `appassets.stepaos.com`，**禁止改成写死的旧主机名**）：
   它**不静态写在源 [index.html](./index.html) 里**（浏览器 / 平台预览会 404），由构建期插件（[`vite.config.ts`](./vite.config.ts) 的 `capsuleSdkInjectPlugin`）在构建 native App UI 时注入产物 HTML（Admin/PWA 不带）。
7. **预览环境的原生能力兜底只存在于 dev，真机不许有告警**：`dev` 下的缺口上报已内置在
   [`src/shared/bridge/dev-report.ts`](./src/shared/bridge/dev-report.ts)（由 [`index.ts`](./src/shared/bridge/index.ts) 统一调用），
   业务代码**不要**自己写这类兜底或告警。
8. **改了原生能力调用就要同步 [`capsule/manifest.json`](./capsule/manifest.json) 的 `permissions`**，
   改了版本就要同步 `version` / `versionCode` 与 `src/shared/config/app.ts` 的 `APP_VERSION`。
   详见 [AGENTS.md](./AGENTS.md) §2 / §3。

## 与原生的关系

- 真机：页面依赖壳提供的 `capsule.js`（产物 HTML 里由构建期注入 `<script src="/sdk/capsule.js">`，跟随当前页面主机），`invokeNative()` 直达原生；
  原生能力探测通过就走真实实现，**不会有任何告警**。
- DEV 浏览器 / 平台预览：SDK 不可达，仅开发模拟可降级到 [`src/shared/bridge/mock.ts`](./src/shared/bridge/mock.ts) 里的 mock 实现，页面不会白屏。
- **预览里的缺口会提示到 DevServer 终端**：`npm run dev` 时如果调用了"没有 mock 实现"的原生能力，终端会打印
  `[native] ⚠ 原生能力缺口`，同时页面控制台有一条 `console.warn`，提醒你**该能力必须到 App 壳（真机）内验证**；
  命中的是模拟实现时会打印 `ℹ 预览环境提示`（返回的是假数据）。同一条信息只提示一次，不会刷屏。
  用 App 壳连本 DevServer 做**真机预览**时壳会提供 SDK、走 native，不会出现这些提示；
  若那时仍看到提示，说明壳没提供 SDK（多半用的不是支持端能力的壳）。
- 能力清单与调用规范见 **capsule-native-api** skill。
- 存储、相机、定位、蓝牙等能力需要**先同意隐私协议**（由壳统一管控），未同意时调用会失败并归一到
  `BridgeError.code === 'privacy'`；`useBridgeTask` 已经把这个分支提示成人话。
