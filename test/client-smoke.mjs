/**
 * Headless smoke test for the browser half.
 *
 * The sandbox cannot drive a real page, so this harness stubs the module
 * loader, React and the Cordis services, then executes the plugin's real
 * `apply` and renders every registered surface as an element tree. It catches
 * undefined identifiers, wrong slot options, missing locale keys and selector
 * regressions without pretending to be a browser.
 */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath, pathToFileURL } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const clientPath = path.join(here, '..', 'client.js')
const source = fs.readFileSync(clientPath, 'utf8')

// ---------------------------------------------------------------- React stub

const React = {
  Fragment: 'Fragment',
  createElement(type, props, ...children) {
    const merged = { ...(props || {}) }
    if (children.length > 0) merged.children = children.length === 1 ? children[0] : children
    return { type, props: merged }
  },
  useRef: value => ({ current: value }),
  useState(initial) {
    return [typeof initial === 'function' ? initial() : initial, () => {}]
  },
  useEffect: () => undefined,
  useSyncExternalStore: (_subscribe, getSnapshot) => getSnapshot(),
  Component: class Component {
    constructor(props) {
      this.props = props
      this.state = {}
    }

    setState() {}
  },
}

// ------------------------------------------------------------------- globals

let selectionHandler = null
const scopedElement = { closest: () => scopedElement }
let currentSelection = null

globalThis.window = {
  getSelection: () => currentSelection,
  addEventListener: () => {},
  removeEventListener: () => {},
  innerWidth: 1280,
  innerHeight: 800,
}
globalThis.document = {
  querySelector: selector => (selector === '[data-sidebar-right-session]' ? scopedElement : null),
  addEventListener: (name, handler) => {
    if (name === 'selectionchange') selectionHandler = handler
  },
  removeEventListener: () => {},
  createElement: () => ({
    setAttribute() {},
    textContent: '',
    parentNode: null,
  }),
  head: {
    appendChild() {},
  },
  body: { style: { overflow: '' } },
  activeElement: null,
}
globalThis.fetch = async (_url, init) => {
  let body = {}
  try {
    body = init && init.body ? JSON.parse(init.body) : {}
  } catch {
    body = {}
  }
  let data = {}
  if (body.op === 'list') data = { annotations: [] }
  else if (body.op === 'add') data = { annotation: { id: 'test-annotation', quote: body.payload && body.payload.quote } }
  else if (body.op === 'update') data = { annotation: { id: body.payload && body.payload.id } }
  return {
    ok: true,
    status: 200,
    json: async () => ({ ok: true, data }),
  }
}
globalThis.location = { pathname: '/' }

// --------------------------------------------------------------- module load

let plugin = null
globalThis.window.__ModuleLoader__ = {
  load({ id, factory }) {
    assert.equal(id, '@local/doc-reader')
    plugin = factory(request => {
      if (request === 'react') return React
      if (request === 'react-dom') return { createPortal: children => children }
      throw new Error(`unexpected require ${request}`)
    })
  },
}

await import(pathToFileURL(clientPath).href)
assert.ok(plugin, 'the client module registered its plugin')

// ---------------------------------------------------------------- fake ctx

