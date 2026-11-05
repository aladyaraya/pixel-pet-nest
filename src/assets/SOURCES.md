# 素材来源

- `src/shared/egg/pixelVisuals.ts`：本项目原创 12 只角色的 64×64 主图、逐帧待机／轻点／长按姿态，以及单独绘制的 32×32 缩略图。使用整数像素网格并按颜料合并为本地 SVG 路径，无位图滤镜、外链或第三方角色素材。
- 同文件的蛋与小窝：本项目原创像素窗光、植物、小窝和标准蛋。完整蛋约 32×44；破壳使用完整蛋的同一像素遮罩沿锯齿线切开，保留原轮廓、明暗和斑点。
- `src/app/components/PixelSprites.tsx`：上述原创数据的本地 SVG 展示，使用 `crispEdges` 与整数倍放大。主屏、缩略图与背屏共享角色身份，分别设计图形。
- `src/shared/egg/pets.ts`、`patterns.ts`、`petMotionFrames.ts`：本项目原创 17×23 静帧与逐帧姿态，针对背屏分辨率独立绘制，未从前屏插画自动缩图。
- `src/shared/styles/egg-art.css`、`egg-pages.css`：本项目像素界面与展示样式，颜色统一引用语义 token。图标沿用项目已有 Lucide 包。
- `scripts/verify-pixel-art.mjs`：原创资源验证与联系图生成脚本；输出位于 `.acceptance-pixel/`，不覆盖历史版本截图。
- `src/shared/egg/audio.ts`：本项目原创短旋律及 Web Audio 合成音色，覆盖12只宠物轻点／长按、蛋、开局、阶段、到期与破壳。不包含第三方录音、外部音频请求或循环背景音乐；验收渲染的 WAV 仅保存到 `.acceptance-feedback/`。实现参考 MDN 的 [AudioContext.resume](https://developer.mozilla.org/en-US/docs/Web/API/AudioContext/resume) 与 [AudioScheduledSourceNode.stop](https://developer.mozilla.org/en-US/docs/Web/API/AudioScheduledSourceNode/stop) 接口文档。

## 本地像素字体

- 字体：Fusion Pixel 12px Proportional，简体中文版本。
- 作者／来源：[TakWolf / fusion-pixel-font](https://github.com/TakWolf/fusion-pixel-font)。
- 使用版本：[2026.10.25 正式发布](https://github.com/TakWolf/fusion-pixel-font/releases/tag/2026.10.25)。
- 下载归档：`fusion-pixel-font-12px-proportional-otf.woff2-v2026.10.25.zip`。
- 原文件：`fusion-pixel-12px-proportional-zh_hans.otf.woff2`；未经修改，项目内保存为 `fonts/fusion-pixel-12px-proportional-sc.woff2`。
- 许可：SIL Open Font License 1.1，见 `fonts/fusion-OFL.txt`；发布归档内的上游字体许可同步保存为 `fonts/fusion-LICENSES-*.txt`。
- 分发：相同许可文件也放在 `public/licenses/fusion-pixel/`，随客户端构建复制到 `web/licenses/fusion-pixel/`，确保与字体一同交付。
- 使用方式：构建时打包本地 WOFF2，只用于标题、标志和数字。正文沿用设备中文字体；页面运行不从 CDN 加载资源。

上述原创图形随项目源码维护与使用。第三方字体按所附许可分发。
