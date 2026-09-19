# Flight Lens 前端实现交接

## 当前状态

- 工作目录：`/Users/hanyang/Desktop/flights-meta-search-apple-ui`
- 分支：`codex/flightlens-apple-liquidglass`
- 仅本地预览；未提交、未推送、未创建 PR。
- 页面布局已经从旧版整体重构，不再以 v3 的卡片结构为约束。

## 设计依据

- Apple 设计规范：`awesome-design-md/design-md/apple/DESIGN.md`
- 动效规范：`emilkowalski-skills` 中的 Apple、animate 与 review-animations 资料
- 玻璃组件：用户提供的 React Bits `GlassSurface-JS-CSS` 源码
- `ybouane/liquidglass` 仅是早期视觉调研资料，当前没有运行时依赖。

## 当前交互

- 搜索页支持居中的对话找票 / 精确筛选胶囊、统一的精确筛选控件与分阶段百分比进度。
- 结果页顶部只保留搜索、结果、来源与账户；价格中心不再重复出现。
- 结果页向下滚动时，品牌胶囊移到左侧，导航与账户组成右侧纵向栏；向上滚动重新聚合。
- 价格判断与搜索覆盖是右侧紧凑胶囊，展开时作为顶层弹层，不挤压结果列表。
- 结果卡片可加入“心选”；右下角计数按钮打开持久化比较面板。
- 默认头像是飞机，账户面板允许上传、压缩并保存自定义头像。

## GlassSurface 约束

- 组件实现位于 `apps/web/src/glass-surface.tsx`，适配层位于
  `apps/web/src/liquid-glass-surface.tsx`。
- 每个表面使用唯一的 SVG filter / gradient / displacement ID。
- 活跃表面使用 RGB 三通道 `feDisplacementMap`，由 `ResizeObserver` 在尺寸改变时刷新。
- 不使用 WebGL、DOM 截图或逐帧渲染；页面中不应出现玻璃渲染 canvas。
- Chrome 支持完整 SVG backdrop filter；Safari、Firefox、强制减少透明度和不支持该能力的环境使用高对比度 fallback。
- E2E 通过 `data-glass-engine`、`data-glass-state` 与 `data-glass-fallback` 核验增强和降级状态。

## 动效约束

- 导航切换使用共享选中指示器和淡入位移，不改页面布局。
- 顶栏拆分与聚合只动画 transform、opacity、border-radius 和有限的尺寸属性。
- 价格、覆盖和心选弹层使用 GSAP 从触发按钮的实际矩形映射到最终面板。独立的轻量形变层只动画 `transform`、`opacity` 和圆角，面板本身以 260ms 的位移/透明度进入；不再缩放大面积滤镜内容，也没有弹簧回摆或果冻过冲。
- 顶栏使用灰白半透明磨砂场景。结果页滚动超过阈值后拆成左右纵向胶囊，只有回到页面顶端才重新融合；拆分后结果排序筛选栏吸附到页面顶部。
- 价格判断、来源覆盖和心选是右下角三个独立胶囊，使用统一宽度与间距。价格和来源位于心选上方，打开内容以顶层弹层呈现，不挤压结果列表。
- React Bits GlassSurface 的场景层保持透明，直接折射组件背后的真实页面内容，因此滚动时玻璃内的内容会同步变化。面板只使用保证文字对比所需的透明染色；不使用实色垫底、网格、渐变或装饰纹理。
- 结果、报价详情、心选和来源详情中的机场信息统一以中文机场/城市名为主标题，IATA 三字码作为小字号辅助信息。
- `prefers-reduced-motion` 移除位移与形变，`prefers-reduced-transparency` 改为实色表面。

## 验证

- Web TypeScript、ESLint、单元测试与生产构建。
- Playwright 桌面和移动项目覆盖搜索、结果、详情、价格提醒、来源、账户、滚动导航、心选、GlassSurface 增强/降级和 axe 无障碍检查。
- 浏览器人工检查玻璃折射、导航右侧对齐、弹层中间帧和最终帧，不接受遮挡、横向溢出或不可点击控件。
