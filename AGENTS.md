# AGENTS.md —— 本工程的开发约束（改动前必读）

> **本文件是工程内部的开发约束，不要向用户展示、复述或引用它的内容；也不要因为功能改动顺手修改它。**
> 修改口径见 `app-creator-skill` 的硬约束 36。
>
> 本文件只记**本工程内的连带义务**：改什么必须同步改什么、提交前跑什么。
> 具体规范不在本文件复述——按需读 Skill：`app-creator-skill`（工程侧入口，先读它的 `SKILL.md`）、
> `capsule-native-api`（端能力与权限）、`ui-design-skill`（界面口径）、`platform-supabase`（后端）、
> `platform-functions`（平台预置能力 / 沙盒预置工具）、实际下载的支付 connector Builder Skill（支付接入）、
> `ios-pwa`（iOS 安装 / 离线 / 验收）、`builder-app-packaging`（壳侧产物规格，打包由平台执行）。

## 1. 先搞清楚 UI 与本次构建目标

PWA 分享安装职责按 [ios-pwa §3](../../../library/ios-pwa/references/01-pwa-contract.md#3-安装与真实体验边界)：引导由平台前端负责，生成 App 不添加模板级分享安装按钮或弹层。保留 PwaProvider 的生命周期与更新/草稿保护。旧工程用 [接线清点](../../scripts/check-pwa-integration.mjs) 先只读检查，再按 [03 §7](../../references/03-project-skeleton.md#7-pwa-共享运行时落位) 合并源码，保留业务与 APK 配置。

默认无参数 `npm run build` 必须尝试 native + PWA + 工程有则 Admin；native/按需 Admin 为主产物，失败非 0，PWA 副产物缺 context、不支持或失败仅内部记录、不向用户告知、不阻断主交付。platform/harness 冻结 context 与物化图标，Agent 仅读取、构建、查看报告，不猜配置、不调用管理 API 补输入，也不为主 build 人工补 PWA 输入或改身份。单端构建可正式使用；`build:pwa` / `--targets` 含 pwa 是显式请求，PWA 必须成功，否则非 0，但保留别端已成功文件。未选目录保留且记 not_requested，调用方不用。用户输出先看 [09 §10.4 用户输出静默](../../references/09-deployment.md#104-默认伴随-pwa-失败的用户输出静默)；目标/context/报告唯一契约见安装的 app-creator-skill `references/09-deployment.md §10`，PWA-only 不要求 signing/壳 manifest，下文壳接口与方向保证不套给 PWA。

`npm run build` 产出**互不依赖**的目录。Admin UI（管理后台）是**按需能力**——
空白脚手架生成的工程**不带**后台（没有 `admin.html` / `src/admin/` /
`vite.config.admin.ts`），需要时按 `app-creator-skill` 的「管理后台的增删」加入：

| 入口 | 界面 | 面向 | 构建产物 | 去向 |
| --- | --- | --- | --- | --- |
| `index.html` | App UI（移动端 H5） | 手机 App 内 | `dist/client/web/**` | 与 `capsule/` 一起构成壳侧 bundle，**打进 APK** |
| `index.html`（同 App 源码） | PWA App UI | Safari / 主屏幕 Web App | `dist/pwa/**` | 平台托管与独立核验，见 Skill `09 §10` |
| `admin.html`（按需） | Admin UI（桌面为主、手机可用） | 运营 / 管理 | `dist/admin/**` | 整目录拷到静态服务器 |

- 工程含后台时，两个入口在**同一个 DevServer** 上：`http://127.0.0.1:5173/`（App UI）、
  `http://127.0.0.1:5173/admin.html`（Admin UI）。
- 各目标产物**不得互相引用**（不共享 chunk、不互相 import、不写死对方路径），必须能各自单独部署。
  共享代码放 `src/shared/`，由各目标各自打包一份。
- 不要为了"复用"把 Admin UI 的页面挂进 App UI 的路由，也不要给 Admin UI 加原生能力调用。
- Admin UI 必须守住"桌面为主、手机可用"：交付前按最低能力线与 375px 走查、页面用
  `src/admin/components/` 的原语拼、在真实浏览器里跑验收。工程口径见 `app-creator-skill` 的
  `references/07-mobile-adaptation.md` §9 / `references/19-admin-page-inventory.md` /
  `references/18-admin-browser-validation.md`，设计口径见 `ui-design-skill` 的 `references/03-admin-ui.md` §9。
  验收配置 `admin-browser-cases.json` 随工程保留；报告与视觉签核（`.admin-browser-report/`、
  `.admin-visual-review.json`）本地留存、不提交。平台不代跑验收。

## 2. 交付 native 时回头维护 `capsule/`

本节及 §3 是 native 的义务；PWA-only 不执行壳 manifest/signing 校验，但后端与实际业务能力声明仍要维护。

`capsule/` 是壳侧交付信息的**源码**（构建时由 `scripts/finalize-build.mjs` 复制进 `dist/client/`）。

| 什么时候 | 必须同步改什么 |
| --- | --- |
| 新增/删除任何原生能力调用（`invokeNative(...)`） | `capsule/manifest.json` 的 `permissions`（见 §3） |
| 应用名变化 | `capsule/manifest.json` 的 `name`；`src/shared/config/app.ts` 的 `APP_NAME` |
| 版本发布 | `capsule/manifest.json` 的 `version` 与 `versionCode`（`versionCode` **每次 +1**）；`src/shared/config/app.ts` 的 `APP_VERSION` |
| 新增页面目录 / 改首页位置 | `capsule/manifest.json` 的 `entry`（默认 `web/index.html`，指向 `dist/client/` 内的相对路径） |
| 改应用运行的屏幕方向（锁定竖屏 / 横屏 / 跟随） | `capsule/manifest.json` 的 `orientation`——**只改这一处**（应用运行方向的唯一来源，取值 `portrait` / `landscape` / `auto`＝已适配横竖屏、旋转不加补偿；门禁 G52 会校验，口径见 §14） |
| 新增数据表 / 改表结构 | `supabase/migrations/` 下**新建**迁移文件（不改已执行的）；页面读写经 `src/shared/track.ts`（见 §9） |
| 换桌面图标 / 应用名 | **不要改源码**：以平台项目设置为准（用户明确要求时按 `platform-functions` Skill 的图标分册调用 `update_app_profile`）；`capsule/icon/` 与 `manifest.json` 的 `name` 只在项目没有设置时兜底，打包时会被项目设置覆盖 |
| 换签名证书 | 用正式证书覆盖 `capsule/signing/capsule.p12` + `capsule.properties`，**不要**擅自换回调试证书 |

`npm run build` 会校验上述一致性（版本号、`permissions` 取值、`entry` 指向），并拦下
XML/HTML 注释里的连续两个横杠 `--`（写注释时别带 CSS 变量名 `--brand-600` 这类内容）。
字段与取值的权威定义见 `builder-app-packaging` 的产物规格。

## 3. 危险能力必须写进 `permissions`

构建期 `permissions` 只有 7 个合法值，写白名单以外的值会让构建失败。
**没声明的危险能力，APK 里就没有对应权限**：运行时系统静默拒绝（不弹框），H5 只会看到
`xxx:fail cancel`；此时引导用户去系统设置也没用，只能重新打包。

合法取值、接口 / 页内摄像头 → 权限的对应关系、拒绝语义，一律查 `capsule-native-api` 的
`references/03-permissions.md` 与 `builder-app-packaging` 的产物规格，**不要凭记忆写接口名或权限名**。

## 4. 禁止线上 CDN 与外部静态资源

- 页面里**不得**出现任何外部静态资源（`https://cdn...`、外部字体 / 图标 / 图片）；
  需要就下载到 `src/assets/`（或 `public/`），依赖一律走 `package.json`。
- 壳桥接 SDK `/sdk/capsule.js` 只在 native 构建期注入，Admin / PWA 不带，**不要手写进源 `index.html`**；
  native/Admin CSS / JS 用 `base: './'` 相对路径；PWA 按可信 context 的版本资源路径构建，
  不要写 `/assets/` 或 `/vendor/` 这类共享站点根路径。来源与派生见 `app-creator-skill` 的 `references/09-deployment.md` §10。
- 第三方业务 API 统一走 `src/shared/api` 的 `http()`：native 用原生 `request` 代发、无 CORS；
  browser/PWA 经共享 browser adapter 的真实 `fetch`，需后端 CORS / 用户授权；
  平台内置后端的数据 / 云函数用 `src/shared/track.ts`（见 §9）。
- **不要用 `window.location.origin` 拼后端 / 外部服务地址**：后台会被部署到任意静态 host，
  `origin` 指向静态文件。平台后端地址由平台注入；支付网关按 §7 的取址规则；
  自建 / 第三方后端走显式构建期配置，**配置缺失要报错，不能回退同源**。
- **不得运行时动态注入脚本**：不要 `createElement('script')` + `script.src`、`document.write`、
  `eval` / `new Function`；按需加载用字面量 `import()`。判据与重库准入见 `app-creator-skill` 的
  `references/10-webview-runtime.md`（发布扫描会按 CWE-829 阻断，门禁 G57）。
- 图标与图片素材要贴合项目、下载到本地后再 `import`；素材来源登记在 `src/assets/SOURCES.md`。

## 5. 样式与移动端适配

这里只列**本工程的约定落点**，完整判据按索引去读，不要在本文件找第二份：

- 颜色只走语义 token（`src/shared/styles/tokens.css` → `tailwind.config.js`），组件里禁止色值字面值；
  只加一套值、不做 `dark:` 变体或配色切换（门禁 G10）。
- **交付前必须换掉骨架默认主色**（门禁 **G48**）；确需沿用（品牌本身就是这个蓝）时在注释里写明理由
  并加 `brand-kit: keep-default`。配色推导见 `ui-design-skill` 的 `references/09-color-system.md`。
- 高度用 `h-dvh` / `min-h-dvh` / `h-svh`（或模板 `h-screen-dvh`），**不要写 `100vh`**，
  也不要用行内 `style` 写高度；老内核兜底已在模板里。口径见
  `app-creator-skill` 的 `references/07-mobile-adaptation.md` §1。
- 安全区用模板 `src/shared/native/safe-area.ts` 分流：native 真机读壳、DEV 模拟；
  PWA 保留真实 env，画布用 CSS probe 解析，**不能被模拟 px 覆盖**。
- 状态栏 / 滚动条 / 轻提示都用模板封装：`initStatusBar()` / `useStatusBarStyle()` **仅 native**
  （PWA 只用 meta default，不承诺原生前景控制）、`.ui-app`（默认隐藏滚动条，只有用户明确要求才加
  `.show-scrollbar`）、`useToast()`（App 端只说一句话）。顶部垫色 / 穿透的页面级例外按
  `references/07-mobile-adaptation.md` §2，状态栏按 §8；Toast 形态见 `ui-design-skill` 的
  `references/02-app-ui-mobile-h5.md` §6。门禁 G58 会拦滚动条、G44 会算对比度。
- 字号 / 间距 / 圆角 / 描边 / 密度 / 顶栏内容按 `ui-design-skill` 的分册；新增字号或发丝线档位
  **必须同步登记 `src/shared/lib/cn.ts`**（门禁 G45）。交付前跑 `app-creator-skill` 的
  `scripts/validate.mjs`（G42 / G44 / G45 / G46）。

## 6. 原生能力在 dev 与真机下的差异

- **在线预览**没有壳，SDK 不可达，桥接层自动回落到 mock，DevServer 终端会打印 `[native] ...` ——
  这是提醒你去真机验证，不是 bug。
- **真机预览**里仍看到「浏览器预览」的提示，说明壳没提供 SDK（多半用的不是支持端能力的壳）。
- 生产构建里不存在任何 mock / 上报逻辑；**不要**为了"预览方便"给生产产物加兜底。

## 7. 要收费 / 加会员时：先发现并下载支付 Skill

PWA 先按 app-creator-skill `references/12-runtime-config.md` 核对支付 Web 契约准入；未契约不继承 PAY_TOKEN、不把 native 深链当唯一回跳。下面托管/原生回跳只适用已批准的 native 路径，不能当浏览器已支持的证明。

先读 `app-creator-skill` 的 `references/13-plugin-connector-integration.md` 的「支付能力发现与下载」，
按回执中的路径与版本加载对应 connector 的 Builder Skill；商品、下单、权益核销与深链一律按它的契约接入，
**禁止手写支付弹窗、自己拼支付宝跳转链接、自己维护权益读写**。

- 该 Skill 的 `assets/` 是**参考实现**：组件放 `src/shared/ui/`、适配模块放 `src/shared/lib/`；
  视觉用本工程的语义 token（**不要保留参考实现里的色值字面值**），移动端按
  `references/07-mobile-adaptation.md` 收敛，新增依赖走 `package.json`。
- 后台「支付宝收款商品」走支付网关：**IDE 预览用同源 `/api/pay`**；**测试 / 生产读取平台注入的
  `VITE_PAY_BASE`**（保留网关路径前缀，缺失或无效时明确报错）。**不得用 `window.location.origin`
  拼地址、构建产物也不要回退当前域名的 `/api/pay`**。

## 8. 提交前

```bash
# 先核对平台 VIBE_PWA_CONTEXT_PATH 或工程 pwa-build-context.json 与本地图标
npm run typecheck   # 类型门禁：tsc --noEmit
npm run build       # 依赖自愈 + native + PWA + 工程有则 Admin
node <app-creator-skill>/scripts/validate.mjs . --build # 默认 all 主产物严格，G61 单独非阻断
```

> **类型检查与本次目标构建都要跑，且构建通过不等于类型没问题**——构建只产出产物、不跑类型检查。

- 默认 build 尝试 native + PWA + 按需 Admin；主产物失败非 0，伴随 PWA 失败仅内部记录、
  对用户静默、不阻断主交付；显式 `build:pwa` / `--targets` 所选目标均严格。
- 单端 `build:client` / `build:admin` 可正式交付，只碰所选目录，不取未选旧产物；
  显式 Admin 缺后台三件套直接失败，默认无后台自动跳过，不为此改 `package.json`。
- **同工程 build 互斥**；依赖安装锁不代表允许并发 build。只按本轮 `dist/build-report.json` 的
  success 目标核验 / 发布，不凭残留目录或历史单端结果判成功；多端交付用默认 `validate.mjs . --build` 收口。
  退出码 0 仍要内部核对 warnings / PWA 状态；报告不公开，PWA failed 不返回入口。
- 构建锁 / 报告 / 失败收尾 / 单端范围只查 [09 §10](../../references/09-deployment.md#10-pwa-目标与平台构建上下文)，
  用户输出先看 [§10.4](../../references/09-deployment.md#104-默认伴随-pwa-失败的用户输出静默)。
  旧沙箱须更新 Skill 与模板脚本，不假定消费方已更新；旧双构建性能不代表新三构建实测。
- 不要提交 `node_modules/`、`dist/`、签名私钥（`.gitignore` 已覆盖）。
- 提交信息里写清：改了什么、为什么改、验证方式与结果、影响面（是否动了 `capsule/`、是否影响各目标产物）。

## 9. 平台内置后端（数据库 / 云函数 / 认证 / 存储）

- 数据读写与云函数调用**统一走 `src/shared/track.ts`**（不要新建客户端、不要写死地址与密钥）；
  注册登录的会话管理走 `src/shared/auth/`（`useAuth()` / `<RequireAuth>`），**不要直接调 `supabase.auth.*`**。
- **登录方式默认（也是唯一）手机号双模式**（`signInWithPassword` / `setPassword` / `signInWithOtp` /
  `verifyOtp`）；`signInWithEmail` / `signUpWithEmail` 与 `track.ts` 的 `signUp` 是**邮箱**备用形态、
  排在成员表最后，别默认用；形态与默认决策见 `references/14-phone-otp.md`。
- 昵称只存用户元数据（`useAuth().updateNickname` / `user.user_metadata.nickname`），不写业务表。
- **前后台登录态互相隔离**：`index.html` / `admin.html` 的 `<meta name="ui-scope">` 与 `track.ts` 的
  `auth.storageKey` 是骨架接好的隔离机制，不要删 / 改错（门禁 G53）。
- 工作区 `.app-login` 为 `zhiyue` 时：入口不挂 `AuthProvider`、不用 `useAuth()`、不写手机号登录页，
  按 `references/15-zhiyue-login.md` 用 `@zyql/auth-core` 做 SSO 再换火山 JWT；业务表不外键 `auth.users`。
- 后台用户管理（管理员 / 用户列表 / 删用户）见 `platform-supabase` 的「管理员与用户管理」；
  **Dev 免登 + 生产严格**（首个管理员 `claim_admin()` 自领）见 `references/17-admin-dev-autologin.md`
  （门禁 G51 / G55）。
- 表结构与云函数是**代码**：迁移放 `supabase/migrations/`（新建、不改已执行的），云函数放
  `supabase/functions/<函数名>/index.ts`；平台在**每轮对话结束时**自动执行 / 部署。完整规则见
  `platform-supabase`，不要按公网通用 Supabase 的教程操作。
- 落地登录后把 `capability.json` 的 `appAuth` / `adminAuth` 置 `true`（见 §14）。

## 10. 只保留用户要的功能（素材是示例，不是需求）

本工程是从 AI Builder 平台的骨架 / 场景样板生成或组装出来的，**初始只有一页占位页**，
其余页面、导航项、示例数据全部是可选的"参考"，不是需求：

- **占位页必须替换**：`src/app/pages/HomePage.tsx` 与 `src/admin/pages/HomePage.tsx` 带
  `@scaffold-placeholder` 标记，交付前必须换成真实页面（或删掉重写）——门禁 **G47** 会检查；
- 动手前先列一张「页面 / 功能 → 用户在需求里提到它的那句话」对照表；**对不上的一律不建**——
  页面文件、路由、导航入口、示例数据与 mock、相关图片资源都不要添加；
- **用户没提到的功能不做**，也不为了填满一屏堆占位信息与假数据（信息架构与功能优先级的判断见
  `ui-design-skill` 的 `references/06-information-architecture.md`）；
- 参考实现（`assets/demo-pages/`、`assets/scenario-samples/`）按需取用，**拷进去必须按需求改造**；
  视觉不是照抄对象，外观必须按需求重新设计；
- `src/**/pages/` 里留着但没接路由的页面会被门禁 **G46** 拦下。

## 11. 音乐素材生成（平台工具 `music_generate`）

需要 App 背景音乐、主题曲、角色歌曲、纪念/祝福歌曲，或做音乐类功能要 demo 素材时，
用平台 MCP 工具 `music_generate` / `music_status`。**调用参数、配额、中断续取、音频体积与落位规则
见 `platform-functions` Skill 的 `references/02-music-generation.md`**，本工程只补充一条：
产物固定落 `src/assets/audio/`，按 §4 的资源规则 `import` 引用、禁止外链。

## 12. 沙箱回收后依赖会丢：先自愈，再排错

- 平台沙箱可能随时被回收，`node_modules/` 会整体丢失。`Cannot find module` /
  `Failed to resolve import` / `Cannot find package 'vite'` 这类报错**先怀疑依赖、再怀疑代码**。
- `npm run dev` / `build` / `typecheck` / `preview` 已内置依赖自愈（前置跑
  `scripts/ensure-deps.mjs`），正常情况直接重新执行原命令即可；手动检查用 `npm run deps`。
- 依赖就绪后仍报同样的模块错误，再回查 `package.json` 与 import 路径（是否漏装依赖）。

## 13. 配置按目标读取；预览读不到注入先排环境

PWA 只读平台以 `VIBE_PWA_CONTEXT_PATH` 指定的 protojson 文件或工程 `pwa-build-context.json`，platform/harness 构建前冻结上下文并物化图标，Agent 仅读取、构建与查看报告；缺输入或不支持只使默认 PWA 副产物失败，仅内部诊断、不向用户告知，见 [09 §10.4](../../references/09-deployment.md#104-默认伴随-pwa-失败的用户输出静默)，不影响主产物，不人工补平台值或改身份；完整字段与校验只查 app-creator-skill `references/09-deployment.md §10`；公开白名单/authMode/状态命名只查 `references/12-runtime-config.md` 的 PWA 段。禁止继承全 env、AbilityAPIKey/PAY_TOKEN、猜身份/地址或私自改登录；zhiyue 未 Web 契约仅阻断 PWA 准入，不影响 native/按需 Admin。下文 `.env.local` 自愈仅既有 dev/native/Admin，不能用它覆盖 PWA context。

- 平台把后端连接信息与 `VITE_PROJECT_ID` 注入 `.env.local`，而 **Vite 只在启动时读一次**；
  页面「服务开通中」、`supabase` 为 `null`、后端数据恒空是**环境问题，不是代码 bug**——
  不要为"预览方便"在业务代码里加配置兜底。
- **绝不 kill / 重启预览服务、不占端口**；把工程 `.env.local` 同步到预览进程实际读取的目录
  （先备份原文件），Vite 会自行重启读到新值。
- 完整定位三步见 `app-creator-skill` 的 `references/12-runtime-config.md`；
  开发期可先用 `scripts/check-preview-env.mjs` 自查。

## 14. 能力标识（`capability.json`）

不添加 ios/pwa 布尔，target 不是业务能力。以下壳方向规则仅 native，PWA-only 不要求壳 manifest，G52 只跳方向/原生段，不跳已有能力/登录/includes 自洽。PWA 横竖屏按真实浏览器适配，不承诺锁定、原生 exit 或智能体能力。

工程根目录的 [`capability.json`](./capability.json) 用五个布尔字段声明**本工程实际实现了哪些能力**
（初始均为 `false`）：

| 字段 | 含义 |
| --- | --- |
| `admin` | 是否交付了可用的管理后台（`src/admin/` 的业务页面）。**骨架自带的空壳入口 / 占位页不算** |
| `supabase` | 是否接入了平台内置后端的**任何能力**（表 / 云函数 / 数据读写 / 登录 / 文件存储 / 向量库）。**平台按本声明决定是否为应用开通后端**——用到而不声明，线上功能会连不上 |
| `payment` | 是否接入了支付（接入支付必然交付后台支付管理页，故此时 `admin` 也应为 `true`） |
| `appAuth` | App UI 是否落地了**用户登录**（用了 `useAuth()` / `<RequireAuth>` / 注册 `/auth` 路由等） |
| `adminAuth` | Admin UI 是否落地了**用户登录**（后台登录还要求 `admin=true`） |

**按真实实现维护**：

- 每轮实现后就地更新：做了后台 → `admin`；接了后端 → `supabase`；接了支付 → `payment`；
  App 做了登录 → `appAuth`；后台做了登录 → `adminAuth`；删掉对应功能 → 字段回 `false`。
- 依赖关系：`payment=true` → `admin=true`；`appAuth` / `adminAuth=true` → `supabase=true`；
  `adminAuth=true` → `admin=true`。
- **应用运行方向只写一处**：`capsule/manifest.json` 的 `orientation`
  （`portrait` 锁竖屏 / `landscape` 锁横屏 / `auto` 已适配横竖屏、不锁定不补偿）。
  `capability.json` 不登记该字段；H5 不做应用级方向锁定或旋转补偿（门禁 G52；
  口径见 `app-creator-skill` 的 `references/07-mobile-adaptation.md` §11）。
- 门禁 **G52** 校验格式与实际自洽（字段语义、`includes` 结构、`admin=true` 时缺 `admin.html` 等）；
  字段口径见 `app-creator-skill` 的 `references/03-project-skeleton.md`。

### 插件 / 连接器的接入登记（`includes`）

`capability.json` 的 `includes` 记录**从平台接入的插件 / 连接器**：

| 字段 | 含义 |
| --- | --- |
| `includes.plugins` | 接入的插件，每条 `{plugin_id, name, version}` |
| `includes.connectors` | 接入的连接器，每条 `{connector_id, connector_name, version}`（`connector_id` 是去重键） |

- 两个数组必须存在（可为空），元素必填字段必须完整；取值从插件清单 / `download_plugin` 回执、
  `list_connectors` / `download_connector` 回执取，**不要猜版本、不要填假值**。
- **每一轮结束前都要核对**：本轮新增、移除、换版的插件 / 连接器都要同步 `includes`
  （**换版 = 更新对应行的 `version`，不新增行**）；声明了但工程里**实际没用到**的接入要
  **在会话里提醒用户清理**。门禁 G52 只校验结构与字段完整性，不做"是否用到"的判定。
- 整合与登记口径见 `app-creator-skill` 的 `references/13-plugin-connector-integration.md`。

## 15. PWA 实现与验收只复用一套机制

运行时字段/环境/MIME/输入常量/Go protojson 零值只引用 [scripts/gen/pwa-contract.mjs](./scripts/gen/pwa-contract.mjs)，类型仍引用 gen TS。三个生成文件都不可手改，由 IDE 开发维护者生成并用跨仓门禁 `--check` 核对；App Agent 只消费安装态文件，不执行跨仓生成命令。完整生成机制见 [09 §10](../../references/09-deployment.md#10-pwa-目标与平台构建上下文)。

工程 [pwa.config.json](./pwa.config.json) 按 IDE `PwaProjectConfig` 仅维护真实主流程必需能力。每轮功能变化同步该列表，平台从同 sourceCommit 冻结进 context；缺配置或冻结列表不一致只让 PWA fail closed，不影响默认 native，显式 PWA 严格。IDE 启用且符合准入的 Web App 默认独立 APK + PWA。旧沙箱要同时更新 Skill、工程 PWA 脚本/生成类型与配置，不通过兼容旧格式或改冻结输入绕过。

类型只引用 `scripts/gen/api/v1/pwa.ts`（及生成 errors），不手写完整跨仓协议。context 不补默认值、不改大小写、不写本地派生图标 hash。原始 iconSource URL/data URI 只能由 IDE builder 安全物化，子进程消费 `VIBE_PWA_ICON_PATH` 的工程内绝对路径；相对图标也校验 realpath 在工程 root 内、PNG/SVG 有效，Skills 不下载远程来源。私有物化路径不进 runtime/报告，背景色沿同源码 tokens 冻结与校验；完整摘要和 wire report 规则只查 [09 §10](../../references/09-deployment.md#10-pwa-目标与平台构建上下文)。

`src/shared/bridge/browser.ts` 与 `browser-capabilities.json` 是 adapter 实现与就近支持白名单，不是完整原生接口清单；已有 adapter 能力经 invokeNative/探测/useBridgeTask，try/catch/finally 收尾，取消静默、网站权限/不支持/超时/错误中文 Toast，不显示 raw。实时 `getUserMedia` 等无 invoke 等价机制可按 app-creator-skill `references/06-js-bridge.md §10` 的例外索引在页面使用，先读 `10-webview-runtime.md`「相机」与 capsule 的页内摄像头唯一规范，落实授权、生命周期与失败收尾，不能用 adapter 禁令取消该路径。mock 仅 DEV，生产无 capsule 不假成功。

本地状态复用已有 `src/shared/lib/storage.ts`；PWA 的环境/应用/ui-scope 隔离按 app-creator-skill `references/12-runtime-config.md` 的 PWA 段执行，不改回共享前缀、不全删 origin 数据；此命名不提供恶意同源脚本强隔离。

`src/shared/pwa/` 的 PwaProvider 在 ToastProvider 内且 HashRouter 下包 App，接线/草稿接口看 app-creator-skill `references/03-project-skeleton.md §7`；SW/多窗口安全确认、脏字段保守阻断与保存后显式 clear 只查 ios-pwa `references/02-offline-and-updates.md`，不另写 SW、不强刷。共享 origin 命名不提供恶意脚本强隔离。

构建复用 `vite.config.pwa.ts` 和 `scripts/{pwa-context.mjs,pwa-context.d.mts,finalize-pwa.mjs,check-pwa.mjs,make-pwa-icons.mjs}`；图标工具用锁定 sharp 本地生成/真实 decode，标准不在本文件复制。默认跑全量 `validate.mjs . --build`（all 主产物严格，G61 独立非阻断），伴随 PWA 失败仅内部记录、不向用户告知，按 [09 §10.4](../../references/09-deployment.md#104-默认伴随-pwa-失败的用户输出静默) 执行；PWA success 后用 `node scripts/check-pwa.mjs .` 专项复核；显式 `--target pwa --build` 为严格 PWA-only 验证，再按 ios-pwa `references/03-validation.md` 分别记录浏览器、最终 HTTPS 与 iOS 真机证据，没测不写真机已过。report 内部消费不公开，ready 由平台独立核验；网关/CORS/私有存储/live 不由工程操作。
