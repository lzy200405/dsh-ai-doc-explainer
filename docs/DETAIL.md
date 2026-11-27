# 文档阅读助手

## English summary

While reading a Word, PDF or Markdown file in DSH's right Sidebar, select text and
click **Ask AI** to send the passage (with its source) into the current
conversation. The question is saved as a “question” annotation and the settled
assistant reply is appended to the same annotation (`Q: … / A: …`); asking again
about the same passage appends another round to that thread. Click **Annotate**
to store the selection and your note. The **Document notes** page lists
annotations per document: **Locate** switches back to the document, scrolls to
the quote and selects it, annotations are painted inside the preview with the
browser's CSS Custom Highlight API (blue = note, green = question), and clicking
a painted highlight opens the notes page focused on its card. **Quote** puts an
annotation back into the composer. Annotations live in the profile storage domain
`doc_reader` and are shared across sessions, not written into the workspace.
Scanned PDFs, images and spreadsheets have no selectable text; whole-document
annotations still work. Word selection depends on the local LibreOfficeKit
conversion. Highlights are computed from rendered text, so a PDF page that has
not been scrolled into view yet highlights after it renders, and a duplicated
sentence locates its first occurrence. Question/answer threads live in the note
(4000-character ceiling), so very long threads drop their oldest lines.

The Chinese sections below describe the same behaviour in detail.

在 DSH 的文档预览中选中文字，直接向当前会话的 AI 提问；把阅读中产生的想法保存为批注，下次打开同一文档仍然能看到。

## 它解决什么

- 读到不理解的一段，不必离开阅读界面去搜索：选中 → 问 AI → 在当前会话得到回答。
- 值得记录的想法、疑问、待办：选中 → 批注，随文档保存。
- 想接着追问：在「文档批注」面板里点「引用」，把原文和你的批注插回输入框。

## 支持哪些格式

文档的解析、渲染和 PDF 转换全部由 DSH 内置的文档预览完成，插件不解析文件：

| 格式 | 阅读 | 选中提问 | 批注 |
| --- | --- | --- | --- |
| `.docx` / `.doc` | 内置预览（LibreOfficeKit 转 PDF） | 依赖转换后的文字层 | 支持 |
| `.pdf`（文本型） | 内置预览（pdf.js + 文字层） | 支持 | 支持 |
| `.md` / `.markdown` | 内置预览（Markdown 渲染） | 支持 | 支持 |
| `.pptx` / `.ppt`、`.html`、`.txt`、代码 | 内置预览 | 支持（有文字层时） | 支持 |
| `.xlsx`、图片、扫描版 PDF | 内置预览 | 不支持（表格交互或无文字层） | 整篇批注仍可用 |

## 怎么用

1. 在右侧栏打开一篇文档（文件树里点击，或对话里的文件链接）。
2. 选中一段文字，点预览头部的「问 AI」：
   - 选一个快捷问题，或自己写；
   - 「发送」把「来源 + 引用原文 + 问题」发到当前会话，并把问题保存成一条「提问」批注；
   - AI 回答完成后，回答会自动追加到这条批注里（`问：… / 答：…`）；
   - 对同一段原文再次提问，会追加到同一条批注的问答线程，而不是新建一条；
   - 「仅引用」只把引用插到输入框，由你决定何时发送。
3. 选中文字点「批注」：写备注并保存；未选中文字时保存的是整篇文档批注。
4. 点「批注列表」按钮，或在右侧栏的引导页里打开「文档批注」：
   - 每条批注的「定位」会切回文档标签页，滚动到原文并选中它；
   - 「高亮全部」把这篇文档的批注在预览里画出来（蓝色=批注，绿色=提问）；
   - 文档标签页处于激活状态时，批注会自动以同样方式高亮；
   - **在预览里点击一处高亮**，会打开「文档批注」并滚动到对应的批注卡片；
   - 面板里还可以编辑、删除、引用批注，或切换查看其他文档。

## 文内高亮怎么实现的

预览本身由 DSH 内置的文档预览渲染，插件不修改它的 DOM。高亮使用浏览器的
**CSS Custom Highlight**（`CSS.highlights` + `::highlight()`）：插件按文本内容在
预览的文本节点里定位原文，把对应的 Range 注册为一个高亮，浏览器负责绘制。
因此高亮不会破坏预览的选择、缩放和 React 渲染，也不需要改写文档内容。

- Markdown、HTML、纯文本与已渲染的 PDF/Word 页面都能高亮；
- PDF 的文字层是懒加载的：还没滚动到的页面暂时没有文字，滚到附近后高亮会自动补上；
- 扫描版 PDF、图片没有文字层，无法高亮或定位。

## 数据存在哪里

批注保存在 DSH 的 Profile 存储域 `doc_reader` 中（`$DSH_HOME/storages/doc_reader`），按文档全局共享，不区分会话：

- 不写入你的工作区，不修改文档本身；
- 只有你主动发送的问题会进入会话，进而交给模型；
- 记录包含原文摘录、备注、创建/更新时间、文档路径和创建来源会话 id。

## 限制

- 选区来自浏览器当前选中的 DOM 文字；没有文字层的 PDF（扫描件）和图片无法选中，插件不会自动做 OCR。
- Word 的选区能力取决于本机 LibreOfficeKit 是否能完成转 PDF；转换失败时预览本身仍可用，整篇批注仍然可用。
- 文内高亮按文本内容定位，重复的句子会定位到第一处；PDF 未渲染的页面暂时无法高亮，滚动到附近后自动补上。
- 「定位」需要一个已经打开（或保存过文档地址的）文档标签页；两者都没有时会提示先打开文档。
- 问答线程保存在批注的备注里（DSH 备注上限 4000 字符），线程过长时较早的内容会被截断；回答只在该会话的对话里出现且轮次结束时才会归档。
- 一篇文档的批注不按会话隔离：在不同会话里打开同一文档，看到的是同一份批注。
- 文件被移动或改名后，旧批注按路径无法自动关联到新位置。

## 隐私与安全

- Host 侧只服务一个同源 JSON 接口，请求先经过 DSH 的 Connection 信任围栏（Host/Origin 校验与浏览器登录凭据）。
- 接口只做批注记录的新增、查询、修改、删除；不接受文件路径读取，也不执行任何文件系统操作。
- 请求体上限 64 KiB，字段长度按上限校验，Host 自行生成 id 与时间戳。
