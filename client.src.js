/**
 * DSH Client half of the document reader.
 *
 * Provides three seams on top of the shipped document preview:
 *  - two toolbar actions in the preview header (ask the AI / annotate);
 *  - one right-Sidebar page listing the annotations of a document;
 *  - one frame-wide dialog for composing the question or the note.
 *
 * Rendering, PDF conversion and text selection stay with DSH: this module only
 * reads the current DOM selection and hands text to the official composer API.
 */
window.__ModuleLoader__.load({
  id: '@local/doc-reader',
  factory(require) {
    const React = require('react')
    const h = React.createElement
    // Portals keep the dialog and toast above a full-screen Sidebar (the shell
    // overlay layer sits below it); without react-dom they render in place.
    const ReactDOM = (() => {
      try {
        return require('react-dom')
      } catch {
        return null
      }
    })()

    function Layer(props) {
      if (!ReactDOM || typeof ReactDOM.createPortal !== 'function' || typeof document === 'undefined') {
        return props.children
      }
      return ReactDOM.createPortal(props.children, document.body)
    }

    // KaTeX is vendored ahead of this module (see vendor/katex.min.js) and sets
    // `window.katex`; the require branch covers an environment that exposes it
    // as a module instead. Without either, TeX stays readable as code.
    const katex = (() => {
      const global = typeof window !== 'undefined' ? window : globalThis
      const candidate = global && global.katex
      if (candidate && typeof candidate.renderToString === 'function') return candidate
      try {
        const required = require('katex')
        if (required && typeof required.renderToString === 'function') return required
        if (required && required.default && typeof required.default.renderToString === 'function') return required.default
      } catch {
        // Not exposed to this module; the fallback renders TeX as code.
      }
      return null
    })()

    const NS = 'docReader'
    const TAB_ID = '@local/doc-reader/notes'
    const TAB_KIND = 'doc-notes'
    const ROUTE = '/doc-reader/api'
    /** A captured selection older than this is not used by a toolbar click. */
    const SELECTION_TTL_MS = 2 * 60 * 1000
    /** Matches the Host's quote ceiling so a captured selection always saves. */
    const QUOTE_LIMIT = 2000
    const QUICK_QUESTIONS = ['explain', 'simpler', 'translate', 'terms', 'analyze']

    const zh = {
      'tab.title': '文档批注',
      'guide.title': '文档批注',
      'guide.description': '查看、引用已保存的文档批注。',
      'action.ask': '问 AI',
      'action.askHint': '先在文档中选中文字，再向 AI 提问',
      'action.note': '批注',
      'action.noteHint': '为选中的文字添加批注；未选中时为整篇文档批注',
      'action.notes': '批注列表',
      'action.notesHint': '查看这篇文档的批注',
      'dialog.askTitle': '向 AI 提问',
      'dialog.noteTitle': '保存批注',
      'dialog.source': '来自',
      'dialog.quoteLabel': '选中的原文',
      'dialog.questionLabel': '你的问题',
      'dialog.questionPlaceholder': '例如：这里的并发访问应该如何实现？',
      'dialog.noteLabel': '批注内容',
      'dialog.notePlaceholder': '写下你的想法、疑问或待办…',
      'dialog.send': '发送',
      'dialog.quoteOnly': '仅引用',
      'dialog.save': '保存',
      'dialog.cancel': '取消',
      'dialog.sending': '发送中…',
      'dialog.saving': '保存中…',
      'dialog.noQuote': '未选中文字：这条批注会记录在整篇文档上。',
      'dialog.saved': '已保存，右侧「文档批注」里可以看到它。',
      'dialog.askNeedsSelection': '先在文档中选中文字，再向 AI 提问。',
      'dialog.truncated': '选中的文字较长，已截取前 {count} 字。',
      'dialog.documentNote': '整篇文档批注',
      'dialog.quoteChars': '{count} 字',
      'quick.explain': '解释这段',
      'quick.simpler': '通俗地讲',
      'quick.translate': '翻译成中文',
      'quick.terms': '解释术语',
      'quick.analyze': '分析要点',
      'quick.explain.text': '请解释这段内容的含义。',
      'quick.simpler.text': '请用通俗易懂的语言重新说明这段内容。',
      'quick.translate.text': '请把这段内容翻译成中文。',
      'quick.terms.text': '请解释这段内容中的专业术语。',
      'quick.analyze.text': '请分析这段内容的要点。',
      'message.source': '**文档来源：{name}**',
      'message.note': '**我的批注：** {note}',
      'panel.title': '文档批注',
      'panel.allDocuments': '全部文档',
      'panel.documents': '{count} 篇文档',
      'panel.back': '全部文档',
      'panel.refresh': '刷新',
      'panel.annotateDocument': '整篇批注',
      'panel.noteCount': '{count} 条批注',
      'panel.empty': '这篇文档还没有批注。',
      'panel.emptyAll': '还没有任何文档批注。',
      'panel.emptyHint': '在文档中选中文字，点工具栏的「批注」即可保存。',
      'panel.loading': '加载中…',
      'panel.retry': '重试',
      'panel.typeSelection': '选区',
      'panel.typeDocument': '整篇',
      'panel.typeAsk': '提问',
      'panel.locate': '定位',
      'panel.highlightAll': '高亮全部',
      'panel.askAgain': '继续提问',
      'panel.reanchor': '重新关联',
      'reanchor.bind': '绑定此处',
      'reanchor.cancel': '取消',
      'panel.expand': '展开',
      'panel.collapse': '收起',
      'panel.expandAll': '展开全部',
      'panel.collapseAll': '收起全部',
      'panel.quoteAction': '引用',
      'panel.editAction': '编辑',
      'panel.deleteAction': '删除',
      'panel.deleteConfirm': '确认删除？',
      'panel.confirm': '确认',
      'panel.saveEdit': '保存',
      'panel.cancelEdit': '取消',
      'panel.updated': '更新于 {time}',
      'panel.emptyNote': '（无备注）',
      'panel.selectDocument': '选择一篇文档查看批注。',
      'panel.openFailed': '无法打开批注面板，请稍后重试。',
      'error.network': '无法连接批注服务，请检查连接后重试。',
      'error.unauthorized': '批注服务拒绝了请求，请刷新页面后重试。',
      'error.inputUnavailable': '当前会话不可编辑，无法插入内容。',
      'error.busy': '请等待当前消息发送完成后再试。',
      'error.invalid-note': '批注内容不能为空。',
      'error.invalid-quote': '缺少原文摘录。',
      'error.note-too-long': '批注内容过长（上限 4000 字）。',
      'error.quote-too-long': '选中的文字过长（上限 2000 字）。',
      'error.question-too-long': '问题过长。',
      'error.invalid-document-path': '缺少或无效的文档路径。',
      'error.no-document': '当前没有关联的文档。',
      'error.document-not-open': '请先在右侧栏打开这篇文档，再定位批注。',
      'error.bad-request': '请求格式不正确。',
      'error.internal': '批注服务内部错误。',
      'error.not-found': '这条批注已被删除。',
      'error.payload-too-large': '内容过长。',
      'error.invalid-op': '不支持的批注操作。',
      'error.unknown': '操作失败，请重试。',
      'annotation.askFallback': '（提问）',
      'thread.question': '问：{text}',
      'thread.answer': '答：{text}',
      'thread.qShort': '问',
      'thread.aShort': '答',
      'color.yellow': '黄色',
      'color.blue': '蓝色',
      'color.green': '绿色',
      'color.pink': '粉色',
      'color.orange': '橙色',
      'dialog.color': '标记颜色',
      'panel.color': '切换标记颜色',
      'panel.fontSmaller': '缩小批注文字',
      'panel.fontLarger': '放大批注文字',
      'hover.hint': '点击查看这条批注',
      'toast.saved': '批注已保存。',
      'toast.reanchorHint': '请在文档中选中与批注相同的原文，再点工具栏的「绑定此处」。',
      'toast.reanchorNeedSelection': '没有选中可绑定的原文：请选中与批注相同的那段文字。',
      'toast.reanchored': '已重新关联到选中的位置。',
      'toast.reanchorFailed': '重新关联失败，请重试。',
      'toast.notFound': '没找到这段原文：所在页面可能还没渲染，滚动到附近再试。',
      'toast.locating': '正在文档中查找这段原文…',
    }

    const en = {
      'tab.title': 'Document notes',
      'guide.title': 'Document notes',
      'guide.description': 'Review and reuse saved document annotations.',
      'action.ask': 'Ask AI',
      'action.askHint': 'Select text in the document first, then ask the AI',
      'action.note': 'Annotate',
      'action.noteHint': 'Annotate the selected text, or the whole document when nothing is selected',
      'action.notes': 'Annotations',
      'action.notesHint': 'Review annotations on this document',
      'dialog.askTitle': 'Ask the AI',
      'dialog.noteTitle': 'Save annotation',
      'dialog.source': 'From',
      'dialog.quoteLabel': 'Selected text',
      'dialog.questionLabel': 'Your question',
      'dialog.questionPlaceholder': 'For example: how should concurrent access be implemented here?',
      'dialog.noteLabel': 'Annotation',
      'dialog.notePlaceholder': 'Write down your thought, question or follow-up…',
      'dialog.send': 'Send',
      'dialog.quoteOnly': 'Quote only',
      'dialog.save': 'Save',
      'dialog.cancel': 'Cancel',
      'dialog.sending': 'Sending…',
      'dialog.saving': 'Saving…',
      'dialog.noQuote': 'No text selected: this annotation is stored on the whole document.',
      'dialog.saved': 'Saved. It is listed under “Document notes” in the right Sidebar.',
      'dialog.askNeedsSelection': 'Select text in the document first, then ask the AI.',
      'dialog.truncated': 'The selection was long, so only its first {count} characters are used.',
      'dialog.documentNote': 'Whole-document annotation',
      'dialog.quoteChars': '{count} characters',
      'quick.explain': 'Explain this',
      'quick.simpler': 'In plain words',
      'quick.translate': 'Translate',
      'quick.terms': 'Explain terms',
      'quick.analyze': 'Key points',
      'quick.explain.text': 'Please explain what this passage means.',
      'quick.simpler.text': 'Please restate this passage in plain, simple language.',
      'quick.translate.text': 'Please translate this passage into English.',
      'quick.terms.text': 'Please explain the technical terms in this passage.',
      'quick.analyze.text': 'Please analyze the key points of this passage.',
      'message.source': '**Source: {name}**',
      'message.note': '**My note:** {note}',
      'panel.title': 'Document notes',
      'panel.allDocuments': 'All documents',
      'panel.documents': '{count} documents',
      'panel.back': 'All documents',
      'panel.refresh': 'Refresh',
      'panel.annotateDocument': 'Whole document',
      'panel.noteCount': '{count} annotations',
      'panel.empty': 'No annotations on this document yet.',
      'panel.emptyAll': 'No document annotations yet.',
      'panel.emptyHint': 'Select text in a document and click “Annotate” in its toolbar.',
      'panel.loading': 'Loading…',
      'panel.retry': 'Retry',
      'panel.typeSelection': 'Selection',
      'panel.typeDocument': 'Document',
      'panel.typeAsk': 'Question',
      'panel.locate': 'Locate',
      'panel.highlightAll': 'Highlight all',
      'panel.askAgain': 'Ask again',
      'panel.reanchor': 'Re-anchor',
      'reanchor.bind': 'Bind here',
      'reanchor.cancel': 'Cancel',
      'panel.expand': 'Expand',
      'panel.collapse': 'Collapse',
      'panel.expandAll': 'Expand all',
      'panel.collapseAll': 'Collapse all',
      'panel.quoteAction': 'Quote',
      'panel.editAction': 'Edit',
      'panel.deleteAction': 'Delete',
      'panel.deleteConfirm': 'Delete this annotation?',
      'panel.confirm': 'Delete',
      'panel.saveEdit': 'Save',
      'panel.cancelEdit': 'Cancel',
      'panel.updated': 'Updated {time}',
      'panel.emptyNote': '(No note)',
      'panel.selectDocument': 'Choose a document to review its annotations.',
      'panel.openFailed': 'The annotation panel could not be opened. Try again.',
      'error.network': 'Cannot reach the annotation service. Check the connection and retry.',
      'error.unauthorized': 'The annotation service rejected the request. Refresh the page and retry.',
      'error.inputUnavailable': 'This conversation cannot be edited right now.',
      'error.busy': 'Wait for the current message to finish sending.',
      'error.invalid-note': 'The annotation cannot be empty.',
      'error.invalid-quote': 'The selected text is missing.',
      'error.note-too-long': 'The annotation is too long (4000 characters max).',
      'error.quote-too-long': 'The selected text is too long (2000 characters max).',
      'error.question-too-long': 'The question is too long.',
      'error.invalid-document-path': 'The document path is missing or invalid.',
      'error.no-document': 'No document is associated with this annotation.',
      'error.document-not-open': 'Open the document in the right Sidebar before locating the annotation.',
      'error.bad-request': 'The request was malformed.',
      'error.internal': 'The annotation service failed internally.',
      'error.not-found': 'That annotation has already been deleted.',
      'error.payload-too-large': 'The content is too large.',
      'error.invalid-op': 'Unsupported annotation operation.',
      'error.unknown': 'The operation failed. Try again.',
      'annotation.askFallback': '(question)',
      'thread.question': 'Q: {text}',
      'thread.answer': 'A: {text}',
      'thread.qShort': 'Q',
      'thread.aShort': 'A',
      'color.yellow': 'Yellow',
      'color.blue': 'Blue',
      'color.green': 'Green',
      'color.pink': 'Pink',
      'color.orange': 'Orange',
      'dialog.color': 'Marker colour',
      'panel.color': 'Change marker colour',
      'panel.fontSmaller': 'Smaller annotation text',
      'panel.fontLarger': 'Larger annotation text',
      'hover.hint': 'Click to open this annotation',
      'toast.saved': 'Annotation saved.',
      'toast.reanchorHint': 'Select the same passage at the right place, then click “Bind here” in the toolbar.',
      'toast.reanchorNeedSelection': 'Nothing to bind: select the passage this annotation quotes.',
      'toast.reanchored': 'Re-anchored to the selected occurrence.',
      'toast.reanchorFailed': 'Re-anchoring failed. Try again.',
      'toast.notFound': 'The quoted text was not found; its page may not be rendered yet. Scroll near it and try again.',
      'toast.locating': 'Looking for the passage in the document…',
    }

    const STYLES = `
      .dr-actions { display: inline-flex; align-items: center; gap: 1px; }
      .dr-icon-btn {
        position: relative;
        display: inline-flex; align-items: center; justify-content: center;
        width: 26px; height: 26px; padding: 0; border: 1px solid transparent; border-radius: 6px;
        background: transparent; color: var(--dsw-alias-label-secondary); cursor: pointer;
      }
      .dr-icon-btn:hover:not(:disabled) { background: var(--dsw-alias-bg-layer-2); color: var(--dsw-alias-label-primary); }
      .dr-icon-btn:focus-visible { outline: 2px solid var(--dsw-alias-brand-primary); outline-offset: 1px; }
      .dr-icon-btn:disabled { color: var(--dsw-alias-state-idle-primary); cursor: default; }
      .dr-overlay {
        position: fixed; inset: 0; z-index: 2147483000; display: flex; align-items: center; justify-content: center;
        padding: 16px; background: rgba(0, 0, 0, 0.34); pointer-events: auto;
      }
      .dr-dialog {
        display: flex; flex-direction: column; box-sizing: border-box; width: min(560px, calc(100vw - 32px));
        max-height: min(760px, calc(100vh - 64px)); overflow: hidden;
        border: 1px solid var(--dsw-alias-border-l2); border-radius: 14px;
        background: var(--dsw-alias-bg-overlay); color: var(--dsw-alias-label-primary);
        box-shadow: 0 18px 48px color-mix(in srgb, var(--dsw-alias-label-primary) 22%, transparent);
        font: inherit; font-size: 13px;
      }
      .dr-dialog-head {
        display: flex; align-items: center; justify-content: space-between; gap: 12px;
        padding: 12px 16px; border-bottom: 1px solid var(--dsw-alias-border-l1);
      }
      .dr-dialog-title { font-size: 14px; font-weight: 600; }
      .dr-dialog-body { padding: 14px 16px; overflow: auto; display: flex; flex-direction: column; gap: 12px; }
      .dr-dialog-foot {
        display: flex; align-items: center; justify-content: flex-end; gap: 8px;
        padding: 12px 16px; border-top: 1px solid var(--dsw-alias-border-l1);
      }
      .dr-dialog-foot-spacer { flex: 1 1 auto; }
      .dr-field { display: flex; flex-direction: column; gap: 6px; min-width: 0; }
      .dr-field-label { display: flex; align-items: baseline; justify-content: space-between; gap: 8px; color: var(--dsw-alias-label-secondary); font-size: 12px; }
      .dr-quote {
        max-height: 150px; overflow: auto; box-sizing: border-box; padding: 8px 10px;
        border-left: 2px solid var(--dsw-alias-brand-primary); border-radius: 0 8px 8px 0;
        background: var(--dsw-alias-bg-layer-2); color: var(--dsw-alias-label-primary);
        font-size: 12px; line-height: 1.55; white-space: pre-wrap; overflow-wrap: anywhere;
      }
      .dr-quote-missing { color: var(--dsw-alias-label-secondary); font-size: 12px; line-height: 1.5; }
      .dr-chips { display: flex; flex-wrap: wrap; gap: 6px; }
      .dr-chip {
        padding: 3px 10px; border: 1px solid var(--dsw-alias-border-l1); border-radius: 999px;
        background: transparent; color: var(--dsw-alias-label-secondary); font: inherit; font-size: 12px; cursor: pointer;
      }
      .dr-chip:hover { background: var(--dsw-alias-bg-layer-2); color: var(--dsw-alias-label-primary); }
      .dr-chip:focus-visible { outline: 2px solid var(--dsw-alias-brand-primary); outline-offset: 1px; }
      .dr-input, .dr-textarea {
        box-sizing: border-box; width: 100%; padding: 8px 10px; border: 1px solid var(--dsw-alias-border-l1);
        border-radius: 8px; background: var(--dsw-alias-bg-base); color: var(--dsw-alias-label-primary);
        font: inherit; font-size: 13px; line-height: 1.5;
      }
      .dr-textarea { min-height: 84px; resize: vertical; }
      .dr-input:focus, .dr-textarea:focus { outline: none; border-color: var(--dsw-alias-brand-primary); }
      .dr-btn {
        display: inline-flex; align-items: center; justify-content: center; gap: 6px;
        padding: 6px 14px; border: 1px solid var(--dsw-alias-border-l1); border-radius: 8px;
        background: transparent; color: var(--dsw-alias-label-primary); font: inherit; font-size: 13px; cursor: pointer;
      }
      .dr-btn:hover:not(:disabled) { background: var(--dsw-alias-bg-layer-2); }
      .dr-btn:focus-visible { outline: 2px solid var(--dsw-alias-brand-primary); outline-offset: 1px; }
      .dr-btn:disabled { opacity: 0.5; cursor: default; }
      .dr-btn-primary {
        border-color: color-mix(in srgb, var(--dsw-alias-brand-primary) 45%, transparent);
        background: color-mix(in srgb, var(--dsw-alias-brand-primary) 14%, transparent);
        color: var(--dsw-alias-brand-primary);
      }
      .dr-btn-primary:hover:not(:disabled) { background: color-mix(in srgb, var(--dsw-alias-brand-primary) 22%, transparent); }
      .dr-error {
        display: flex; align-items: center; justify-content: space-between; gap: 10px;
        padding: 8px 10px; border-radius: 8px; font-size: 12px; line-height: 1.45;
        color: var(--dsw-alias-state-error-primary);
        background: color-mix(in srgb, var(--dsw-alias-state-error-primary) 10%, transparent);
      }
      .dr-success {
        padding: 8px 10px; border-radius: 8px; font-size: 12px; line-height: 1.45;
        color: var(--dsw-alias-state-success-primary);
        background: color-mix(in srgb, var(--dsw-alias-state-success-primary) 10%, transparent);
      }
      .dr-panel {
        display: flex; flex-direction: column; box-sizing: border-box; height: 100%; min-height: 0;
        background: var(--dsw-alias-bg-base); color: var(--dsw-alias-label-primary); font-size: 14px;
        --dr-read-font: 15px;
      }
      .dr-panel-head { display: flex; flex-direction: column; gap: 8px; padding: 12px 14px; border-bottom: 1px solid var(--dsw-alias-border-l1); }
      .dr-panel-title-row { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
      .dr-panel-title { font-size: 14px; font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .dr-panel-tools { display: flex; align-items: center; gap: 4px; flex-wrap: wrap; }
      .dr-panel-tools-row { display: flex; align-items: center; justify-content: space-between; gap: 6px; }
      .dr-font-tools { display: inline-flex; align-items: center; gap: 2px; flex: 0 0 auto; }
      .dr-font-btn { min-width: 26px; padding: 2px 5px; font-size: 12px; }
      .dr-link {
        padding: 2px 6px; border: 1px solid transparent; border-radius: 6px;
        background: transparent; color: var(--dsw-alias-label-secondary); font: inherit; font-size: 12px; cursor: pointer;
      }
      .dr-link:hover { background: var(--dsw-alias-bg-layer-2); color: var(--dsw-alias-label-primary); }
      .dr-link:focus-visible { outline: 2px solid var(--dsw-alias-brand-primary); outline-offset: 1px; }
      .dr-link-danger { color: var(--dsw-alias-state-error-primary); }
      .dr-panel-body { flex: 1 1 auto; min-height: 0; overflow: auto; display: flex; flex-direction: column; gap: 10px; padding: 12px 14px; }
      .dr-meta { color: var(--dsw-alias-label-secondary); font-size: 12px; line-height: 1.45; overflow-wrap: anywhere; }
      .dr-card { display: flex; flex-direction: column; gap: 8px; padding: 12px 14px; border: 1px solid var(--dsw-alias-border-l1); border-radius: 10px; background: var(--dsw-alias-bg-layer-1); }
      .dr-card-focus { outline: 2px solid var(--dsw-alias-brand-primary); outline-offset: 1px; }
      .dr-card-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; cursor: pointer; }
      .dr-card-preview {
        cursor: pointer; color: var(--dsw-alias-label-secondary);
        font-size: var(--dr-read-font); line-height: 1.6;
        display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden;
        overflow-wrap: anywhere;
      }
      .dr-card-head-right { display: inline-flex; align-items: center; gap: 6px; flex: 0 0 auto; }
      .dr-chevron { padding: 2px; border-radius: 6px; color: var(--dsw-alias-label-secondary); }
      .dr-chevron svg { transition: transform 0.15s ease; }
      .dr-chevron-open svg { transform: rotate(90deg); }
      .dr-card-preview {
        color: var(--dsw-alias-label-secondary); font-size: 12px; line-height: 1.5;
        display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden;
        overflow-wrap: anywhere;
      }
      .dr-badge {
        padding: 1px 7px; border-radius: 999px; font-size: 11px; line-height: 1.6;
        color: var(--dsw-alias-brand-primary);
        background: color-mix(in srgb, var(--dsw-alias-brand-primary) 13%, transparent);
      }
      .dr-card-quote {
        margin: 0; padding: 4px 0 4px 10px; border-left: 2px solid var(--dsw-alias-border-l2);
        max-height: 96px; overflow: auto; white-space: pre-wrap; overflow-wrap: anywhere;
        color: var(--dsw-alias-label-secondary); font-size: var(--dr-read-font); line-height: 1.6;
      }
      .dr-card-note { white-space: pre-wrap; overflow-wrap: anywhere; line-height: 1.6; }
      .dr-note-empty { color: var(--dsw-alias-label-secondary); }
      .dr-md {
        display: flex; flex-direction: column; gap: 7px; white-space: normal; overflow-wrap: anywhere;
        font-size: var(--dr-read-font); line-height: 1.65;
      }
      .dr-md-p { margin: 0; white-space: pre-wrap; line-height: inherit; }
      .dr-md-h { margin: 6px 0 0; font-weight: 600; line-height: 1.4; }
      .dr-md-h1 { font-size: 1.2em; }
      .dr-md-h2 { font-size: 1.12em; }
      .dr-md-h3 { font-size: 1.04em; }
      .dr-md-h4 { font-size: 1em; }
      .dr-md-code {
        margin: 0; padding: 8px; border-radius: 8px; background: var(--dsw-alias-bg-layer-2);
        overflow: auto; font-size: 0.86em; line-height: 1.5; white-space: pre; max-height: 240px;
      }
      .dr-md-math {
        margin: 0; padding: 6px 8px; border-radius: 8px; overflow: auto; font-size: 0.9em; line-height: 1.5;
        white-space: pre; max-height: 200px;
        background: color-mix(in srgb, var(--dsw-alias-brand-primary) 8%, transparent);
        color: var(--dsw-alias-label-primary);
      }
      .dr-md-math-rendered { overflow-x: auto; max-width: 100%; }
      .dr-md-math-rendered .katex-display { margin: 0; }
      .dr-inline-math-rendered { display: inline-block; max-width: 100%; overflow-x: auto; vertical-align: middle; }
      .dr-md-list { margin: 0; padding-left: 18px; display: flex; flex-direction: column; gap: 3px; }
      .dr-md-quote {
        margin: 0; padding: 4px 10px; border-left: 2px solid var(--dsw-alias-border-l2);
        color: var(--dsw-alias-label-secondary);
      }
      .dr-md-hr { border: 0; border-top: 1px solid var(--dsw-alias-border-l1); margin: 2px 0; width: 100%; }
      .dr-md-table-wrap { overflow-x: auto; max-width: 100%; }
      .dr-md-table { border-collapse: collapse; font-size: 0.92em; min-width: 100%; }
      .dr-md-table th, .dr-md-table td {
        border: 1px solid var(--dsw-alias-border-l1); padding: 4px 7px; text-align: left; vertical-align: top;
      }
      .dr-md-table th { background: var(--dsw-alias-bg-layer-2); font-weight: 600; }
      .dr-md-link { color: var(--dsw-alias-brand-primary); text-decoration: none; }
      .dr-md-link:hover { text-decoration: underline; }
      .dr-inline-code, .dr-inline-math {
        padding: 0 3px; border-radius: 4px; background: var(--dsw-alias-bg-layer-2);
        font-size: 0.9em; overflow-wrap: anywhere;
      }
      .dr-thread-question { border-left: 2px solid var(--dsw-alias-state-success-primary); padding-left: 8px; }
      .dr-thread-answer { border-left: 2px solid var(--dsw-alias-brand-primary); padding-left: 8px; }
      .dr-thread-text { padding-left: 2px; }
      .dr-thread-label {
        display: inline-block; margin-bottom: 2px; margin-right: 6px;
        font-size: 11px; font-weight: 600; color: var(--dsw-alias-label-secondary);
      }
      .dr-card-actions { display: flex; align-items: center; justify-content: flex-end; gap: 4px; flex-wrap: wrap; }
      .dr-doc-row {
        display: flex; align-items: center; justify-content: space-between; gap: 10px; width: 100%;
        box-sizing: border-box; padding: 9px 10px; border: 1px solid var(--dsw-alias-border-l1); border-radius: 8px;
        background: transparent; color: inherit; font: inherit; text-align: left; cursor: pointer;
      }
      .dr-doc-row:hover { background: var(--dsw-alias-bg-layer-2); }
      .dr-doc-row:focus-visible { outline: 2px solid var(--dsw-alias-brand-primary); outline-offset: 1px; }
      .dr-doc-row-main { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
      .dr-doc-row-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .dr-empty { padding: 26px 12px; text-align: center; color: var(--dsw-alias-label-secondary); font-size: 12px; line-height: 1.7; }
      .dr-loading { padding: 18px 12px; text-align: center; color: var(--dsw-alias-label-secondary); font-size: 12px; }
      .dr-spinner {
        display: inline-block; width: 12px; height: 12px; vertical-align: -2px; margin-right: 6px;
        border: 2px solid var(--dsw-alias-border-l1); border-top-color: var(--dsw-alias-brand-primary);
        border-radius: 50%; animation: dr-spin 0.8s linear infinite;
      }
      @keyframes dr-spin { to { transform: rotate(360deg); } }
      .dr-sr { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0,0,0,0); white-space: nowrap; border: 0; }
      .dr-badge-ask {
        color: var(--dsw-alias-state-success-primary);
        background: color-mix(in srgb, var(--dsw-alias-state-success-primary) 13%, transparent);
      }
      .dr-toast {
        position: fixed; left: 50%; bottom: 36px; transform: translateX(-50%); z-index: 2147483001;
        max-width: min(440px, calc(100vw - 32px)); padding: 8px 14px;
        border: 1px solid var(--dsw-alias-border-l2); border-radius: 999px;
        background: var(--dsw-alias-bg-overlay); color: var(--dsw-alias-label-primary);
        box-shadow: 0 10px 26px color-mix(in srgb, var(--dsw-alias-label-primary) 18%, transparent);
        font-size: 12px; line-height: 1.45; text-align: center; pointer-events: none;
      }
      .dr-count {
        position: absolute; top: -3px; right: -3px; min-width: 14px; height: 14px; padding: 0 3px;
        border-radius: 999px; background: var(--dsw-alias-brand-primary); color: var(--dsw-alias-bg-base);
        font-size: 9px; font-weight: 600; line-height: 14px; text-align: center;
      }
      .dr-color-row { display: flex; align-items: center; gap: 9px; padding: 2px 0; flex-wrap: wrap; }
      .dr-color-label { color: var(--dsw-alias-label-secondary); font-size: 12px; }
      .dr-color-dot {
        width: 14px; height: 14px; padding: 0; border-radius: 50%; flex: 0 0 auto;
        border: 1px solid color-mix(in srgb, var(--dsw-alias-label-primary) 22%, transparent); cursor: pointer;
      }
      .dr-color-dot:hover { transform: scale(1.12); }
      .dr-color-swatch {
        width: 20px; height: 20px; padding: 0; border-radius: 50%; cursor: pointer;
        border: 2px solid transparent; box-shadow: 0 0 0 1px color-mix(in srgb, var(--dsw-alias-label-primary) 18%, transparent);
      }
      .dr-color-active {
        border-color: var(--dsw-alias-bg-base);
        box-shadow: 0 0 0 2px var(--dsw-alias-label-primary);
      }
      .dr-color-y { background: #f2c94c; }
      .dr-color-b { background: #4f8ef7; }
      .dr-color-g { background: #35b87f; }
      .dr-color-p { background: #e070a8; }
      .dr-color-o { background: #ef8a3c; }
      .dr-hover {
        position: fixed; z-index: 2147483000; display: flex; flex-direction: column; gap: 6px;
        width: min(360px, calc(100vw - 24px)); padding: 10px 12px;
        border: 1px solid var(--dsw-alias-border-l2); border-radius: 10px;
        background: var(--dsw-alias-bg-overlay); color: var(--dsw-alias-label-primary);
        box-shadow: 0 12px 30px color-mix(in srgb, var(--dsw-alias-label-primary) 20%, transparent);
        font-size: 12.5px; line-height: 1.55; pointer-events: none;
      }
      .dr-hover-head { display: flex; align-items: center; gap: 6px; }
      .dr-hover-quote {
        color: var(--dsw-alias-label-secondary); border-left: 2px solid var(--dsw-alias-border-l2);
        padding-left: 8px; overflow-wrap: anywhere;
        display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden;
        white-space: pre-wrap;
      }
      .dr-hover-note {
        overflow-wrap: anywhere;
        display: -webkit-box; -webkit-line-clamp: 4; -webkit-box-orient: vertical; overflow: hidden;
        white-space: pre-wrap;
      }
      .dr-hover-hint { color: var(--dsw-alias-label-secondary); font-size: 11px; }
      .dr-reanchor-tools { display: inline-flex; align-items: center; gap: 4px; margin-left: 4px; }
      .dr-reanchor-btn {
        padding: 2px 8px; border-radius: 6px; border: 1px solid var(--dsw-alias-brand-primary);
        background: color-mix(in srgb, var(--dsw-alias-brand-primary) 12%, transparent);
        color: var(--dsw-alias-brand-primary); font: inherit; font-size: 11px; cursor: pointer;
      }
      .dr-reanchor-btn:hover { background: color-mix(in srgb, var(--dsw-alias-brand-primary) 18%, transparent); }
      .dr-textarea { font-size: 14px; line-height: 1.6; }
      /* CSS Custom Highlight paints in place without touching the preview's DOM. */
      ::highlight(doc-reader-y) { background-color: rgba(242, 201, 76, 0.38); }
      ::highlight(doc-reader-b) { background-color: rgba(79, 142, 247, 0.24); }
      ::highlight(doc-reader-g) { background-color: rgba(53, 184, 127, 0.26); }
      ::highlight(doc-reader-p) { background-color: rgba(224, 112, 168, 0.26); }
      ::highlight(doc-reader-o) { background-color: rgba(239, 138, 60, 0.28); }
    `

    // ---------------------------------------------------------------- helpers

    function format(text, values) {
      return String(text).replace(/\{(\w+)\}/g, (match, key) => (
        values && Object.prototype.hasOwnProperty.call(values, key) ? String(values[key]) : match
      ))
    }

    function sleep(ms) {
      return new Promise(resolve => setTimeout(resolve, ms))
    }

    function baseName(path) {
      if (typeof path !== 'string' || path === '') return ''
      const name = path.split(/[\\/]/).pop() || path
      try {
        return decodeURIComponent(name)
      } catch {
        return name
      }
    }

    function formatTime(ts) {
      if (!Number.isFinite(ts) || ts <= 0) return ''
      const date = new Date(ts)
      if (Number.isNaN(date.getTime())) return ''
      const options = { hour: '2-digit', minute: '2-digit' }
      const time = date.toLocaleTimeString([], options)
      const today = new Date()
      if (date.toDateString() === today.toDateString()) return time
      return `${date.toLocaleDateString()} ${time}`
    }

    function createStore(initial) {
      let value = initial
      const listeners = new Set()
      return {
        get: () => value,
        set(next) {
          value = typeof next === 'function' ? next(value) : next
          for (const listener of [...listeners]) {
            try {
              listener()
            } catch (error) {
              console.warn('[doc-reader] store listener failed', error)
            }
          }
        },
        subscribe(listener) {
          listeners.add(listener)
          return () => { listeners.delete(listener) }
        },
      }
    }

    function useStore(store) {
      return React.useSyncExternalStore(store.subscribe, store.get, store.get)
    }

    /** Re-render a surface when the active locale changes. */
    function useLocaleTick() {
      const [, setTick] = React.useState(0)
      React.useEffect(() => {
        const locale = ctxRef.current && ctxRef.current.locale
        if (!locale || typeof locale.subscribe !== 'function') return undefined
        return locale.subscribe(() => setTick(value => value + 1))
      }, [])
    }

    /** Error carrying the Host's stable code so the UI can translate it. */
    class ApiError extends Error {
      constructor(code, message) {
        super(message || code)
        this.name = 'ApiError'
        this.code = code
      }
    }

    async function requestJson(op, payload) {
      let response
      try {
        response = await fetch(ROUTE, {
          method: 'POST',
          credentials: 'same-origin',
          cache: 'no-store',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ op, payload: payload || {} }),
        })
      } catch {
        throw new ApiError('network')
      }
      let data = null
      try {
        data = await response.json()
      } catch {
        data = null
      }
      if (response.status === 401 || response.status === 403) throw new ApiError('unauthorized')
      if (!response.ok || !data || data.ok === false) {
        const error = data && data.error && typeof data.error === 'object' ? data.error : null
        throw new ApiError(
          error && typeof error.code === 'string' ? error.code : `http-${response.status}`,
          error && typeof error.message === 'string' ? error.message : '',
        )
      }
      return data.data
    }

    function errorText(t, error) {
      const code = error && typeof error.code === 'string' ? error.code : 'unknown'
      const translated = t(`error.${code}`)
      if (translated !== `error.${code}`) return translated
      if (error && typeof error.message === 'string' && error.message) return error.message
      return t('error.unknown')
    }

    /** The scoped composer face, or null when the session cannot be addressed. */
    function inputFor(ctx, sessionId) {
      if (!sessionId) return null
      try {
        const scope = ctx.sessions && typeof ctx.sessions.scope === 'function'
          ? ctx.sessions.scope(sessionId)
          : undefined
        if (!scope) return null
        return ctx.conversation.input.for(scope)
      } catch (error) {
        console.warn('[doc-reader] composer unavailable', error)
        return null
      }
    }

    /** Insert text at the current caret without replacing an existing draft. */
    function insertAtCaret(input, text) {
      try {
        const span = input.captureInsertion()
        return input.insertText(text, span) !== false
      } catch (error) {
        console.warn('[doc-reader] insert failed', error)
        return false
      }
    }

    function buildAskText(t, { name, quote, question }) {
      const lines = [format(t('message.source'), { name })]
      if (quote) {
        lines.push('')
        for (const line of String(quote).split('\n')) lines.push(`> ${line}`)
      }
      const asked = typeof question === 'string' ? question.trim() : ''
      if (asked) {
        lines.push('')
        lines.push(asked)
      }
      return `${lines.join('\n')}\n`
    }

    function buildQuoteText(t, { name, quote }) {
      return buildAskText(t, { name, quote, question: '' })
    }

    function buildReferenceText(t, { name, quote, note }) {
      const lines = [format(t('message.source'), { name })]
      if (quote) {
        lines.push('')
        for (const line of String(quote).split('\n')) lines.push(`> ${line}`)
      }
      const cleanNote = String(note || '').trim()
      if (cleanNote !== '') {
        lines.push('')
        lines.push(format(t('message.note'), { note: cleanNote }))
      }
      return `${lines.join('\n')}\n\n`
    }

    /** The active document tab's address, used only as a sanity hint. */
    function activeTabTitle(ctx) {
      try {
        const tab = typeof ctx.sidebarRight.active === 'function' ? ctx.sidebarRight.active() : undefined
        return tab && typeof tab.title === 'string' ? tab.title : ''
      } catch {
        return ''
      }
    }

    /**
     * Read the browser selection when it belongs to the document preview area.
     * @returns {{text: string, at: number, title: string}|null}
     */
    function captureSelection(ctx) {
      if (typeof window === 'undefined' || typeof window.getSelection !== 'function') return null
      const selection = window.getSelection()
      if (!selection || selection.isCollapsed || selection.rangeCount === 0) return null
      let text = String(selection.toString() || '').replace(/\r\n/g, '\n').trim()
      if (text.length < 2) return null
      const truncated = text.length > QUOTE_LIMIT
      if (truncated) text = text.slice(0, QUOTE_LIMIT)
      const anchor = selection.anchorNode
      const element = anchor && anchor.nodeType === 1 ? anchor : anchor && anchor.parentElement
      const scoped = typeof document !== 'undefined' ? document.querySelector('[data-sidebar-right-session]') : null
      if (scoped && element && typeof element.closest === 'function') {
        const inside = element.closest('[data-sidebar-right-session]')
          || element.closest('[data-pdf-text]')
          || element.closest('[data-document-zoom-surface]')
        if (!inside) return null
      }
      return { text, at: Date.now(), title: activeTabTitle(ctx), truncated }
    }

    /**
     * Remember a short window of rendered text around the selection so later
     * paints can choose the same occurrence when the quote is not unique.
     */
    function startPositionOf(range, index) {
      const container = range.startContainer
      const offset = range.startOffset
      if (container && container.nodeType === 3) {
        const segment = index.segments.find(entry => entry.node === container)
        if (!segment) return null
        const text = container.nodeValue || ''
        let count = 0
        for (let position = 0; position < Math.min(offset, text.length); position += 1) {
          if (normalizedChar(text[position]) !== '') count += 1
        }
        return segment.start + count
      }
      if (!container || typeof document.createTreeWalker !== 'function') return null
      const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT)
      const first = walker.nextNode()
      if (!first) return null
      const segment = index.segments.find(entry => entry.node === first)
      return segment ? segment.start : null
    }

    function endPositionOf(range, index) {
      const container = range.endContainer
      const offset = range.endOffset
      if (container && container.nodeType === 3) {
        const segment = index.segments.find(entry => entry.node === container)
        if (!segment) return null
        const text = container.nodeValue || ''
        let count = 0
        for (let position = 0; position < Math.min(offset, text.length); position += 1) {
          if (normalizedChar(text[position]) !== '') count += 1
        }
        return segment.start + count
      }
      if (!container || typeof document.createTreeWalker !== 'function') return null
      const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT)
      let last = walker.nextNode()
      if (!last) return null
      for (let next = walker.nextNode(); next; next = walker.nextNode()) last = next
      const segment = index.segments.find(entry => entry.node === last)
      return segment ? segment.start + segment.count : null
    }

    /**
     * Remember where the selection sits: a text window before/after it plus its
     * rendered length. The length lets a formula quote be painted at the right
     * span even when the captured text and the freshly rendered text differ in
     * their hidden math layers.
     */
    function buildSelectionAnchor(root) {
      if (!root) return null
      try {
        const selection = window.getSelection()
        if (!selection || selection.rangeCount === 0 || selection.isCollapsed) return null
        const range = selection.getRangeAt(0)
        if (!root.contains(range.commonAncestorContainer)) return null
        const index = buildTextIndex(root)
        const start = startPositionOf(range, index)
        const end = endPositionOf(range, index)
        if (start === null || end === null || end <= start) return null
        const before = index.stripped.slice(Math.max(0, start - ANCHOR_RADIUS), start)
        const after = index.stripped.slice(end, end + ANCHOR_RADIUS)
        return { before, after, length: end - start }
      } catch {
        return null
      }
    }

    const COLOR_KEYS = ['y', 'b', 'g', 'p', 'o']
    const COLOR_DEFAULT_NOTE = 'b'
    const COLOR_DEFAULT_ASK = 'g'
    const COLOR_MARK = '\u2063'
    const ANCHOR_MARK = '\u2062'
    const ANCHOR_RADIUS = 20
    /** Host note limit is 4000; keep room for the invisible prefix. */
    const NOTE_BODY_LIMIT = 3750

    function base64Encode(text) {
      try {
        return btoa(unescape(encodeURIComponent(text)))
      } catch {
        return ''
      }
    }

    function base64Decode(value) {
      try {
        return decodeURIComponent(escape(atob(value)))
      } catch {
        return null
      }
    }

    /** A question thread carries a question, a source flag, or a thread marker. */
    function isAskAnnotation(annotation) {
      return Boolean(annotation && (annotation.question || annotation.source === 'ask'
        || /(?:^|\n)(?:问[：:]|Q:)/.test(stripColor(annotation.note || ''))))
    }

    /**
     * The note carries two invisible prefixes: the marker colour and a short
     * window of visible text around the quote. The window disambiguates a quote
     * that occurs several times in one document, while staying compatible with
     * Host versions that only know the note string.
     */
    function colorOf(note) {
      const match = /^\u2063([a-z]):\u2063/.exec(String(note || ''))
      return match && COLOR_KEYS.includes(match[1]) ? match[1] : null
    }

    function decodeAnchor(value) {
      const text = base64Decode(value)
      if (text === null) return null
      const parts = text.split('\u0000')
      if (parts.length < 2) return null
      const length = parts.length >= 3 ? Number(parts[2]) : 0
      return {
        before: parts[0],
        after: parts[1],
        length: Number.isFinite(length) && length > 0 ? length : 0,
      }
    }

    function anchorOf(note) {
      const match = /^\u2063[a-z]:\u2063\u2062a:([A-Za-z0-9+/=]+)\u2062/.exec(String(note || ''))
      return match ? decodeAnchor(match[1]) : null
    }

    function anchorMarker(anchor) {
      if (!anchor || (anchor.before === '' && anchor.after === '' && !anchor.length)) return ''
      const payload = base64Encode(`${anchor.before || ''}\u0000${anchor.after || ''}\u0000${Math.max(0, Math.round(anchor.length || 0))}`)
      return payload === '' ? '' : `${ANCHOR_MARK}a:${payload}${ANCHOR_MARK}`
    }

    function stripColor(note) {
      return String(note || '').replace(/^\u2063[a-z]:\u2063(?:\u2062a:[A-Za-z0-9+/=]+\u2062)?/, '')
    }

    function withColor(note, key) {
      const color = COLOR_KEYS.includes(key) ? key : COLOR_DEFAULT_NOTE
      const anchor = anchorOf(note)
      return `${COLOR_MARK}${color}:${COLOR_MARK}${anchor ? anchorMarker(anchor) : ''}${stripColor(note)}`
    }

    function withAnchor(note, anchor) {
      const color = colorOf(note) || COLOR_DEFAULT_NOTE
      return `${COLOR_MARK}${color}:${COLOR_MARK}${anchor ? anchorMarker(anchor) : ''}${stripColor(note)}`
    }

    /** Effective colour of an annotation, falling back by kind for older records. */
    function annotationColor(annotation) {
      return colorOf(annotation && annotation.note)
        || (isAskAnnotation(annotation) ? COLOR_DEFAULT_ASK : COLOR_DEFAULT_NOTE)
    }

    function nextColor(key) {
      const index = COLOR_KEYS.indexOf(key)
      return COLOR_KEYS[(index + 1) % COLOR_KEYS.length]
    }

    function highlightName(color) {
      return `doc-reader-${color}`
    }

    /** Selected reading size for annotation text, kept across sessions. */
    const READ_FONT_KEY = 'docReader.readFont'
    const READ_FONT_DEFAULT = 15
    function readFontSize() {
      try {
        const stored = Number(window.localStorage.getItem(READ_FONT_KEY))
        return stored >= 12 && stored <= 20 ? stored : READ_FONT_DEFAULT
      } catch {
        return READ_FONT_DEFAULT
      }
    }
    function storeFontSize(size) {
      try {
        window.localStorage.setItem(READ_FONT_KEY, String(size))
      } catch {
        // A locked-down storage still lets the session use the size.
      }
    }

    /** CSS Custom Highlight support (Chromium 105+), used without touching the preview's DOM. */
    function supportsHighlightApi() {
      const css = globalThis.CSS
      return typeof css !== 'undefined' && css.highlights !== undefined && typeof globalThis.Highlight === 'function'
    }

    /** The element holding the visible document preview, if any. */
    function previewRoot() {
      if (typeof document === 'undefined') return null
      const pane = document.querySelector('[data-sidebar-right-session]')
      if (!pane) return null
      if (typeof pane.querySelector !== 'function') return pane
      return pane.querySelector('[data-pdf-preview]') || pane
    }

    /**
     * The preview belonging to one document toolbar. Several session views can
     * stay mounted, so the first pane in the document is not necessarily the
     * one this toolbar lives in.
     */
    function previewRootWithin(scope) {
      if (!scope || typeof scope.closest !== 'function') return previewRoot()
      const pane = scope.closest('[data-sidebar-right-session]')
      if (!pane) return previewRoot()
      if (typeof pane.querySelector !== 'function') return pane
      return pane.querySelector('[data-pdf-preview]') || pane
    }

    /** Whitespace-free, lowercased form used for tolerant matching across spans. */
    function searchable(text) {
      let out = ''
      for (let index = 0; index < text.length; index += 1) {
        const character = normalizedChar(text[index])
        if (character !== '') out += character
      }
      return out
    }

    /** Characters that never carry visible text; selections and DOM differ on them. */
    const IGNORED_CHAR = /[\s\u00ad\u061c\u180e\u200b-\u200f\u202a-\u202e\u2060-\u206f\ufe00-\ufe0f\ufeff\ufff9-\ufffb]/

    /** One visible character in its comparison form; invisible characters vanish. */
    function normalizedChar(character) {
      if (IGNORED_CHAR.test(character)) return ''
      const lower = character.toLowerCase()
      return lower.length === 1 ? lower : character
    }

    /**
     * Index the preview's text nodes in reading order, ignoring UI chrome.
     * The whitespace-free string plus the node each character came from lets a
     * quote match across PDF text spans and Markdown element boundaries.
     */
    function buildTextIndex(root) {
      const segments = []
      let stripped = ''
      if (!root || typeof document.createTreeWalker !== 'function') return { segments, stripped }
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
        acceptNode(node) {
          const parent = node.parentElement
          if (!parent) return NodeFilter.FILTER_REJECT
          if (parent.closest('script, style, annotation, annotation-xml, button, header, [role="tablist"], [role="tab"], [class*="dr-"]')) {
            return NodeFilter.FILTER_REJECT
          }
          return node.nodeValue && node.nodeValue.trim() !== '' ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT
        },
      })
      let node
      while ((node = walker.nextNode())) {
        const text = node.nodeValue
        let count = 0
        for (let index = 0; index < text.length; index += 1) {
          if (normalizedChar(text[index]) !== '') count += 1
        }
        if (count === 0) continue
        const start = stripped.length
        segments.push({ node, start, count })
        for (let index = 0; index < text.length; index += 1) {
          const character = normalizedChar(text[index])
          if (character !== '') stripped += character
        }
      }
      return { segments, stripped }
    }

    /** Map one comparison-form character position back to a DOM point. */
    function locateTextPoint(index, position) {
      const { segments } = index
      let low = 0
      let high = segments.length - 1
      let segment = null
      while (low <= high) {
        const middle = (low + high) >> 1
        const candidate = segments[middle]
        if (position < candidate.start) high = middle - 1
        else if (position >= candidate.start + candidate.count) low = middle + 1
        else { segment = candidate; break }
      }
      if (!segment) return null
      let remaining = position - segment.start
      const text = segment.node.nodeValue
      for (let offset = 0; offset < text.length; offset += 1) {
        if (normalizedChar(text[offset]) === '') continue
        if (remaining === 0) return { node: segment.node, offset }
        remaining -= 1
      }
      return null
    }

    /** How much of the stored surrounding text matches this occurrence. */
    function contextScore(stripped, position, length, anchor) {
      if (!anchor) return 0
      let before = 0
      const beforeLimit = Math.min(anchor.before.length, position, 60)
      for (let size = beforeLimit; size > 0; size -= 1) {
        if (stripped.slice(position - size, position) === anchor.before.slice(anchor.before.length - size)) {
          before = size
          break
        }
      }
      let after = 0
      const tail = position + length
      const afterLimit = Math.min(anchor.after.length, stripped.length - tail, 60)
      for (let size = afterLimit; size > 0; size -= 1) {
        if (stripped.slice(tail, tail + size) === anchor.after.slice(0, size)) {
          after = size
          break
        }
      }
      return before + after
    }

    function chooseOccurrence(index, positions, length, anchor) {
      if (positions.length === 1 || !anchor) return positions[0]
      let best = positions[0]
      let bestScore = -1
      for (const position of positions) {
        const score = contextScore(index.stripped, position, length, anchor)
        if (score > bestScore) {
          bestScore = score
          best = position
        }
      }
      return best
    }

    function commonPrefix(left, right) {
      const limit = Math.min(left.length, right.length)
      let size = 0
      while (size < limit && left[size] === right[size]) size += 1
      return size
    }

    /**
     * Locate the stored selection by its surrounding text and rendered length,
     * without relying on the quote text matching exactly. This is the fallback
     * for formula selections whose visible and hidden math layers differ.
     */
    function chooseAnchorStart(index, anchor) {
      if (!index || !anchor || !anchor.length) return null
      const stripped = index.stripped
      const length = Math.min(anchor.length, stripped.length)
      if (length <= 0) return null
      let best = null
      let bestScore = -1
      const consider = (start, beforeScore) => {
        if (start < 0 || start + length > stripped.length) return
        const afterScore = anchor.after ? commonPrefix(stripped.slice(start + length), anchor.after) : 0
        const score = beforeScore + afterScore
        if (score > bestScore) {
          bestScore = score
          best = start
        }
      }
      const before = anchor.before || ''
      for (let size = before.length; size >= 2; size -= 1) {
        const needle = before.slice(before.length - size)
        let at = stripped.indexOf(needle)
        let found = false
        let count = 0
        while (at >= 0 && count < 120) {
          consider(at + size, size)
          found = true
          count += 1
          at = stripped.indexOf(needle, at + 1)
        }
        if (found) break
      }
      if (best === null && anchor.after) {
        let at = stripped.indexOf(anchor.after)
        let count = 0
        while (at >= 0 && count < 120) {
          consider(at - length, 0)
          count += 1
          at = stripped.indexOf(anchor.after, at + 1)
        }
      }
      return best
    }

    function rangeForAnchor(index, anchor) {
      const start = chooseAnchorStart(index, anchor)
      if (start === null) return null
      return rangeAt(index, start, Math.min(anchor.length, index.stripped.length - start))
    }

    /** The Range for the quote: the occurrence matching the stored context, or null. */
    function rangeForQuote(index, quote, anchor) {
      const needle = searchable(quote)
      if (needle.length >= 2) {
        const positions = []
        let at = index.stripped.indexOf(needle)
        while (at >= 0 && positions.length < 240) {
          positions.push(at)
          at = index.stripped.indexOf(needle, at + 1)
        }
        if (positions.length > 0) {
          return rangeAt(index, chooseOccurrence(index, positions, needle.length, anchor), needle.length)
        }
      }
      if (anchor) {
        // The quote text no longer matches exactly (KaTeX layers change between
        // renders); the stored window and length still identify the span.
        const anchored = rangeForAnchor(index, anchor)
        if (anchored) return anchored
      }
      return mathFallbackRange(index, quote)
    }

    /** Build a Range from a start position and a comparison-form length. */
    function rangeAt(index, position, length) {
      const start = locateTextPoint(index, position)
      const end = locateTextPoint(index, position + length - 1)
      if (!start || !end) return null
      const range = document.createRange()
      range.setStart(start.node, start.offset)
      range.setEnd(end.node, end.offset + 1)
      return range
    }

    function allPositions(text, needle, limit = 120) {
      const positions = []
      let at = text.indexOf(needle)
      while (at >= 0 && positions.length < limit) {
        positions.push(at)
        at = text.indexOf(needle, at + 1)
      }
      return positions
    }

    /**
     * Math-heavy selections captured from KaTeX include both the hidden MathML
     * and the visible HTML layer; if an exact match fails, span the visible
     * Chinese runs. Picking the tightest pair of runs (instead of their first
     * and last occurrences globally) keeps the mark local to the passage.
     */
    function chooseMathFallbackSpan(index, quote) {
      if (!/[\u{1D400}-\u{1D7FF}]/u.test(quote)) return null
      const runs = quote.match(/[\u3400-\u9fff]{2,}/gu) || []
      if (runs.length < 2) return null
      const needleLength = searchable(quote).length
      const bound = Math.max(160, needleLength * 3)
      const firstPositions = allPositions(index.stripped, searchable(runs[0]))
      const lastRun = runs[runs.length - 1]
      const lastPositions = allPositions(index.stripped, searchable(lastRun))
      if (firstPositions.length === 0 || lastPositions.length === 0) return null
      let best = null
      for (const start of firstPositions) {
        for (const end of lastPositions) {
          if (end + lastRun.length <= start) continue
          const span = end + lastRun.length - start
          if (span > bound) continue
          if (best === null || span < best.span) best = { start, span }
        }
      }
      return best
    }

    function mathFallbackRange(index, quote) {
      const best = chooseMathFallbackSpan(index, quote)
      if (best === null) return null
      return rangeAt(index, best.start, best.span)
    }

    function clearHighlights() {
      highlightRanges = []
      if (!supportsHighlightApi()) return
      for (const key of COLOR_KEYS) globalThis.CSS.highlights.delete(highlightName(key))
    }

    /** Paint every annotation that can be found in the current preview. */
    function applyHighlights(annotations, root) {
      highlightRanges = []
      if (!supportsHighlightApi()) return 0
      const target = root || previewRoot()
      if (!target) return 0
      clearHighlights()
      const index = buildTextIndex(target)
      const groups = new Map(COLOR_KEYS.map(key => [key, []]))
      for (const annotation of annotations) {
        if (!annotation || typeof annotation.quote !== 'string' || annotation.quote.trim() === '') continue
        const range = rangeForQuote(index, annotation.quote, anchorOf(annotation.note))
        if (range === null) continue
        const color = annotationColor(annotation)
        highlightRanges.push({ annotation, range, color })
        groups.get(color).push(range)
      }
      let painted = 0
      for (const [color, ranges] of groups) {
        if (ranges.length === 0) continue
        globalThis.CSS.highlights.set(highlightName(color), new globalThis.Highlight(...ranges))
        painted += ranges.length
      }
      return painted
    }

    /** Scroll the quote into view and select it (the browser paints the selection). */
    function scrollToQuote(root, quote, anchor) {
      const range = rangeForQuote(buildTextIndex(root), quote, anchor)
      if (range === null) return false
      try {
        const node = range.startContainer
        const element = node.nodeType === 1 ? node : node.parentElement
        if (element && typeof element.scrollIntoView === 'function') {
          element.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'smooth' })
        }
        const selection = window.getSelection()
        if (selection) {
          selection.removeAllRanges()
          selection.addRange(range)
        }
      } catch (error) {
        console.warn('[doc-reader] scroll to quote failed', error)
      }
      return true
    }

    /** Nearest scroll container of the preview: ancestors first, then the pane subtree. */
    function findScroller(root) {
      const candidates = []
      const inspect = (node) => {
        try {
          const style = window.getComputedStyle(node)
          if ((style.overflowY === 'auto' || style.overflowY === 'scroll')
            && node.scrollHeight > node.clientHeight + 8) candidates.push(node)
        } catch {
          // Detached nodes are skipped.
        }
      }
      let node = root
      while (node && node !== document.body) {
        inspect(node)
        node = node.parentElement
      }
      const pane = root && typeof root.closest === 'function' ? root.closest('[data-sidebar-right-session]') : null
      if (pane) {
        // The Markdown body scrolls inside the pane, below the toolbar, so the
        // scroller is a descendant rather than an ancestor.
        for (const child of pane.querySelectorAll('*')) inspect(child)
      }
      if (candidates.length === 0) return null
      return candidates.sort((left, right) =>
        (right.scrollHeight - right.clientHeight) - (left.scrollHeight - left.clientHeight))[0]
    }

    // ------------------------------------------------------ in-document anchors

    /** Letters and digits only, so a TOC label matches the heading it points at. */
    function anchorKey(text) {
      let out = ''
      for (const character of String(text || '').normalize('NFKC')) {
        if (/[\p{L}\p{N}]/u.test(character)) out += character.toLowerCase()
      }
      return out
    }

    /** Headings of one Markdown preview, in reading order, without our own chrome. */
    function previewHeadings(root) {
      if (!root || typeof root.querySelectorAll !== 'function') return []
      return Array.from(root.querySelectorAll('h1, h2, h3, h4, h5, h6'))
        .filter(heading => !(heading.closest && heading.closest('[class*="dr-"]')))
    }

    /**
     * Resolve one `href="#id"` inside the preview: an element carrying that id,
     * then a heading whose text equals the link label, then a heading whose text
     * is the id. The text steps keep jumps working when a renderer drops raw
     * HTML anchors such as `<a id="chapter"></a>`.
     */
    function resolveAnchor(root, id, label) {
      if (!root || !id) return null
      let target = null
      const escape = globalThis.CSS && typeof globalThis.CSS.escape === 'function'
        ? globalThis.CSS.escape
        : value => String(value).replace(/["\\]/g, '\\$&')
      try {
        target = root.querySelector('#' + escape(id))
      } catch (error) {
        target = null
      }
      if (target) return target
      const headings = previewHeadings(root)
      const wanted = [anchorKey(label), anchorKey(id)].filter(key => key !== '')
      for (const key of wanted) {
        const match = headings.find(heading => anchorKey(heading.textContent) === key)
        if (match) return match
      }
      try {
        return root.querySelector('[name="' + String(id).replace(/"/g, '') + '"]')
      } catch (error) {
        return null
      }
    }

    /** Scroll one anchor target inside the preview's own scroll container. */
    function scrollToAnchor(root, target) {
      const scroller = findScroller(root)
      if (!scroller) {
        target.scrollIntoView({ block: 'start', inline: 'nearest', behavior: 'smooth' })
        return
      }
      const offset = target.getBoundingClientRect().top - scroller.getBoundingClientRect().top
        + scroller.scrollTop - 12
      scroller.scrollTo({ top: Math.max(0, offset), behavior: 'smooth' })
    }

    /**
     * Make `[目录](#id)` links work in the preview. The pane scrolls inside its
     * own container, so the click is handled here instead of the app's router.
     */
    function installAnchorJump() {
      if (typeof document === 'undefined') return () => {}
      const onClick = (event) => {
        if (!event || event.defaultPrevented) return
        if (typeof event.button === 'number' && event.button !== 0) return
        const element = event.target
        const anchor = element && typeof element.closest === 'function' ? element.closest('a[href^="#"]') : null
        if (!anchor) return
        if (!anchor.closest('[data-sidebar-right-session]')) return
        const href = anchor.getAttribute('href') || ''
        if (href.length < 2) return
        let id = href.slice(1)
        try {
          id = decodeURIComponent(id)
        } catch (error) {
          // Keep the raw fragment.
        }
        const root = previewRootWithin(anchor)
        const target = resolveAnchor(root, id, anchor.textContent)
        if (!target) return
        event.preventDefault()
        event.stopPropagation()
        scrollToAnchor(root, target)
      }
      document.addEventListener('click', onClick, true)
      return () => document.removeEventListener('click', onClick, true)
    }

    /**
     * Find a quote that may live in a page the preview has not rendered yet:
     * check the current DOM, then walk the scroll container from the top so
     * lazy PDF text layers and paged Markdown load, restoring the position when
     * the quote is nowhere to be found.
     * @returns 'found' | 'no-root' | 'no-scroller' | 'not-found'
     */
    async function locateInDocument(getRoot, quote, cancelled, anchor) {
      if (!quote) return 'found'
      let root = getRoot()
      if (!root) return 'no-root'
      if (scrollToQuote(root, quote, anchor)) return 'found'
      const scroller = findScroller(root)
      if (!scroller) return 'no-scroller'
      const original = scroller.scrollTop
      const step = Math.max(240, Math.floor(scroller.clientHeight * 0.8))
      scroller.scrollTop = 0
      await sleep(140)
      for (let attempt = 0; attempt < 120 && !cancelled(); attempt += 1) {
        root = getRoot()
        if (root && scrollToQuote(root, quote, anchor)) return 'found'
        const before = scroller.scrollTop
        scroller.scrollTop = Math.min(scroller.scrollHeight, before + step)
        if (scroller.scrollTop === before) break
        await sleep(230)
      }
      if (!cancelled()) scroller.scrollTop = original
      return 'not-found'
    }

    /** Focus the document tab that holds this annotation, if it is open. */
    function focusDocumentTab(ctx, annotation) {
      if (!ctx || !ctx.sidebarRight) return false
      const address = typeof annotation.documentAddress === 'string' ? annotation.documentAddress : ''
      if (address.startsWith('dsh-resource://')) {
        try {
          ctx.sidebarRight.openResource(address, { revealIfOpened: true })
          return true
        } catch (error) {
          console.warn('[doc-reader] reveal document failed', error)
        }
      }
      const name = annotation.documentName || baseName(annotation.documentPath)
      try {
        const sessionId = ctx.sidebarRight.mounted && typeof ctx.sidebarRight.mounted.getSnapshot === 'function'
          ? ctx.sidebarRight.mounted.getSnapshot()
          : undefined
        const source = ctx.sidebarRight.openTabs && typeof ctx.sidebarRight.openTabs.getSnapshot === 'function'
          ? ctx.sidebarRight.openTabs.getSnapshot()
          : []
        const match = (Array.isArray(source) ? source : []).find((tab) => {
          if (!tab || typeof tab.contentId !== 'string' || name === '') return false
          if (sessionId !== undefined && tab.sessionId !== sessionId) return false
          let decoded = tab.contentId
          try {
            decoded = decodeURIComponent(tab.contentId)
          } catch {
            // The raw address still carries the file name.
          }
          return decoded.endsWith(name)
        })
        if (match) {
          ctx.sidebarRight.focus(match.tabId)
          return true
        }
      } catch (error) {
        console.warn('[doc-reader] find document tab failed', error)
      }
      return false
    }

    /** Transient frame-wide notice used by locate/highlight failures. */
    function showToast(message) {
      const serial = Date.now()
      toastStore.set({ message, serial })
      setTimeout(() => {
        const current = toastStore.get()
        if (current && current.serial === serial) toastStore.set(null)
      }, 2600)
    }

    // ------------------------------------------------- question/answer threads

    /** Split a thread note into labelled segments; a plain note yields one text segment. */
    function splitThread(note) {
      const lines = String(note || '').split('\n')
      const segments = []
      let current = { label: 'text', text: '' }
      for (const line of lines) {
        const match = line.match(/^(问|答|Q|A)[：:]\s*/)
        if (match) {
          if (current.text.trim() !== '') segments.push(current)
          current = {
            label: match[1] === '问' || match[1] === 'Q' ? 'question' : 'answer',
            text: line.slice(match[0].length),
          }
        } else {
          current.text += (current.text === '' ? '' : '\n') + line
        }
      }
      if (current.text.trim() !== '') segments.push(current)
      return segments
    }

    /** Inline Markdown: bold, italic, code, links, and math kept readable. */
    function renderInline(text, keyPrefix) {
      const nodes = []
      const pattern = /(\*\*[^*]+\*\*|\*[^*\n]+\*|`[^`]+`|\\\([\s\S]*?\\\)|\$[^$\n]+\$|\[[^\]\n]+\]\([^)\s]+\))/g
      let last = 0
      let index = 0
      for (const match of String(text).matchAll(pattern)) {
        if (match.index > last) nodes.push(String(text).slice(last, match.index))
        const token = match[0]
        const key = `${keyPrefix}-i${index}`
        if (token.startsWith('**')) {
          nodes.push(h('strong', { key }, token.slice(2, -2)))
        } else if (token.startsWith('*')) {
          nodes.push(h('em', { key }, token.slice(1, -1)))
        } else if (token.startsWith('`')) {
          nodes.push(h('code', { className: 'dr-inline-code', key }, token.slice(1, -1)))
        } else if (token.startsWith('\\(') || token.startsWith('$')) {
          const tex = token.startsWith('\\(') ? token.slice(2, -2) : token.slice(1, -1)
          if (katex) {
            nodes.push(h('span', {
              className: 'dr-inline-math-rendered',
              key,
              dangerouslySetInnerHTML: { __html: katex.renderToString(tex, { throwOnError: false, displayMode: false }) },
            }))
          } else {
            nodes.push(h('code', { className: 'dr-inline-math', key }, tex))
          }
        } else {
          const link = token.match(/^\[([^\]\n]+)\]\(([^)\s]+)\)$/)
          if (link) {
            const label = link[1]
            const href = link[2]
            const safe = /^(?:https?:|mailto:|\/|#)/i.test(href) ? href : null
            nodes.push(safe
              ? h('a', { className: 'dr-md-link', key, href: safe, target: '_blank', rel: 'noreferrer noopener' }, label)
              : h('span', { key }, label))
          } else {
            nodes.push(h('code', { className: 'dr-inline-math', key }, token))
          }
        }
        last = match.index + token.length
        index += 1
      }
      if (last < String(text).length) nodes.push(String(text).slice(last))
      return nodes
    }

    /** Small block renderer: headings, fenced code, math blocks, lists and paragraphs. */
    function renderNoteBlocks(text, keyPrefix) {
      const lines = String(text || '').split('\n')
      const nodes = []
      let paragraph = []
      let index = 0
      const flush = () => {
        if (paragraph.length === 0) return
        nodes.push(h('p', { className: 'dr-md-p', key: `${keyPrefix}-p${nodes.length}` },
          renderInline(paragraph.join('\n'), `${keyPrefix}-p${nodes.length}`)))
        paragraph = []
      }
      while (index < lines.length) {
        const line = lines[index]
        if (/^\s*```/.test(line)) {
          flush()
          const code = []
          index += 1
          while (index < lines.length && !/^\s*```/.test(lines[index])) {
            code.push(lines[index])
            index += 1
          }
          index += 1
          nodes.push(h('pre', { className: 'dr-md-code', key: `${keyPrefix}-c${nodes.length}` }, code.join('\n')))
          continue
        }
        if (/^\s*\$\$/.test(line)) {
          flush()
          const body = []
          let rest = line.replace(/^\s*\$\$/, '')
          if (rest.includes('$$')) {
            body.push(rest.slice(0, rest.indexOf('$$')))
          } else {
            if (rest.trim() !== '') body.push(rest)
            index += 1
            while (index < lines.length && !lines[index].includes('$$')) {
              body.push(lines[index])
              index += 1
            }
            if (index < lines.length) body.push(lines[index].replace(/\$\$.*$/, ''))
          }
          index += 1
          if (katex) {
            nodes.push(h('div', {
              className: 'dr-md-math-rendered',
              key: `${keyPrefix}-m${nodes.length}`,
              dangerouslySetInnerHTML: {
                __html: katex.renderToString(body.join('\n'), { throwOnError: false, displayMode: true }),
              },
            }))
          } else {
            nodes.push(h('pre', { className: 'dr-md-math', key: `${keyPrefix}-m${nodes.length}` }, body.join('\n')))
          }
          continue
        }
        if (/^\s*>\s?/.test(line)) {
          flush()
          const quoteLines = []
          while (index < lines.length && /^\s*>\s?/.test(lines[index])) {
            quoteLines.push(lines[index].replace(/^\s*>\s?/, ''))
            index += 1
          }
          nodes.push(h('blockquote', { className: 'dr-md-quote', key: `${keyPrefix}-q${nodes.length}` },
            ...renderInline(quoteLines.join('\n'), `${keyPrefix}-q${nodes.length}`)))
          continue
        }
        if (line.includes('|') && index + 1 < lines.length && /^\s*\|?\s*:?-{2,}/.test(lines[index + 1])) {
          flush()
          const parseRow = row => row.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map(cell => cell.trim())
          const header = parseRow(line)
          index += 2
          const rows = []
          while (index < lines.length && lines[index].includes('|') && lines[index].trim() !== '') {
            rows.push(parseRow(lines[index]))
            index += 1
          }
          const tableKey = `${keyPrefix}-t${nodes.length}`
          nodes.push(h('div', { className: 'dr-md-table-wrap', key: tableKey },
            h('table', { className: 'dr-md-table' },
              h('thead', null, h('tr', null, header.map((cell, cellIndex) => h('th', { key: cellIndex },
                ...renderInline(cell, `${tableKey}-h-${cellIndex}`))))),
              h('tbody', null, rows.map((row, rowIndex) => h('tr', { key: rowIndex },
                header.map((_, cellIndex) => h('td', { key: cellIndex },
                  ...renderInline(row[cellIndex] || '', `${tableKey}-${rowIndex}-${cellIndex}`)))))))))
          continue
        }
        if (/^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/.test(line)) {
          flush()
          nodes.push(h('hr', { className: 'dr-md-hr', key: `${keyPrefix}-r${nodes.length}` }))
          index += 1
          continue
        }
        const heading = line.match(/^(#{1,6})\s+(.*)$/)
        if (heading) {
          flush()
          const level = Math.min(heading[1].length, 4)
          nodes.push(h(`h${level + 2}`, {
            className: `dr-md-h dr-md-h${level}`,
            key: `${keyPrefix}-h${nodes.length}`,
          }, renderInline(heading[2], `${keyPrefix}-h${nodes.length}`)))
          index += 1
          continue
        }
        if (line.trim() === '') {
          flush()
          index += 1
          continue
        }
        if (/^\s*([-*+]|\d+\.)\s+/.test(line)) {
          flush()
          const items = []
          while (index < lines.length && /^\s*([-*+]|\d+\.)\s+/.test(lines[index])) {
            items.push(lines[index].replace(/^\s*([-*+]|\d+\.)\s+/, ''))
            index += 1
          }
          const listKey = `${keyPrefix}-l${nodes.length}`
          nodes.push(h('ul', { className: 'dr-md-list', key: listKey },
            items.map((item, itemIndex) => h('li', { key: `${listKey}-${itemIndex}` },
              renderInline(item, `${listKey}-${itemIndex}`)))))
          continue
        }
        paragraph.push(line)
        index += 1
      }
      flush()
      return nodes
    }

    /** One line of plain text for a collapsed card. */
    function notePreview(note) {
      const text = String(stripColor(note) || '')
        .replace(/```[\s\S]*?```/g, ' ')
        .replace(/[#>*_`$\\]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
      return text.length > 160 ? `${text.slice(0, 160)}…` : text
    }

    /** One annotation's note: rendered Markdown, with question/answer rounds labelled. */
    function NoteBody(props) {
      const t = tRef.current
      if (stripColor(props.note).trim() === '') {
        return h('div', { className: 'dr-md' },
          h('p', { className: 'dr-md-p dr-note-empty' }, t('panel.emptyNote')))
      }
      const segments = splitThread(props.note)
      if (segments.length <= 1) {
        return h('div', { className: 'dr-md' }, ...renderNoteBlocks(props.note, 'n'))
      }
      return h('div', { className: 'dr-md' },
        ...segments.map((segment, index) => {
          if (segment.label === 'text') {
            return h('div', { className: 'dr-thread-text', key: `s${index}` },
              ...renderNoteBlocks(segment.text, `s${index}`))
          }
          return h('div', {
            className: segment.label === 'question' ? 'dr-thread-question' : 'dr-thread-answer',
            key: `s${index}`,
          },
            h('span', { className: 'dr-thread-label' },
              segment.label === 'question' ? t('thread.qShort') : t('thread.aShort')),
            ...renderNoteBlocks(segment.text, `s${index}`))
        }))
    }

    function userMessageText(node) {
      const content = node && Array.isArray(node.content) ? node.content : []
      return content
        .filter(block => block && block.type === 'text' && typeof block.text === 'string')
        .map(block => block.text)
        .join('\n')
    }

    function assistantMessageText(node) {
      const blocks = node && Array.isArray(node.blocks) ? node.blocks : []
      return blocks
        .filter(block => block && block.kind === 'text' && typeof block.text === 'string')
        .map(block => block.text)
        .join('\n')
        .trim()
    }

    /** Index of the user message that carried this question, or -1. */
    function findAskIndex(nodes, askText) {
      if (!Array.isArray(nodes) || !askText) return -1
      const wanted = String(askText).trim()
      for (let index = nodes.length - 1; index >= 0; index -= 1) {
        const node = nodes[index]
        if (node && node.kind === 'user' && userMessageText(node).trim() === wanted) return index
      }
      return -1
    }

    /** The finalized reply of the turn that answers the message at `askIndex`. */
    function answerAfter(nodes, turnEnds, askIndex) {
      let last = null
      for (let index = askIndex + 1; index < nodes.length; index += 1) {
        const node = nodes[index]
        if (!node) continue
        if (node.kind === 'user') break
        if (node.kind === 'assistant') {
          if (node.interrupted === true) continue
          const text = assistantMessageText(node)
          if (text) last = { text, turn: node.turn }
        }
      }
      if (!last) return null
      if (!turnEnds || typeof turnEnds.has !== 'function' || !turnEnds.has(last.turn)) return null
      return last.text
    }

    function removeCapture(id) {
      captureStore.set(list => list.filter(capture => capture.id !== id))
    }

    /** Append the answer to the annotation's thread once its turn has settled. */
    async function appendAnswer(capture, answer) {
      try {
        const data = await requestJson('list', { documentPath: capture.documentPath })
        const current = (data && Array.isArray(data.annotations) ? data.annotations : [])
          .find(annotation => annotation.id === capture.annotationId)
        if (!current) {
          removeCapture(capture.id)
          return
        }
        const line = format(tRef.current('thread.answer'), { text: answer })
        const combined = `${stripColor(current.note).trimEnd()}\n\n${line}`
        const clipped = combined.length <= NOTE_BODY_LIMIT
          ? combined
          : combined.slice(combined.length - NOTE_BODY_LIMIT)
        await requestJson('update', {
          id: capture.annotationId,
          note: withAnchor(
            withColor(clipped, colorOf(current.note) || annotationColor(current)),
            anchorOf(current.note),
          ),
        })
        removeCapture(capture.id)
        bumpVersion()
      } catch (error) {
        console.warn('[doc-reader] answer capture failed', error)
        removeCapture(capture.id)
      }
    }

    /**
     * Rendered (invisibly) in the composer dock so the session's conversation is
     * observable while the document or notes pane is in front. It pairs each
     * pending question with the settled assistant reply of its turn.
     */
    function AnswerCapture(props) {
      const sessionId = props.sessionId
      const captures = useStore(captureStore)
      const emptyNodes = React.useRef([])
      const emptyTurns = React.useRef(new Map())
      const nodes = props.useChat(snapshot => (snapshot.legacy ? snapshot.legacy.nodes : emptyNodes.current))
      const turnEnds = props.useChat(snapshot => (snapshot.legacy ? snapshot.legacy.turnEnds : emptyTurns.current))
      const inFlight = React.useRef(new Set())

      React.useEffect(() => {
        if (!sessionId || !Array.isArray(nodes)) return
        const now = Date.now()
        const stale = captures.filter(capture => now - capture.createdAt > 30 * 60 * 1000)
        if (stale.length > 0) {
          captureStore.set(list => list.filter(capture => now - capture.createdAt <= 30 * 60 * 1000))
          return
        }
        const pending = captures.filter(capture => capture.sessionId === sessionId && !inFlight.current.has(capture.id))
        for (const capture of pending) {
          const askIndex = findAskIndex(nodes, capture.askText)
          if (askIndex < 0) continue
          const answer = answerAfter(nodes, turnEnds, askIndex)
          if (!answer) continue
          inFlight.current.add(capture.id)
          void appendAnswer(capture, answer).finally(() => {
            inFlight.current.delete(capture.id)
          })
        }
      }, [captures, nodes, turnEnds, sessionId])

      return null
    }

    // ------------------------------------------------------------------ icons

    function icon(kind) {
      const common = {
        viewBox: '0 0 16 16', width: 15, height: 15, fill: 'none', stroke: 'currentColor',
        strokeWidth: 1.5, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': 'true',
      }
      switch (kind) {
        case 'ask':
          return h('svg', common,
            h('path', { d: 'M2.6 3.6h10.8v7.1H8.2L4.9 13v-2.3H2.6z' }),
            h('path', { d: 'M8 5.6v3.1M6.45 7.15h3.1' }),
          )
        case 'note':
          return h('svg', common, h('path', { d: 'M4 2.6h8v10.8l-4-2.5-4 2.5z' }))
        case 'list':
          return h('svg', common,
            h('path', { d: 'M3 4.2h10M3 8h10M3 11.8h6.2' }),
          )
        case 'close':
          return h('svg', common, h('path', { d: 'M4 4l8 8M12 4l-8 8' }))
        case 'refresh':
          return h('svg', common,
            h('path', { d: 'M13 8a5 5 0 1 1-1.6-3.7' }),
            h('path', { d: 'M13 2.8v2.9H10' }),
          )
        case 'chevron':
          return h('svg', common, h('path', { d: 'M6 4l4 4-4 4' }))
        default:
          return null
      }
    }

    // ----------------------------------------------------------------- stores

    /** Keeps one crashing surface from blanking the pane or the frame layer. */
    class Boundary extends React.Component {
      constructor(props) {
        super(props)
        this.state = { error: null }
      }

      static getDerivedStateFromError(error) {
        return { error }
      }

      componentDidCatch(error) {
        console.error('[doc-reader] surface crashed', error)
      }

      render() {
        if (this.state.error) {
          const message = this.state.error && this.state.error.message
            ? String(this.state.error.message)
            : String(this.state.error)
          return h('div', { className: 'dr-error', style: { margin: '8px' } }, message)
        }
        return this.props.children
      }
    }

    const selectionStore = createStore({ text: '', at: 0, title: '', truncated: false })
    const dialogStore = createStore(null)
    const versionStore = createStore(0)
    /** `{ path, quote, serial }`: a request for the mounted document toolbar to locate a quote. */
    const jumpStore = createStore(null)
    /** `{ id, note, quote, path, serial }`: bind an existing annotation to a newly selected occurrence. */
    const reanchorStore = createStore(null)
    /** `{ message, serial }`: a transient frame-wide notice. */
    const toastStore = createStore(null)
    /** `{ documentPath, annotationId, serial }`: open the notes page focused on one annotation. */
    const focusStore = createStore(null)
    /** Pending question/answer captures: `{ id, sessionId, documentPath, annotationId, question, askText }`. */
    const captureStore = createStore([])
    /** Ranges painted in the current preview, used to turn a click on a highlight into a panel focus. */
    let highlightRanges = []
    /** Last known annotations per document, so switching back paints instantly. */
    const annotationsCache = new Map()

    function annotationsSignature(list) {
      return list.map(annotation => `${annotation.id}:${annotation.updatedAt || ''}`).join('|')
    }

    function openDialog(next) {
      const returnFocus = typeof document !== 'undefined' ? document.activeElement : null
      dialogStore.set({ ...next, openedAt: Date.now(), returnFocus })
    }

    function closeDialog() {
      const current = dialogStore.get()
      dialogStore.set(null)
      const target = current && current.returnFocus
      if (target && typeof target.focus === 'function') {
        setTimeout(() => {
          try {
            target.focus()
          } catch {
            // The trigger can be gone after a tab switch; nothing to restore.
          }
        }, 0)
      }
    }

    function bumpVersion() {
      versionStore.set(value => value + 1)
    }

    // -------------------------------------------------------------- document UI

    function DocActions(props) {
      useLocaleTick()
      const selection = useStore(selectionStore)
      const jump = useStore(jumpStore)
      const reanchor = useStore(reanchorStore)
      const version = useStore(versionStore)
      const annotationsRef = React.useRef([])
      const toolbarRef = React.useRef(null)
      const [annotationCount, setAnnotationCount] = React.useState(0)
      const [tip, setTip] = React.useState(null)
      const sessionId = props.sessionId || (ctxRef.current && ctxRef.current.sidebarRight.mounted.getSnapshot())
      const path = typeof props.absolutePath === 'string' ? props.absolutePath : ''
      const name = baseName(path)
      const address = (() => {
        try {
          const tab = ctxRef.current && ctxRef.current.sidebarRight.active()
          return tab && typeof tab.contentId === 'string' && tab.contentId.startsWith('dsh-resource://')
            ? tab.contentId
            : ''
        } catch {
          return ''
        }
      })()
      // A snapshot from another document tab is not this document's selection.
      const sameDocument = selection.title === '' || name === '' || selection.title === name
      const fresh = selection.text !== '' && Date.now() - selection.at <= SELECTION_TTL_MS && sameDocument

      // Paint this document's annotations into the preview, and repaint as lazy
      // PDF text layers arrive. CSS Custom Highlight leaves the DOM alone.
      React.useEffect(() => {
        if (!path) return undefined
        let disposed = false
        let timer = null
        let attempts = 0
        let reported = false
        const paint = () => {
          if (disposed) return
          const root = previewRootWithin(toolbarRef.current)
          const painted = applyHighlights(annotationsRef.current, root)
          if (painted === 0 && annotationsRef.current.length > 0 && attempts < 8) {
            attempts += 1
            timer = setTimeout(paint, 500)
          } else if (painted === 0 && annotationsRef.current.length > 0 && !reported) {
            reported = true
            void requestJson('ping', {
              app: `hl-miss n=${annotationsRef.current.length} r=${root ? 1 : 0}`.slice(0, 60),
            }).catch(() => {})
          }
        }
        const load = async () => {
          const cached = annotationsCache.get(path)
          if (cached) {
            annotationsRef.current = cached.annotations
            setAnnotationCount(cached.annotations.length)
            paint()
          }
          try {
            const data = await requestJson('list', { documentPath: path })
            if (disposed) return
            const next = Array.isArray(data && data.annotations) ? data.annotations : []
            const changed = annotationsSignature(next) !== annotationsSignature(annotationsRef.current)
            annotationsCache.set(path, { annotations: next, at: Date.now() })
            if (changed) {
              annotationsRef.current = next
              setAnnotationCount(next.length)
              paint()
            }
          } catch (error) {
            console.warn('[doc-reader] highlight load failed', error)
          }
        }
        void load()
        const root = previewRootWithin(toolbarRef.current)
        const observer = root && typeof MutationObserver === 'function'
          ? new MutationObserver(() => {
            if (timer !== null) clearTimeout(timer)
            timer = setTimeout(paint, 600)
          })
          : null
        if (observer && root) observer.observe(root, { childList: true, subtree: true })
        return () => {
          disposed = true
          if (timer !== null) clearTimeout(timer)
          if (observer) observer.disconnect()
          clearHighlights()
        }
      }, [path, version])

      // Hovering a painted highlight previews its annotation; clicking it opens
      // the notes page. The same caret hit-testing drives both.
      React.useEffect(() => {
        if (typeof document === 'undefined') return undefined
        const root = previewRootWithin(toolbarRef.current)
        if (!root || typeof root.addEventListener !== 'function') return undefined
        let lastMove = 0
        let tipRef = null
        const hideTip = () => {
          if (tipRef === null) return
          tipRef = null
          setTip(null)
        }
        const findHit = (x, y) => {
          if (typeof document.caretRangeFromPoint !== 'function') return null
          const caret = document.caretRangeFromPoint(x, y)
          if (!caret) return null
          return highlightRanges.find((entry) => {
            try {
              return entry.range.isPointInRange(caret.startContainer, caret.startOffset)
            } catch {
              return false
            }
          }) || null
        }
        const onClick = (event) => {
          if (typeof event.clientX !== 'number') return
          const hit = findHit(event.clientX, event.clientY)
          if (!hit || !hit.annotation || !hit.annotation.id) return
          hideTip()
          focusStore.set({
            documentPath: path,
            annotationId: hit.annotation.id,
            serial: Date.now(),
          })
          openNotesPanel(ctxRef.current, { path, name, address })
        }
        const onMove = (event) => {
          const now = Date.now()
          if (now - lastMove < 110) return
          lastMove = now
          const hit = findHit(event.clientX, event.clientY)
          if (!hit || !hit.annotation || !hit.annotation.id) {
            hideTip()
            return
          }
          let rect = null
          try {
            rect = hit.range.getBoundingClientRect()
          } catch {
            rect = null
          }
          const x = rect ? rect.left : event.clientX
          const y = rect ? rect.bottom : event.clientY + 12
          if (tipRef !== null && tipRef.id === hit.annotation.id
            && Math.abs(tipRef.x - x) < 6 && Math.abs(tipRef.y - y) < 6) return
          tipRef = { id: hit.annotation.id, x, y }
          setTip({ id: hit.annotation.id, x, y, annotation: hit.annotation })
        }
        const onLeave = () => hideTip()
        const onScroll = () => hideTip()
        root.addEventListener('click', onClick, true)
        root.addEventListener('mousemove', onMove)
        root.addEventListener('mouseleave', onLeave)
        root.addEventListener('scroll', onScroll, true)
        return () => {
          root.removeEventListener('click', onClick, true)
          root.removeEventListener('mousemove', onMove)
          root.removeEventListener('mouseleave', onLeave)
          root.removeEventListener('scroll', onScroll, true)
        }
      }, [path, name, address])

      // A panel-issued locate request: wait for the preview, scroll to the quote
      // and keep it selected until the user moves on.
      React.useEffect(() => {
        if (!jump || !path) return undefined
        const normalize = value => String(value || '').replace(/\\/g, '/').toLowerCase()
        if (normalize(jump.path) !== normalize(path)) {
          void requestJson('ping', { app: 'jump-path-mismatch' }).catch(() => {})
          return undefined
        }
        const serial = jump.serial
        let cancelled = false
        let locating = null
        const run = async () => {
          let outcome = 'found'
          if (jump.quote) {
            locating = setTimeout(() => {
              if (!cancelled) showToast(tRef.current('toast.locating'))
            }, 700)
            outcome = await locateInDocument(
              () => previewRootWithin(toolbarRef.current),
              jump.quote,
              () => cancelled,
              jump.anchor,
            )
            if (locating) clearTimeout(locating)
          }
          if (cancelled) return
          if (jump.quote && outcome !== 'found') {
            showToast(tRef.current('toast.notFound'))
            void requestJson('ping', { app: `jump-${outcome}`.slice(0, 60) }).catch(() => {})
          } else {
            applyHighlights(annotationsRef.current, previewRootWithin(toolbarRef.current))
          }
          const current = jumpStore.get()
          if (current && current.serial === serial) jumpStore.set(null)
        }
        void run()
        return () => {
          cancelled = true
          if (locating) clearTimeout(locating)
        }
      }, [jump && jump.serial, path])

      const ask = () => {
        openDialog({
          mode: 'ask', sessionId, path, name, address,
          quote: fresh ? selection.text : '',
          anchor: fresh ? buildSelectionAnchor(previewRootWithin(toolbarRef.current)) : null,
          truncated: fresh ? selection.truncated === true : false,
          needsSelection: !fresh,
        })
      }
      const annotate = () => {
        openDialog({
          mode: 'note', sessionId, path, name, address,
          quote: fresh ? selection.text : '',
          anchor: fresh ? buildSelectionAnchor(previewRootWithin(toolbarRef.current)) : null,
          truncated: fresh ? selection.truncated === true : false,
        })
      }
      const list = () => {
        openNotesPanel(ctxRef.current, path ? { path, name, address } : undefined)
      }

      const normalizePath = value => String(value || '').replace(/\\/g, '/').toLowerCase()
      const reanchorActive = Boolean(reanchor && path && normalizePath(reanchor.path) === normalizePath(path))
      const bindAnchor = async () => {
        if (!reanchor) return
        const anchor = buildSelectionAnchor(previewRootWithin(toolbarRef.current))
        if (!anchor) {
          showToast(tRef.current('toast.reanchorNeedSelection'))
          return
        }
        try {
          const data = await requestJson('list', { documentPath: path })
          const current = (data && Array.isArray(data.annotations) ? data.annotations : [])
            .find(annotation => annotation.id === reanchor.id)
          if (!current) {
            reanchorStore.set(null)
            showToast(tRef.current('toast.reanchorFailed'))
            return
          }
          const color = colorOf(current.note) || (isAskAnnotation(current) ? 'g' : 'b')
          const body = stripColor(current.note).slice(0, NOTE_BODY_LIMIT)
          await requestJson('update', {
            id: reanchor.id,
            note: withAnchor(withColor(body, color), anchor),
          })
          reanchorStore.set(null)
          bumpVersion()
          showToast(tRef.current('toast.reanchored'))
        } catch (failure) {
          console.warn('[doc-reader] reanchor failed', failure)
          showToast(tRef.current('toast.reanchorFailed'))
        }
      }

      const tipAnnotation = tip && tip.annotation ? tip.annotation : null
      const tipColor = tipAnnotation ? annotationColor(tipAnnotation) : COLOR_DEFAULT_NOTE
      const tipNode = tipAnnotation
        ? h(Layer, null,
            h('div', {
              className: 'dr-hover',
              style: {
                left: `${Math.max(8, Math.min(tip.x, (typeof window !== 'undefined' ? window.innerWidth : 1200) - 372))}px`,
                top: `${Math.max(8, Math.min(tip.y + 10, (typeof window !== 'undefined' ? window.innerHeight : 800) - 210))}px`,
              },
            },
              h('div', { className: 'dr-hover-head' },
                h('span', { className: `dr-color-dot dr-color-${tipColor}`, 'aria-hidden': 'true' }),
                h('span', { className: `dr-badge${isAskAnnotation(tipAnnotation) ? ' dr-badge-ask' : ''}` },
                  isAskAnnotation(tipAnnotation) ? tRef.current('panel.typeAsk') : tRef.current('panel.typeSelection'))),
              tipAnnotation.quote
                ? h('div', { className: 'dr-hover-quote' }, tipAnnotation.quote)
                : null,
              notePreview(tipAnnotation.note)
                ? h('div', { className: 'dr-hover-note' }, notePreview(tipAnnotation.note))
                : null,
              h('div', { className: 'dr-hover-hint' }, tRef.current('hover.hint'))))
        : null

      return h(React.Fragment, null,
        h('span', { ref: toolbarRef, className: 'dr-actions' },
          h('button', {
            type: 'button', className: 'dr-icon-btn',
            title: tRef.current(fresh ? 'action.ask' : 'action.askHint'),
            'aria-label': tRef.current('action.ask'),
            onMouseDown: event => event.preventDefault(),
            onClick: ask,
          }, icon('ask')),
          h('button', {
            type: 'button', className: 'dr-icon-btn',
            title: tRef.current('action.noteHint'),
            'aria-label': tRef.current('action.note'),
            onMouseDown: event => event.preventDefault(),
            onClick: annotate,
          }, icon('note')),
          h('button', {
            type: 'button', className: 'dr-icon-btn',
            title: tRef.current('action.notesHint'),
            'aria-label': tRef.current('action.notes'),
            onMouseDown: event => event.preventDefault(),
            onClick: list,
          }, icon('list'), annotationCount > 0
            ? h('span', { className: 'dr-count' }, annotationCount > 99 ? '99+' : String(annotationCount))
            : null),
          reanchorActive
            ? h('span', { className: 'dr-reanchor-tools' },
              h('button', {
                type: 'button', className: 'dr-reanchor-btn',
                onMouseDown: event => event.preventDefault(),
                onClick: () => { void bindAnchor() },
              }, tRef.current('reanchor.bind')),
              h('button', {
                type: 'button', className: 'dr-link',
                onMouseDown: event => event.preventDefault(),
                onClick: () => reanchorStore.set(null),
              }, tRef.current('reanchor.cancel')))
            : null,
        ),
        tipNode,
      )
    }

    /**
     * Open the annotations page in the right Sidebar.
     *
     * `openTab` is the product API, but an open that returns without throwing
     * can still leave the document tab in front (or the column collapsed), so
     * the page is placed through the resource path when it is not active and
     * the column is expanded before returning.
     */
    function openNotesPanel(ctx, target) {
      if (!ctx) return
      const params = target && target.path
        ? {
            documentPath: target.path,
            documentName: target.name || baseName(target.path),
            ...(target.address ? { documentAddress: target.address } : {}),
          }
        : undefined
      const options = params ? { params } : undefined
      const isNotesTabActive = () => {
        try {
          const active = ctx.sidebarRight.active()
          return active !== undefined && active.kind === TAB_KIND
        } catch {
          return false
        }
      }
      const ensureExpanded = () => {
        try {
          if (!ctx.sidebarRight.isExpanded()) ctx.sidebarRight.toggleExpanded()
        } catch {
          // Presentation failure must not hide a successful open.
        }
      }
      const openAsResource = () => ctx.sidebarRight.openResource('dsh-resource://doc-notes/page', {
        kind: TAB_KIND,
        ...(options || {}),
      })
      try {
        ctx.sidebarRight.openTab(TAB_KIND, options)
        if (!isNotesTabActive()) openAsResource()
        ensureExpanded()
      } catch (error) {
        console.warn('[doc-reader] open notes tab failed, retrying as a resource', error)
        try {
          openAsResource()
          ensureExpanded()
        } catch (fallbackError) {
          console.warn('[doc-reader] open notes resource failed', fallbackError)
        }
      }
    }

    // ------------------------------------------------------------------ dialog

    function AssistantDialog() {
      useLocaleTick()
      const dialog = useStore(dialogStore)
      const [question, setQuestion] = React.useState('')
      const [note, setNote] = React.useState('')
      const [busy, setBusy] = React.useState(false)
      const [saved, setSaved] = React.useState(false)
      const [error, setError] = React.useState('')
      const [color, setColor] = React.useState(COLOR_DEFAULT_NOTE)
      const textareaRef = React.useRef(null)
      const dialogRef = React.useRef(null)
      const t = tRef.current

      React.useEffect(() => {
        setQuestion('')
        setNote('')
        setBusy(false)
        setSaved(false)
        setError('')
        setColor(dialog && COLOR_KEYS.includes(dialog.color)
          ? dialog.color
          : (dialog && dialog.mode === 'note' ? COLOR_DEFAULT_NOTE : COLOR_DEFAULT_ASK))
        if (dialog) {
          const timer = setTimeout(() => {
            if (textareaRef.current) textareaRef.current.focus()
          }, 0)
          return () => clearTimeout(timer)
        }
        return undefined
      }, [dialog])

      React.useEffect(() => {
        if (!dialog) return undefined
        const onKey = event => {
          if (event.key === 'Escape') {
            event.preventDefault()
            event.stopPropagation()
            closeDialog()
            return
          }
          if (event.key !== 'Tab') return
          const root = dialogRef.current
          if (!root) return
          const focusable = [...root.querySelectorAll('button:not(:disabled), textarea, input')]
          if (focusable.length === 0) return
          const first = focusable[0]
          const last = focusable[focusable.length - 1]
          if (!event.shiftKey && document.activeElement === last) {
            event.preventDefault()
            first.focus()
          } else if (event.shiftKey && document.activeElement === first) {
            event.preventDefault()
            last.focus()
          }
        }
        window.addEventListener('keydown', onKey, true)
        const previous = document.body.style.overflow
        document.body.style.overflow = 'hidden'
        return () => {
          window.removeEventListener('keydown', onKey, true)
          document.body.style.overflow = previous
        }
      }, [dialog])

      if (!dialog) return null

      const mode = dialog.mode === 'note' ? 'note' : 'ask'
      const quote = typeof dialog.quote === 'string' ? dialog.quote.trim() : ''
      const name = dialog.name || baseName(dialog.path) || t('panel.title')

      async function sendAsk() {
        const input = inputFor(ctxRef.current, dialog.sessionId)
        if (!input) {
          setError(t('error.inputUnavailable'))
          return
        }
        const state = input.state && input.state.getSnapshot ? input.state.getSnapshot() : { phase: 'plain', draft: '' }
        if (state.phase && state.phase !== 'plain') {
          setError(t('error.busy'))
          return
        }
        const text = buildAskText(t, { name, quote, question })
        // Never destroy a draft the user already typed: append it and let them send.
        if (typeof state.draft === 'string' && state.draft.trim() !== '') {
          if (!insertAtCaret(input, text)) {
            setError(t('error.inputUnavailable'))
            return
          }
          try {
            input.focus()
          } catch (failure) {
            console.warn('[doc-reader] focus failed', failure)
          }
          closeDialog()
          return
        }
        setBusy(true)
        setError('')
        try {
          input.setDraft(text)
          await sleep(60)
          input.submit('queue', 'click')
          recordAskAnnotation()
          closeDialog()
        } catch (failure) {
          console.warn('[doc-reader] ask failed', failure)
          try {
            input.setDraft(state.draft || '')
          } catch {
            // Restoring the empty draft is best effort.
          }
          setError(t('error.inputUnavailable'))
          setBusy(false)
        }
      }

      async function quoteOnly() {
        const input = inputFor(ctxRef.current, dialog.sessionId)
        if (!input) {
          setError(t('error.inputUnavailable'))
          return
        }
        const ok = insertAtCaret(input, buildQuoteText(t, { name, quote }))
        if (!ok) {
          setError(t('error.inputUnavailable'))
          return
        }
        try {
          input.focus()
        } catch (failure) {
          console.warn('[doc-reader] focus failed', failure)
        }
        closeDialog()
      }

      /** Keep every sent question, then append its answer when the turn settles. */
      async function recordAskAnnotation() {
        if (!dialog.path) return
        const asked = question.trim()
        const askText = buildAskText(t, { name, quote, question })
        const questionLine = format(t('thread.question'), { text: asked || t('annotation.askFallback') })
        const clip = text => (text.length <= NOTE_BODY_LIMIT ? text : text.slice(text.length - NOTE_BODY_LIMIT))
        try {
          const data = await requestJson('list', { documentPath: dialog.path })
          const candidates = Array.isArray(data && data.annotations) ? data.annotations : []
          const existing = quote !== ''
            ? candidates.find(annotation => annotation.quote === quote && isAskAnnotation(annotation))
            : undefined
          let annotationId
          if (existing) {
            const base = existing.note === existing.question
              ? format(t('thread.question'), { text: existing.question })
              : stripColor(existing.note).trimEnd()
            await requestJson('update', {
              id: existing.id,
              note: withAnchor(withColor(clip(`${base}\n\n${questionLine}`), color), anchorOf(existing.note)),
            })
            annotationId = existing.id
          } else {
            const created = await requestJson('add', {
              documentPath: dialog.path,
              documentName: name,
              type: quote ? 'selection' : 'document',
              quote,
              note: withAnchor(withColor(clip(questionLine), color), dialog.anchor),
              ...(asked ? { question: asked } : {}),
              sessionId: dialog.sessionId,
              ...(dialog.address ? { documentAddress: dialog.address } : {}),
            })
            annotationId = created.annotation.id
          }
          bumpVersion()
          captureStore.set(list => [...list, {
            id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
            sessionId: dialog.sessionId,
            documentPath: dialog.path,
            annotationId,
            question: asked,
            askText,
            createdAt: Date.now(),
          }])
        } catch (failure) {
          console.warn('[doc-reader] automatic annotation failed', failure)
        }
      }

      async function saveNote() {
        const text = note.trim()
        if (!dialog.path) {
          setError(t('error.no-document'))
          return
        }
        setBusy(true)
        setError('')
        try {
          await requestJson('add', {
            documentPath: dialog.path,
            documentName: name,
            type: quote ? 'selection' : 'document',
            quote,
            note: withAnchor(withColor(text.slice(0, NOTE_BODY_LIMIT), color), dialog.anchor),
            sessionId: dialog.sessionId,
            ...(dialog.address ? { documentAddress: dialog.address } : {}),
          })
          bumpVersion()
          setBusy(false)
          setSaved(true)
          // Stay in the document; the notes page is reachable from the toolbar.
          setTimeout(() => {
            closeDialog()
            showToast(t('toast.saved'))
          }, 500)
        } catch (failure) {
          setError(errorText(t, failure))
          setBusy(false)
        }
      }

      const onTextareaKeyDown = event => {
        if (event.key !== 'Enter' || event.shiftKey || event.isComposing) return
        event.preventDefault()
        if (!busy) {
          if (mode === 'ask') void sendAsk()
          else void saveNote()
        }
      }

      return h('div', {
        className: 'dr-overlay',
        onMouseDown: event => {
          if (event.target !== event.currentTarget) return
          const typed = mode === 'ask' ? question.trim() : note.trim()
          if (typed !== '') return
          closeDialog()
        },
      },
        h('div', {
          ref: dialogRef,
          className: 'dr-dialog', role: 'dialog', 'aria-modal': 'true',
          'aria-label': mode === 'ask' ? t('dialog.askTitle') : t('dialog.noteTitle'),
        },
          h('div', { className: 'dr-dialog-head' },
            h('div', { className: 'dr-dialog-title' }, mode === 'ask' ? t('dialog.askTitle') : t('dialog.noteTitle')),
            h('button', {
              type: 'button', className: 'dr-icon-btn', title: t('dialog.cancel'),
              'aria-label': t('dialog.cancel'), onClick: closeDialog,
            }, icon('close')),
          ),
          h('div', { className: 'dr-dialog-body' },
            h('div', { className: 'dr-field' },
              h('div', { className: 'dr-field-label' },
                h('span', null, quote ? t('dialog.quoteLabel') : t('dialog.documentNote')),
                h('span', null, quote ? format(t('dialog.quoteChars'), { count: quote.length }) : ''),
              ),
              quote
                ? h('blockquote', { className: 'dr-quote' }, quote)
                : h('div', { className: 'dr-quote-missing' },
                  mode === 'ask' || dialog.needsSelection ? t('dialog.askNeedsSelection') : t('dialog.noQuote')),
              dialog.truncated
                ? h('div', { className: 'dr-meta' }, format(t('dialog.truncated'), { count: quote.length }))
                : null,
            ),
            h('div', { className: 'dr-field' },
              h('div', { className: 'dr-field-label' }, h('span', null, t('dialog.source')), h('span', null, name)),
            ),
            h('div', { className: 'dr-color-row' },
              h('span', { className: 'dr-color-label' }, t('dialog.color')),
              ...COLOR_KEYS.map(key => h('button', {
                key,
                type: 'button',
                className: `dr-color-swatch dr-color-${key}${color === key ? ' dr-color-active' : ''}`,
                title: t(`color.${key}`),
                'aria-label': t(`color.${key}`),
                'aria-pressed': color === key,
                onClick: () => setColor(key),
              }))),
            mode === 'ask' ? [
              h('div', { className: 'dr-field', key: 'quick' },
                h('div', { className: 'dr-field-label' }, h('span', null, t('dialog.questionLabel')), null),
                h('div', { className: 'dr-chips' }, ...QUICK_QUESTIONS.map(id => h('button', {
                  key: id, type: 'button', className: 'dr-chip',
                  onClick: () => setQuestion(current => {
                    const template = t(`quick.${id}.text`)
                    const trimmed = current.trim()
                    return trimmed === '' ? template : `${trimmed} ${template}`
                  }),
                }, t(`quick.${id}`)))),
              ),
              h('textarea', {
                key: 'question', ref: textareaRef, className: 'dr-textarea',
                maxLength: 2000,
                value: question, placeholder: t('dialog.questionPlaceholder'),
                'aria-label': t('dialog.questionLabel'),
                onChange: event => setQuestion(event.target.value),
                onKeyDown: onTextareaKeyDown,
              }),
            ] : [
              h('div', { className: 'dr-field', key: 'note' },
                h('div', { className: 'dr-field-label' }, h('span', null, t('dialog.noteLabel')), null),
                h('textarea', {
                  ref: textareaRef, className: 'dr-textarea', value: note,
                  maxLength: 4000,
                  placeholder: t('dialog.notePlaceholder'), 'aria-label': t('dialog.noteLabel'),
                  onChange: event => setNote(event.target.value),
                  onKeyDown: onTextareaKeyDown,
                }),
              ),
            ],
            error
              ? h('div', { className: 'dr-error' }, h('span', null, error))
              : saved ? h('div', { className: 'dr-success' }, h('span', null, t('dialog.saved'))) : null,
          ),
          h('div', { className: 'dr-dialog-foot' },
            h('div', { className: 'dr-dialog-foot-spacer' }),
            h('button', {
              type: 'button', className: 'dr-btn', disabled: busy, onClick: closeDialog,
            }, t('dialog.cancel')),
            mode === 'ask' ? h('button', {
              type: 'button', className: 'dr-btn', disabled: busy || saved || quote === '', onClick: () => { void quoteOnly() },
            }, t('dialog.quoteOnly')) : null,
            mode === 'ask'
              ? h('button', {
                type: 'button', className: 'dr-btn dr-btn-primary', disabled: busy || saved || quote === '',
                onClick: () => { void sendAsk() },
              }, busy ? t('dialog.sending') : t('dialog.send'))
              : h('button', {
                type: 'button', className: 'dr-btn dr-btn-primary', disabled: busy || saved,
                onClick: () => { void saveNote() },
              }, saved ? t('dialog.saved') : busy ? t('dialog.saving') : t('dialog.save')),
          ),
          h('span', { className: 'dr-sr', 'aria-live': 'polite' }, error),
        ),
      )
    }

    // ------------------------------------------------------------------- toast

    function Toast() {
      useLocaleTick()
      const toast = useStore(toastStore)
      if (!toast) return null
      return h('div', { className: 'dr-toast', role: 'status' }, toast.message)
    }

    // ------------------------------------------------------------------- panel

    function NotesPanel(props) {
      useLocaleTick()
      const info = props.useTabInfo()
      const navigation = info && info.tab ? info.tab.navigation : null
      const revision = navigation ? navigation.revision : 0
      const params = navigation && navigation.params && typeof navigation.params === 'object' ? navigation.params : {}
      const initialPath = typeof params.documentPath === 'string' ? params.documentPath : ''
      const initialName = typeof params.documentName === 'string' ? params.documentName : baseName(initialPath)
      const sessionId = props.sessionId

      const [path, setPath] = React.useState(initialPath)
      const [name, setName] = React.useState(initialName || baseName(initialPath))
      const [address, setAddress] = React.useState(typeof params.documentAddress === 'string' ? params.documentAddress : '')
      const [documents, setDocuments] = React.useState([])
      const [annotations, setAnnotations] = React.useState([])
      const [loading, setLoading] = React.useState(true)
      const [error, setError] = React.useState(null)
      const [editingId, setEditingId] = React.useState(null)
      const [editNote, setEditNote] = React.useState('')
      const [confirmId, setConfirmId] = React.useState(null)
      const [focusedId, setFocusedId] = React.useState(null)
      const [openMap, setOpenMap] = React.useState({})
      const [fontSize, setFontSize] = React.useState(readFontSize)
      const focusTimer = React.useRef(null)
      const version = useStore(versionStore)
      const focus = useStore(focusStore)
      const t = tRef.current

      React.useEffect(() => {
        storeFontSize(fontSize)
      }, [fontSize])

      const isThread = annotation => isAskAnnotation(annotation)
      const isOpen = annotation => {
        if (openMap[annotation.id] !== undefined) return openMap[annotation.id]
        return String(annotation.note || '').length <= 220 && !isThread(annotation)
      }
      const toggle = annotation => setOpenMap(map => ({ ...map, [annotation.id]: !isOpen(annotation) }))
      const anyOpen = annotations.some(annotation => isOpen(annotation))

      React.useEffect(() => () => {
        if (focusTimer.current) clearTimeout(focusTimer.current)
      }, [])

      // A click on an in-text highlight asks this page to reveal its card.
      React.useEffect(() => {
        if (!focus || annotations.length === 0) return
        const found = annotations.find(annotation => annotation.id === focus.annotationId)
        focusStore.set(null)
        if (!found) return
        setFocusedId(found.id)
        setOpenMap(map => ({ ...map, [found.id]: true }))
        const element = typeof document !== 'undefined'
          ? document.querySelector(`[data-dr-annotation="${found.id}"]`)
          : null
        if (element && typeof element.scrollIntoView === 'function') {
          element.scrollIntoView({ block: 'center', behavior: 'smooth' })
        }
        if (focusTimer.current) clearTimeout(focusTimer.current)
        focusTimer.current = setTimeout(() => setFocusedId(null), 2600)
      }, [focus, annotations])

      React.useEffect(() => {
        if (!navigation) return
        const next = navigation.params && typeof navigation.params === 'object' ? navigation.params : {}
        const nextPath = typeof next.documentPath === 'string' ? next.documentPath : ''
        if (nextPath !== '' && nextPath !== path) {
          setPath(nextPath)
          setName(typeof next.documentName === 'string' && next.documentName !== '' ? next.documentName : baseName(nextPath))
        }
        if (typeof next.documentAddress === 'string' && next.documentAddress !== address) {
          setAddress(next.documentAddress)
        }
      }, [revision])

      React.useEffect(() => {
        let alive = true
        setLoading(true)
        setError(null)
        const cached = path ? annotationsCache.get(path) : null
        if (cached) {
          setAnnotations(cached.annotations)
          setLoading(false)
        }
        ;(async () => {
          try {
            const docs = await requestJson('documents')
            if (!alive) return
            setDocuments(Array.isArray(docs && docs.documents) ? docs.documents : [])
            if (path) {
              const data = await requestJson('list', { documentPath: path })
              if (!alive) return
              const next = Array.isArray(data && data.annotations) ? data.annotations : []
              annotationsCache.set(path, { annotations: next, at: Date.now() })
              setAnnotations(current => annotationsSignature(current) === annotationsSignature(next) ? current : next)
            } else {
              setAnnotations([])
            }
          } catch (failure) {
            if (alive) setError(failure)
          } finally {
            if (alive) setLoading(false)
          }
        })()
        return () => { alive = false }
      }, [path, version])

      const selectDocument = (document) => {
        setPath(document.documentPath)
        setName(document.documentName || baseName(document.documentPath))
        setEditingId(null)
        setConfirmId(null)
      }

      const backToAll = () => {
        setPath('')
        setName('')
        setEditingId(null)
        setConfirmId(null)
      }

      const refresh = () => bumpVersion()

      const annotateDocument = () => {
        if (!path) return
        openDialog({ mode: 'note', sessionId, path, name, address, quote: '' })
      }

      /** Focus the document tab and ask the toolbar to scroll to this quote. */
      const locate = (annotation) => {
        const target = {
          documentPath: annotation.documentPath,
          documentName: annotation.documentName || baseName(annotation.documentPath),
          documentAddress: annotation.documentAddress || address,
        }
        jumpStore.set({
          path: path || target.documentPath,
          quote: annotation.quote || '',
          anchor: anchorOf(annotation.note),
          serial: Date.now(),
        })
        if (focusDocumentTab(ctxRef.current, target)) return
        jumpStore.set(null)
        setError(new ApiError('document-not-open'))
      }

      /** Focus the document tab and paint every annotation of this document. */
      const highlightAll = () => {
        if (!path) return
        jumpStore.set({ path, quote: '', serial: Date.now() })
        if (focusDocumentTab(ctxRef.current, { documentPath: path, documentName: name, documentAddress: address })) return
        jumpStore.set(null)
        setError(new ApiError('document-not-open'))
      }

      const quoteAnnotation = (annotation) => {
        const input = inputFor(ctxRef.current, sessionId)
        if (!input) {
          setError(new ApiError('inputUnavailable'))
          return
        }
        const text = buildReferenceText(t, {
          name: path ? name : (annotation.documentName || baseName(annotation.documentPath)),
          quote: annotation.quote,
          note: stripColor(annotation.note),
        })
        if (!insertAtCaret(input, text)) {
          setError(new ApiError('inputUnavailable'))
          return
        }
        try {
          input.focus()
        } catch (failure) {
          console.warn('[doc-reader] focus failed', failure)
        }
      }

      /** Ask another question about this annotation's quote; it joins the same thread. */
      const askAgain = (annotation) => {
        if (!annotation.quote) return
        openDialog({
          mode: 'ask',
          sessionId,
          path,
          name,
          address,
          quote: annotation.quote,
          color: annotationColor(annotation),
          anchor: anchorOf(annotation.note),
          truncated: false,
          needsSelection: false,
        })
      }

      /** Let the user select the correct occurrence again and rebind this annotation. */
      const reanchorAnnotation = (annotation) => {
        if (!annotation.quote) return
        const target = {
          documentPath: annotation.documentPath,
          documentName: annotation.documentName || baseName(annotation.documentPath),
          documentAddress: annotation.documentAddress || address,
        }
        reanchorStore.set({
          id: annotation.id,
          note: annotation.note,
          quote: annotation.quote,
          path: path || target.documentPath,
          serial: Date.now(),
        })
        if (focusDocumentTab(ctxRef.current, target)) {
          showToast(t('toast.reanchorHint'))
          return
        }
        reanchorStore.set(null)
        setError(new ApiError('document-not-open'))
      }

      const changeColor = async (annotation) => {
        const next = nextColor(annotationColor(annotation))
        try {
          await requestJson('update', {
            id: annotation.id,
            note: withAnchor(
              withColor(stripColor(annotation.note).slice(0, NOTE_BODY_LIMIT), next),
              anchorOf(annotation.note),
            ),
          })
          bumpVersion()
        } catch (failure) {
          setError(failure)
        }
      }

      const startEdit = (annotation) => {
        setEditingId(annotation.id)
        setEditNote(stripColor(annotation.note))
        setConfirmId(null)
        setOpenMap(map => ({ ...map, [annotation.id]: true }))
      }

      const saveEdit = async (annotation) => {
        try {
          await requestJson('update', {
            id: annotation.id,
            note: withAnchor(
              withColor(editNote.trim().slice(0, NOTE_BODY_LIMIT), annotationColor(annotation)),
              anchorOf(annotation.note),
            ),
          })
          setEditingId(null)
          bumpVersion()
        } catch (failure) {
          setError(failure)
        }
      }

      const removeAnnotation = async (annotation) => {
        try {
          await requestJson('delete', { id: annotation.id })
          setConfirmId(null)
          bumpVersion()
        } catch (failure) {
          setError(failure)
        }
      }

      const fontTools = h('span', { className: 'dr-font-tools' },
        h('button', {
          type: 'button', className: 'dr-link dr-font-btn', title: t('panel.fontSmaller'),
          'aria-label': t('panel.fontSmaller'),
          onClick: () => setFontSize(size => Math.max(12, size - 1)),
        }, 'A-'),
        h('button', {
          type: 'button', className: 'dr-link dr-font-btn', title: t('panel.fontLarger'),
          'aria-label': t('panel.fontLarger'),
          onClick: () => setFontSize(size => Math.min(20, size + 1)),
        }, 'A+'),
      )
      const head = h('div', { className: 'dr-panel-head' },
        h('div', { className: 'dr-panel-title-row' },
          h('span', { className: 'dr-panel-title', title: path || undefined },
            path ? (name || baseName(path)) : t('panel.allDocuments')),
          h('button', {
            type: 'button', className: 'dr-icon-btn', title: t('panel.refresh'),
            'aria-label': t('panel.refresh'), onClick: refresh,
          }, icon('refresh')),
        ),
        h('div', { className: 'dr-panel-tools-row' },
          h('span', { className: 'dr-panel-tools' },
            path
              ? h('button', { type: 'button', className: 'dr-link', onClick: backToAll }, t('panel.back'))
              : null,
            path && annotations.length > 0
              ? h('button', {
                type: 'button',
                className: 'dr-link',
                onClick: () => {
                  const target = !anyOpen
                  const next = {}
                  for (const annotation of annotations) next[annotation.id] = target
                  setOpenMap(next)
                },
              }, anyOpen ? t('panel.collapseAll') : t('panel.expandAll'))
              : null,
            path
              ? h('button', { type: 'button', className: 'dr-link', onClick: highlightAll }, t('panel.highlightAll'))
              : null,
            path
              ? h('button', { type: 'button', className: 'dr-link', onClick: annotateDocument }, t('panel.annotateDocument'))
              : null,
          ),
          fontTools,
        ),
        h('div', { className: 'dr-meta' },
          path ? path : format(t('panel.documents'), { count: documents.length })),
      )

      const banner = error
        ? h('div', { className: 'dr-error' },
          h('span', null, errorText(t, error)),
          h('button', { type: 'button', className: 'dr-link', onClick: refresh }, t('panel.retry')),
        )
        : null

      const hasData = annotations.length > 0 || documents.length > 0
      let content = null
      if (loading && !hasData) {
        content = h('div', { className: 'dr-loading' },
          h('span', { className: 'dr-spinner', 'aria-hidden': 'true' }), t('panel.loading'))
      } else if (path && annotations.length > 0) {
        content = annotations.map(annotation => {
          const editing = editingId === annotation.id
          const confirming = confirmId === annotation.id
          const created = annotation.createdAt
          const updated = annotation.updatedAt && annotation.updatedAt !== created
            ? format(t('panel.updated'), { time: formatTime(annotation.updatedAt) })
            : formatTime(created)
          return h('div', {
            className: `dr-card${focusedId === annotation.id ? ' dr-card-focus' : ''}`,
            key: annotation.id,
            'data-dr-annotation': annotation.id,
          },
            h('div', {
              className: 'dr-card-head',
              onClick: event => {
                if (event.target && event.target.closest && event.target.closest('button, a, input, textarea, select')) return
                toggle(annotation)
              },
            },
              h('span', { className: `dr-badge${isAskAnnotation(annotation) ? ' dr-badge-ask' : ''}` },
                isAskAnnotation(annotation)
                  ? t('panel.typeAsk')
                  : annotation.type === 'document' ? t('panel.typeDocument') : t('panel.typeSelection')),
              h('span', { className: 'dr-card-head-right' },
                h('button', {
                  type: 'button',
                  className: `dr-color-dot dr-color-${annotationColor(annotation)}`,
                  title: t('panel.color'),
                  'aria-label': t('panel.color'),
                  onClick: event => {
                    event.stopPropagation()
                    void changeColor(annotation)
                  },
                }),
                h('span', { className: 'dr-meta' }, updated),
                h('button', {
                  type: 'button',
                  className: `dr-link dr-chevron${isOpen(annotation) ? ' dr-chevron-open' : ''}`,
                  'aria-expanded': isOpen(annotation),
                  'aria-label': isOpen(annotation) ? t('panel.collapse') : t('panel.expand'),
                  onClick: () => toggle(annotation),
                }, icon('chevron'))),
            ),
            annotation.quote ? h('blockquote', { className: 'dr-card-quote' }, annotation.quote) : null,
            editing
              ? h('div', { className: 'dr-field' },
                h('textarea', {
                  className: 'dr-textarea', value: editNote,
                  'aria-label': t('panel.editAction'),
                  onChange: event => setEditNote(event.target.value),
                }),
                h('div', { className: 'dr-card-actions' },
                  h('button', {
                    type: 'button', className: 'dr-btn', onClick: () => { setEditingId(null) },
                  }, t('panel.cancelEdit')),
                  h('button', {
                    type: 'button', className: 'dr-btn dr-btn-primary',
                    onClick: () => { void saveEdit(annotation) },
                  }, t('panel.saveEdit')),
                ),
              )
              : isOpen(annotation)
                ? h(NoteBody, { note: stripColor(annotation.note) })
                : h('div', {
                  className: 'dr-card-preview',
                  onClick: () => setOpenMap(map => ({ ...map, [annotation.id]: true })),
                }, notePreview(annotation.note) || t('panel.emptyNote')),
            editing ? null : h('div', { className: 'dr-card-actions' },
              annotation.quote
                ? h('button', { type: 'button', className: 'dr-link', onClick: () => locate(annotation) }, t('panel.locate'))
                : null,
              annotation.quote
                ? h('button', { type: 'button', className: 'dr-link', onClick: () => askAgain(annotation) }, t('panel.askAgain'))
                : null,
              annotation.quote
                ? h('button', { type: 'button', className: 'dr-link', onClick: () => reanchorAnnotation(annotation) }, t('panel.reanchor'))
                : null,
              h('button', { type: 'button', className: 'dr-link', onClick: () => quoteAnnotation(annotation) }, t('panel.quoteAction')),
              h('button', { type: 'button', className: 'dr-link', onClick: () => startEdit(annotation) }, t('panel.editAction')),
              confirming
                ? [
                  h('span', { key: 'label', className: 'dr-meta' }, t('panel.deleteConfirm')),
                  h('button', { key: 'yes', type: 'button', className: 'dr-link dr-link-danger', onClick: () => { void removeAnnotation(annotation) } }, t('panel.confirm')),
                  h('button', { key: 'no', type: 'button', className: 'dr-link', onClick: () => { setConfirmId(null) } }, t('panel.cancelEdit')),
                ]
                : h('button', {
                  type: 'button', className: 'dr-link dr-link-danger',
                  onClick: () => { setConfirmId(annotation.id) },
                }, t('panel.deleteAction')),
            ),
          )
        })
      } else if (!path && documents.length > 0) {
        content = documents.map(document => h('button', {
          type: 'button', className: 'dr-doc-row', key: document.documentId,
          onClick: () => selectDocument(document),
        },
          h('span', { className: 'dr-doc-row-main' },
            h('span', { className: 'dr-doc-row-name' }, document.documentName || baseName(document.documentPath)),
            h('span', { className: 'dr-meta' }, document.documentPath),
          ),
          h('span', { className: 'dr-meta' }, format(t('panel.noteCount'), { count: document.count })),
        ))
      } else if (!error) {
        content = h('div', { className: 'dr-empty' },
          h('span', null, path ? t('panel.empty') : t('panel.emptyAll')),
          h('br'),
          h('br'),
          t('panel.emptyHint'))
      }

      return h('div', {
        className: 'dr-panel',
        style: { '--dr-read-font': `${fontSize}px` },
      }, head,
        h('div', { className: 'dr-panel-body' }, banner, content))
    }

    // ------------------------------------------------------------------- apply

    /** Captured once per activation; components read them through refs. */
    const ctxRef = { current: null }
    const tRef = { current: key => key }

    function registerUi(ctx) {
      const t = ctx.locale.bind(NS)
      tRef.current = t
      ctxRef.current = ctx

      ctx.effect(() => {
        if (typeof document === 'undefined' || !document.head) return () => {}
        const style = document.createElement('style')
        style.setAttribute('data-doc-reader-styles', '')
        style.textContent = STYLES
        document.head.appendChild(style)
        return () => {
          if (style.parentNode) style.parentNode.removeChild(style)
        }
      }, 'doc-reader: styles')

      ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'doc-reader: dictionaries')

      ctx.effect(() => installAnchorJump(), 'doc-reader: anchor jump')

      ctx.effect(() => ctx.sidebarRightTabs.register({
        id: TAB_ID,
        kind: TAB_KIND,
        priority: 'extension',
        multiple: false,
        title: () => t('tab.title'),
        guide: [{
          id: TAB_KIND,
          order: 20,
          title: () => t('guide.title'),
          description: () => t('guide.description'),
        }],
      }), 'doc-reader: notes tab type')

      ctx.effect(() => ctx.slots.inject('sidebar.right.pane.tab', () => ctx.slots.register({
        name: 'sidebar.right.pane.tab',
        key: TAB_ID,
      }, props => h(Boundary, null, h(NotesPanel, props)))), 'doc-reader: notes panel body')

      ctx.effect(() => ctx.slots.inject('sidebar.right.tab.document.actions', () => ctx.slots.register({
        name: 'sidebar.right.tab.document.actions',
        id: 'doc-reader',
        order: 5,
      }, props => h(Boundary, null, h(DocActions, props)))), 'doc-reader: document toolbar actions')

      ctx.effect(() => ctx.slots.inject('shell.overlay', () => ctx.slots.register({
        name: 'shell.overlay',
        id: 'doc-reader.dialog',
      }, props => h(Boundary, null, h(Layer, null, h(AssistantDialog, props))))), 'doc-reader: ask dialog')

      ctx.effect(() => ctx.slots.inject('shell.overlay', () => ctx.slots.register({
        name: 'shell.overlay',
        id: 'doc-reader.toast',
        order: 10,
      }, props => h(Boundary, null, h(Layer, null, h(Toast, props))))), 'doc-reader: toast')

      // Invisible session-scoped observer that appends settled answers to the
      // annotation threads of the questions this plugin sent.
      ctx.effect(() => ctx.slots.inject('conversation.composer.dock', () => ctx.slots.register({
        name: 'conversation.composer.dock',
        id: 'doc-reader.capture',
        order: 40,
      }, props => h(Boundary, null, h(AnswerCapture, props)))), 'doc-reader: answer capture')

      ctx.effect(() => {
        if (typeof document === 'undefined') return () => {}
        const clear = () => {
          if (selectionStore.get().text !== '') {
            selectionStore.set({ text: '', at: 0, title: '', truncated: false })
          }
        }
        const onSelectionChange = () => {
          const next = captureSelection(ctx)
          if (next) selectionStore.set(next)
          else clear()
        }
        document.addEventListener('selectionchange', onSelectionChange)
        return () => document.removeEventListener('selectionchange', onSelectionChange)
      }, 'doc-reader: selection capture')

      ctx.effect(() => {
        let cancelled = false
        let timer = null
        let attempt = 0
        const ping = async () => {
          if (cancelled) return
          try {
            await requestJson('ping', { app: 'doc-reader' })
          } catch (error) {
            attempt += 1
            if (!cancelled && attempt < 3) timer = setTimeout(ping, attempt * 2500)
          }
        }
        timer = setTimeout(ping, 1500)
        return () => {
          cancelled = true
          if (timer !== null) clearTimeout(timer)
        }
      }, 'doc-reader: client ping')
    }

    const testApi = {
      colorOf,
      anchorOf,
      withAnchor,
      withColor,
      stripColor,
      contextScore,
      chooseOccurrence,
      chooseAnchorStart,
      chooseMathFallbackSpan,
    }

    return {
      inject: ['slots', 'locale', 'sessions', 'conversation', 'sidebarRight', 'sidebarRightTabs'],
      apply(ctx) {
        registerUi(ctx)
      },
      ...(typeof window !== 'undefined' && window.__DOC_READER_TEST__ ? { __test: testApi } : {}),
    }
  },
})