function createFakeCtx() {
  const record = {
    dictionary: null,
    tab: null,
    slots: [],
    effects: [],
    openedTab: null,
    draft: undefined,
    submitted: undefined,
    inserted: undefined,
    focused: false,
  }
  const t = (key, values) => {
    let text = (record.dictionary && (record.dictionary.zh[key] || record.dictionary.en[key])) || key
    if (values) {
      text = String(text).replace(/\{(\w+)\}/g, (match, name) => (
        Object.prototype.hasOwnProperty.call(values, name) ? String(values[name]) : match
      ))
    }
    return text
  }
  const fakeInput = {
    setDraft(draft) {
      record.draft = draft
    },
    submit(mode, source) {
      record.submitted = { mode, source }
    },
    captureInsertion: () => ({ from: 0, to: 0, revision: 0 }),
    insertText(text) {
      record.inserted = text
      return true
    },
    focus() {
      record.focused = true
    },
    state: { getSnapshot: () => ({ phase: 'plain' }) },
  }
  const ctx = {
    effect(effect, label) {
      const dispose = effect()
      record.effects.push({ label, dispose })
      return dispose
    },
    locale: {
      bind: () => t,
      register: (namespace, dicts) => {
        record.dictionary = dicts
        return () => {}
      },
      subscribe: () => () => {},
    },
    sidebarRightTabs: {
      register: (definition) => {
        record.tab = definition
        return () => {}
      },
    },
    slots: {
      inject(name, callback) {
        record.slots.push({ name, entry: callback() })
        return () => {}
      },
      register: (options, component) => ({ options, component }),
    },
    sidebarRight: {
      mounted: { getSnapshot: () => 'session-test' },
      active: () => (record.openedTab
        ? { kind: record.openedTab.kind, title: '文档批注' }
        : { title: 'a.md' }),
      openTab(kind, options) {
        record.openedTab = { kind, options }
      },
      openResource(address, options) {
        record.openedResource = { address, options }
      },
      isExpanded: () => true,
      toggleExpanded() {
        record.toggled = true
      },
    },
    sessions: { scope: () => ({}) },
    conversation: { input: { for: () => fakeInput } },
  }
  return { ctx, record }
}

function disposeEffects(record, keep = []) {
  for (const effect of record.effects) {
    if (keep.includes(effect.label)) continue
    if (typeof effect.dispose === 'function') effect.dispose()
  }
}

// ------------------------------------------------------------- render engine

function render(element, depth = 0) {
  if (element === null || element === undefined || element === false) return null
  if (typeof element === 'string' || typeof element === 'number') return String(element)
  if (Array.isArray(element)) return element.map(child => render(child, depth + 1))
  assert.equal(typeof element, 'object', `unexpected element ${String(element)}`)
  assert.ok(element.type, 'element has a type')
  const { type, props } = element
  if (type === 'Fragment') return render(props.children, depth + 1)
  if (typeof type === 'function') {
    if (type.prototype && type.prototype.render) {
      return render(new type(props).render(), depth + 1)
    }
    return render(type(props), depth + 1)
  }
  return {
    tag: type,
    props,
    className: props.className || '',
    children: render(props.children, depth + 1),
  }
}

function collect(tree, predicate, out = []) {
  if (tree === null || tree === undefined) return out
  if (Array.isArray(tree)) {
    for (const item of tree) collect(item, predicate, out)
    return out
  }
  if (typeof tree === 'string') return out
  if (predicate(tree)) out.push(tree)
  collect(tree.children, predicate, out)
  return out
}

function textOf(tree) {
  if (tree === null || tree === undefined) return ''
  if (typeof tree === 'string') return tree
  if (Array.isArray(tree)) return tree.map(textOf).join('')
  return textOf(tree.children)
}

function buttonByLabel(tree, label) {
  const buttons = collect(tree, node => node.tag === 'button' && node.props['aria-label'] === label)
  assert.ok(buttons.length > 0, `button "${label}" exists`)
  return buttons[0]
}

// -------------------------------------------------------------------- tests

