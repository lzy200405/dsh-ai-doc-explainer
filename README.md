# dsh-ai-doc-explainer

DeepSeek Harness（DSH）的文档阅读解释与批注插件：在 Word / PDF / Markdown 预览里选中文字向当前会话的 AI 提问，自动归档问答，保存批注，并在文档内高亮与跳转。

A DSH document-reading assistant: ask the current conversation's AI about selected text in Word/PDF/Markdown previews, archive the Q/A threads as annotations, highlight them in place, and jump back to the quoted passage.

## 功能

- **选中即提问**：在文档预览里选中文字 → 工具栏「问 AI」→ 问题连同来源和引用原文进入当前会话；
- **问答自动归档**：问题保存为一条「提问」批注，AI 本轮回答结束后自动追加 `答：…`；对同一段原文继续提问会追加到同一条问答线程；
- **批注**：选中文字保存备注，未选中时保存整篇文档批注；**备注可以为空**，只保留颜色标记；保存后停留在当前阅读位置，不再自动跳到批注面板；
- **悬浮预览**：鼠标悬停在文内高亮上，直接浮出这条批注/问答的摘要；点击高亮才进入批注面板；
- **颜色标记**：每条批注可选黄、蓝、绿、粉、橙五种颜色，文内高亮与卡片上的颜色圆点同步，点圆点即可切换；
- **文内高亮**：使用浏览器的 CSS Custom Highlight（`CSS.highlights`）在预览上直接绘制，不修改文档 DOM；
- **定位与跳转**：批注面板「定位」切回文档、逐步滚动加载并选中原文；在预览里点击高亮会打开面板并聚焦对应卡片；
- **批注面板**：折叠/展开、继续提问、引用到输入框、编辑、删除、切换文档；右上角 `A-` / `A+` 调整批注与回答字号，选择会被记住；
- **切换更顺**：批注列表按文档缓存，切回预览立即重画高亮，避免重复加载和闪动；
- **持久化**：批注（含颜色标记）保存在 DSH profile 的 `doc_reader` 存储域，按文档全局共享，不写入工作区。

## 安装

把本目录作为本地插件目录安装：

1. 在 DSH 的 **插件（Plugins）→ 添加插件（Add plugin）** 中选择本目录；或
2. 使用 `plugin_manager` 的 `install_bundle`，`target` 指向本目录。

安装后在任意会话的右侧栏文档预览中即可使用。Host 端只依赖 Node 内置模块与 DSH 注入服务，Client 端无需额外安装依赖。

## 开发

```sh
node scripts/build-client.mjs          # 由 client.src.js + vendor/katex.min.js 生成 client.js
node test/annotations.test.mjs
node test/service.test.mjs
node test/route.test.mjs
node test/client-smoke.mjs
node --check index.js
node --check client.js
```

`client.js` 是构建产物，请修改 `client.src.js` 后重新构建。`test/client-smoke.mjs` 用桩替换模块加载器、React 和 Cordis 服务，执行真实的客户端 `apply` 并渲染注册的面板；它不是浏览器，只验证接线与结构，不验证像素。

以下环境检查需要 Desktop Electron 运行时（`ELECTRON_RUN_AS_NODE=1`），用于验证 Word→PDF 转换与 PDF 文字层：

```sh
test/libreoffice-chain.mjs   # Word -> PDF conversion
test/pdf-fonts.mjs           # embedded fonts and /ToUnicode maps
test/pdf-text-chain.mjs      # text extraction attempt
```

## 结构

| 文件 | 用途 |
| --- | --- |
| `index.js` | Host：打开 `doc_reader` 存储域、提供 `/doc-reader/api`、健康记录 |
| `lib/annotations.js` | 批注校验与记录造型（纯逻辑，可单测） |
| `client.src.js` | 浏览器端源码：工具栏入口、提问弹窗、批注面板、高亮/定位、问答归档 |
| `client.js` | 浏览器端构建产物（含 vendored KaTeX） |
| `vendor/katex.min.js` | KaTeX 0.19.1，用于渲染回答中的公式（MIT） |
| `scripts/build-client.mjs` | 把 KaTeX 与 `client.src.js` 拼接为 `client.js` |
| `locale/*.json` | 插件管理器元数据（中/英） |
| `docs/DETAIL.md` | 插件详情页文档 |
| `icon.svg` | 插件图标 |
| `test/` | 单元测试、冒烟测试与环境验证脚本 |

## 支持范围与限制

- 预览、PDF 转换与文字选择由 DSH 内置的 `@deepseek-ai/dsh-client-ui-sidebar-documentpreview` 提供，本插件不解析文档；
- Word 选区依赖本机 LibreOfficeKit 转 PDF；扫描版 PDF、图片没有文字层，只能保存整篇批注；
- 高亮按文本内容定位，重复句子会定位到第一处；PDF 未渲染的页面会在滚动到附近后补上高亮；
- 问答线程保存在批注备注中（DSH 备注上限 4000 字符），过长时较早内容会被截断；
- 回答归档发生在会话轮次结束时；离开会话后回来会补记仍在历史窗口内的回答。

## 第三方

- [KaTeX](https://katex.org/) 0.19.1，MIT License，见 `vendor/LICENSE.katex`。
