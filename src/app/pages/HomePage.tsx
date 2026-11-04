import appNotGenerated from '@/assets/app-not-generated.svg'

/**
 * 脚手架占位页：工程刚生成时只有这一页，作用只是"能跑起来 + 有个能改的入口"。
 *
 * **交付前必须替换**：把这一页换成用户在需求里要的第一屏（页面结构、内容、导航都来自需求），
 * 或删掉它、新建用户要的页面。需求里没提到的页面 / Tab / 卡片 / 统计一个都不要加
 * （见本工程 AGENTS.md §10）。门禁 G47 会检查占位页是否已被替换。
 *
 * UI 上是「应用尚未生成」默认态（产品口径、视觉按设计稿）：平台图标 + 一句说明，
 * 相对视口水平垂直居中。替换说明只留在本注释与文档里，
 * 不要把"占位 / 骨架 / 按需求替换"这类写给 Agent 的话写进界面。
 *
 * 这一页**不声明顶栏标题**：此刻还没有业务，顶栏不该先渲染出来（否则会把 `APP_NAME`
 * 这类脚手架占位值显示在顶栏）。业务页调 `usePageTitle()` 声明标题后顶栏才出现。
 *
 * @scaffold-placeholder
 */
export function HomePage() {
  return (
    <div className="flex min-h-full flex-col items-center justify-center gap-4 px-4 pb-safe-bottom">
      <img src={appNotGenerated} alt="" className="size-12" />
      <p className="text-body font-light text-muted-foreground">应用尚未生成</p>
    </div>
  )
}