test('every class used by the browser half is defined in its own stylesheet', () => {
  const cssMatch = source.match(/const STYLES = `([\s\S]*?)`\n/)
  assert.ok(cssMatch, 'the stylesheet literal is present')
  const css = cssMatch[1]
  const defined = new Set([...css.matchAll(/\.(dr-[a-z0-9-]+)/g)].map(match => match[1]))
  const used = new Set(
    [...source.matchAll(/className: '([^']+)'/g)]
      .flatMap(match => match[1].split(/\s+/))
      .filter(name => name.startsWith('dr-')),
  )
  const missing = [...used].filter(name => !defined.has(name))
  assert.deepEqual(missing, [], `undefined CSS classes: ${missing.join(', ')}`)
  // Only the modal scrim, the five marker colours and the five highlight paints
  // are literals; everything else goes through theme tokens.
  const literals = [...css.matchAll(/#[0-9a-fA-F]{3,8}\b|rgba?\(/g)].map(match => match[0])
  assert.deepEqual(literals, [
    'rgba(',
    '#f2c94c', '#4f8ef7', '#35b87f', '#e070a8', '#ef8a3c',
    'rgba(', 'rgba(', 'rgba(', 'rgba(', 'rgba(',
  ], 'only the scrim, marker palette and highlight paints use literal colors')
})

test('the browser half imports no Harness client package', () => {
  assert.equal(/require\('@deepseek-ai\//.test(source), false)
  assert.equal(/from '@deepseek-ai\//.test(source), false)
})

test('apply registers the shipped seams with the expected options', () => {
  const { ctx, record } = createFakeCtx()
  plugin.apply(ctx)

  assert.ok(record.dictionary, 'locale dictionary registered')
  const zh = Object.keys(record.dictionary.zh).sort()
  const en = Object.keys(record.dictionary.en).sort()
  assert.deepEqual(zh, en, 'zh and en dictionaries cover the same keys')

  assert.equal(record.tab.kind, 'doc-notes')
  assert.equal(record.tab.id, '@local/doc-reader/notes')
  assert.equal(record.tab.priority, 'extension')
  assert.equal(typeof record.tab.title(), 'string')
  assert.equal(record.tab.guide.length, 1)
  assert.equal(record.tab.guide[0].id, 'doc-notes')
  assert.equal(typeof record.tab.guide[0].title(), 'string')

  const byName = Object.fromEntries(record.slots.map(slot => [slot.name, slot.entry]))
  assert.deepEqual(Object.keys(byName).sort(), [
    'conversation.composer.dock', 'shell.overlay', 'sidebar.right.pane.tab', 'sidebar.right.tab.document.actions',
  ])
  assert.equal(byName['conversation.composer.dock'].options.id, 'doc-reader.capture')
  assert.equal(byName['sidebar.right.pane.tab'].options.key, '@local/doc-reader/notes')
  assert.equal(byName['sidebar.right.tab.document.actions'].options.id, 'doc-reader')
  const overlayIds = record.slots
    .filter(slot => slot.name === 'shell.overlay')
    .map(slot => slot.entry.options.id)
  assert.deepEqual(overlayIds.sort(), ['doc-reader.dialog', 'doc-reader.toast'])
  for (const entry of Object.values(byName)) assert.equal(typeof entry.component, 'function')

  // Every literal translation key used by the browser half exists.
  const used = new Set()
  for (const match of source.matchAll(/\bt\('([^']+)'/g)) used.add(match[1])
  for (const match of source.matchAll(/\bt\(`([^`$]+)`/g)) used.add(match[1])
  for (const id of ['explain', 'simpler', 'translate', 'terms', 'analyze']) {
    used.add(`quick.${id}`)
    used.add(`quick.${id}.text`)
  }
  const missing = [...used].filter(key => !(key in record.dictionary.zh))
  assert.deepEqual(missing, [], `missing dictionary keys: ${missing.join(', ')}`)

  disposeEffects(record)
})

test('the document header renders three actions and captures a selection', async () => {
  const { ctx, record } = createFakeCtx()
  plugin.apply(ctx)
  const entry = record.slots.find(slot => slot.name === 'sidebar.right.tab.document.actions').entry

  let tree = render(entry.component({ sessionId: 'session-test', absolutePath: 'E:/docs/a.md' }))
  let buttons = collect(tree, node => node.tag === 'button')
  assert.equal(buttons.length, 3)
  assert.equal(buttons[0].props.disabled, undefined, 'ask stays clickable so it can explain a missing selection')

  assert.equal(typeof selectionHandler, 'function', 'selection listener installed')
  currentSelection = {
    isCollapsed: false,
    rangeCount: 1,
    toString: () => '系统应当支持多用户并发访问。',
    anchorNode: scopedElement,
  }
  selectionHandler()

  tree = render(entry.component({ sessionId: 'session-test', absolutePath: 'E:/docs/a.md' }))
  buttons = collect(tree, node => node.tag === 'button')
  assert.equal(buttons[0].props.disabled, undefined, 'ask stays enabled after a selection')
  assert.match(buttons[0].props.title, /问 AI|Ask AI/)

  buttonByLabel(tree, '问 AI').props.onMouseDown({ preventDefault() {} })
  buttonByLabel(tree, '问 AI').props.onClick()

  const overlayEntry = record.slots.find(slot => slot.name === 'shell.overlay').entry
  const dialogTree = render(overlayEntry.component({}))
  const dialog = collect(dialogTree, node => node.className === 'dr-dialog')
  assert.equal(dialog.length, 1, 'dialog rendered')
  const dialogText = textOf(dialogTree)
  assert.match(dialogText, /系统应当支持多用户并发访问/)
  assert.match(dialogText, /a\.md/)
  assert.match(dialogText, /向 AI 提问|Ask the AI/)

  const quickChips = collect(dialogTree, node => node.className === 'dr-chip')
  assert.equal(quickChips.length, 5)
  quickChips[0].props.onClick()

  const footButtons = collect(dialogTree, node => node.props && node.props.className && node.props.className.startsWith('dr-btn'))
  const send = footButtons.find(node => String(node.props.className).includes('dr-btn-primary'))
  assert.ok(send, 'primary send button exists')
  send.props.onClick()
  assert.ok(record.draft, 'the ask message reached the composer draft')
  assert.match(String(record.draft), /文档来源：a\.md|Source: a\.md/)
  assert.match(String(record.draft), /> 系统应当支持多用户并发访问。/)

  // The dialog closes through its store after the send settles.
  await new Promise(resolve => setTimeout(resolve, 90))
  const closed = render(overlayEntry.component({}))
  assert.equal(closed, null)

  disposeEffects(record)
})

test('the annotations page renders empty, document and list states', () => {
  const { ctx, record } = createFakeCtx()
  plugin.apply(ctx)
  const entry = record.slots.find(slot => slot.name === 'sidebar.right.pane.tab').entry
  const makeInfo = params => ({ tab: { navigation: { revision: 1, params } } })

  let tree = render(entry.component({ sessionId: 'session-test', useTabInfo: () => makeInfo(undefined) }))
  assert.match(textOf(tree), /全部文档|All documents/)

  tree = render(entry.component({
    sessionId: 'session-test',
    useTabInfo: () => makeInfo({ documentPath: 'E:/docs/a.md', documentName: 'a.md' }),
  }))
  assert.match(textOf(tree), /a\.md/)
  const headButtons = collect(tree, node => node.tag === 'button')
  assert.ok(headButtons.some(button => /刷新|Refresh/.test(button.props.title || '')))
  assert.ok(headButtons.some(button => textOf({ children: button.props.children }).includes('整篇')
    || textOf({ children: button.props.children }).includes('Whole document')))
  assert.match(textOf(tree), /加载中|Loading/)

  disposeEffects(record)
})

test('the list button opens the page for the previewed document', () => {
  const { ctx, record } = createFakeCtx()
  plugin.apply(ctx)
  const entry = record.slots.find(slot => slot.name === 'sidebar.right.tab.document.actions').entry
  const tree = render(entry.component({ sessionId: 'session-test', absolutePath: 'E:/docs/b.pdf' }))
  buttonByLabel(tree, '批注列表').props.onClick()
  assert.deepEqual(record.openedTab, {
    kind: 'doc-notes',
    options: { params: { documentPath: 'E:/docs/b.pdf', documentName: 'b.pdf' } },
  })
  disposeEffects(record)
})
