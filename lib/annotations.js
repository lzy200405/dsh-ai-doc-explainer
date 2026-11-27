/**
 * Pure validation and record shaping for doc-reader annotations.
 *
 * No I/O and no DSH imports: the Host plugin imports this module, and the test
 * suite exercises it with plain Node. Every stored record passes through
 * `buildAnnotation` or `updateAnnotation` on write, and through the lenient
 * `parseStoredAnnotation` when the storage domain opens.
 */
import { createHash } from 'node:crypto'

/** Field ceilings shared by the Host and documented in the plugin description. */
export const LIMITS = {
  documentPath: 1024,
  documentName: 256,
  documentAddress: 1024,
  quote: 2000,
  note: 4000,
  question: 2000,
  sessionId: 128,
}

/** Annotation kinds the UI can create. */
export const ANNOTATION_TYPES = ['selection', 'document']

/** A validation refusal that maps to an HTTP status and a stable code. */
export class AnnotationError extends Error {
  /**
   * @param {string} code - stable machine code returned to the client.
   * @param {string} message - human readable reason.
   * @param {number} [status] - HTTP status the route answers with.
   */
  constructor(code, message, status = 400) {
    super(message)
    this.name = 'AnnotationError'
    this.code = code
    this.status = status
  }
}

/** UUID v4 shape the Host mints; also the accepted client id shape. */
const ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * Whether a value is an annotation id this plugin could have minted.
 * @param {unknown} value - candidate id.
 * @returns {boolean} true for a UUID-shaped string.
 */
export function isAnnotationId(value) {
  return typeof value === 'string' && ID_PATTERN.test(value)
}

/**
 * Normalize an absolute document path: trimmed, forward slashes, no NUL.
 * @param {unknown} value - client-supplied path.
 * @returns {string} the normalized path.
 */
export function normalizeDocumentPath(value) {
  if (typeof value !== 'string') {
    throw new AnnotationError('invalid-document-path', '缺少文档路径。')
  }
  const path = value.trim().replace(/\\/g, '/')
  if (path === '') {
    throw new AnnotationError('invalid-document-path', '文档路径不能为空。')
  }
  if (path.length > LIMITS.documentPath) {
    throw new AnnotationError('invalid-document-path', '文档路径过长。')
  }
  if (path.includes('\u0000')) {
    throw new AnnotationError('invalid-document-path', '文档路径包含非法字符。')
  }
  return path
}

/**
 * Stable document identity derived from the normalized path.
 * @param {string} path - normalized absolute path.
 * @returns {string} lowercase hex sha1.
 */
export function documentIdOf(path) {
  return createHash('sha1').update(String(path).toLowerCase()).digest('hex')
}

/** Last path segment, decoded when it is percent-encoded. */
function baseNameOf(path) {
  const name = path.slice(path.lastIndexOf('/') + 1)
  if (name === '') return path
  try {
    return decodeURIComponent(name)
  } catch {
    return name
  }
}

/**
 * Display name for one document: the client's name when usable, else the path's
 * last segment.
 * @param {string} path - normalized absolute path.
 * @param {unknown} value - optional client-supplied name.
 * @returns {string} a bounded display name.
 */
export function normalizeDocumentName(path, value) {
  const raw = typeof value === 'string' ? value.trim() : ''
  const name = (raw === '' ? baseNameOf(path) : raw).slice(0, LIMITS.documentName)
  return name === '' ? 'document' : name
}

/** Trimmed required/optional text with a ceiling. */
function boundedText(value, { field, limit, required = false }) {
  if (value === undefined || value === null || value === '') {
    if (!required) return ''
    throw new AnnotationError(`invalid-${field}`, '批注内容不能为空。')
  }
  if (typeof value !== 'string') {
    throw new AnnotationError(`invalid-${field}`, '批注内容必须是文本。')
  }
  const text = value.trim()
  if (text === '') {
    if (!required) return ''
    throw new AnnotationError(`invalid-${field}`, '批注内容不能为空。')
  }
  if (text.length > limit) {
    throw new AnnotationError(`${field}-too-long`, `内容过长（上限 ${limit} 字符）。`)
  }
  return text
}

/**
 * Shape one new annotation. The Host owns ids and timestamps: a client-supplied
 * value for either is ignored.
 * @param {unknown} input - client payload.
 * @param {{ id: string, now: number }} stamp - Host-minted identity and clock.
 * @returns {object} the record to store.
 */
export function buildAnnotation(input, { id, now }) {
  const source = input && typeof input === 'object' ? input : {}
  const documentPath = normalizeDocumentPath(source.documentPath)
  const documentName = normalizeDocumentName(documentPath, source.documentName)
  const quote = boundedText(source.quote, { field: 'quote', limit: LIMITS.quote })
  const note = boundedText(source.note, { field: 'note', limit: LIMITS.note, required: true })
  const question = boundedText(source.question, { field: 'question', limit: LIMITS.question })
  const type = source.type === 'document'
    ? 'document'
    : source.type === 'selection'
      ? 'selection'
      : quote === '' ? 'document' : 'selection'
  if (type === 'selection' && quote === '') {
    throw new AnnotationError('invalid-quote', '选区批注必须包含原文摘录。')
  }
  const sessionId = typeof source.sessionId === 'string' ? source.sessionId.trim().slice(0, LIMITS.sessionId) : ''
  const documentAddress = typeof source.documentAddress === 'string' ? source.documentAddress.trim() : ''
  if (documentAddress.length > LIMITS.documentAddress) {
    throw new AnnotationError('invalid-document-address', '文档地址过长。')
  }
  const record = {
    id,
    version: 1,
    documentId: documentIdOf(documentPath),
    documentPath,
    documentName,
    type,
    quote,
    note,
    createdAt: now,
    updatedAt: now,
  }
  if (question !== '') record.question = question
  if (sessionId !== '') record.sessionId = sessionId
  if (documentAddress !== '') record.documentAddress = documentAddress
  if (source.source === 'ask') record.source = 'ask'
  return record
}

/**
 * Apply an edit to one stored annotation. Only the note and its timestamp move:
 * identity, document binding, quote and creation time are immutable.
 * @param {object} current - stored record.
 * @param {unknown} input - client payload carrying `note`.
 * @param {number} now - Host clock.
 * @returns {object} the record to store.
 */
export function updateAnnotation(current, input, now) {
  const source = input && typeof input === 'object' ? input : {}
  const note = boundedText(source.note, { field: 'note', limit: LIMITS.note, required: true })
  return { ...current, note, updatedAt: now }
}

/**
 * Lenient read path used by the storage domain when it loads. Corrupt records
 * are repaired into a usable shape instead of failing the whole plugin.
 * @param {unknown} value - stored record.
 * @returns {object} a usable annotation.
 */
export function parseStoredAnnotation(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('doc-reader: stored annotation is not an object')
  }
  const record = value
  if (typeof record.id !== 'string' || record.id === '') {
    throw new Error('doc-reader: stored annotation has no id')
  }
  const documentPath = typeof record.documentPath === 'string' ? record.documentPath : ''
  const documentId = typeof record.documentId === 'string' && record.documentId !== ''
    ? record.documentId
    : documentIdOf(documentPath)
  return {
    id: record.id,
    version: 1,
    documentId,
    documentPath,
    documentName: typeof record.documentName === 'string' && record.documentName !== ''
      ? record.documentName
      : normalizeDocumentName(documentPath, undefined),
    type: record.type === 'document' ? 'document' : 'selection',
    quote: typeof record.quote === 'string' ? record.quote : '',
    note: typeof record.note === 'string' ? record.note : '',
    ...(typeof record.question === 'string' ? { question: record.question } : {}),
    ...(typeof record.sessionId === 'string' ? { sessionId: record.sessionId } : {}),
    ...(typeof record.documentAddress === 'string' && record.documentAddress !== ''
      ? { documentAddress: record.documentAddress }
      : {}),
    ...(record.source === 'ask' ? { source: 'ask' } : {}),
    createdAt: Number.isFinite(record.createdAt) ? record.createdAt : 0,
    updatedAt: Number.isFinite(record.updatedAt) ? record.updatedAt : 0,
  }
}

/**
 * Lenient read path for the plugin's own health record.
 * @param {unknown} value - stored value.
 * @returns {object} a usable meta record.
 */
export function parseStoredMeta(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  return { ...value }
}

/**
 * The storage domain declaration. `valueSchema.parse` is all the domain runtime
 * calls, so the store needs no schema library dependency.
 */
export const DOMAIN_SPEC = {
  name: 'doc_reader',
  version: 1,
  layout: 'per-record',
  invalidRecords: 'backup-and-skip',
  tables: {
    annotations: { valueSchema: { parse: parseStoredAnnotation } },
    meta: { valueSchema: { parse: parseStoredMeta } },
  },
}

/**
 * Summarize annotations per document, newest activity first.
 * @param {Iterable<object>} records - every stored annotation.
 * @returns {Array<{documentId: string, documentPath: string, documentName: string, count: number, lastUpdatedAt: number}>}
 */
export function summarizeDocuments(records) {
  const byId = new Map()
  for (const record of records) {
    const known = byId.get(record.documentId)
    if (known === undefined) {
      byId.set(record.documentId, {
        documentId: record.documentId,
        documentPath: record.documentPath,
        documentName: record.documentName,
        count: 1,
        lastUpdatedAt: record.updatedAt || record.createdAt || 0,
      })
      continue
    }
    known.count += 1
    known.lastUpdatedAt = Math.max(known.lastUpdatedAt, record.updatedAt || record.createdAt || 0)
    if (record.documentName && record.documentName !== 'document') known.documentName = record.documentName
    if (record.documentPath) known.documentPath = record.documentPath
  }
  return [...byId.values()].sort((left, right) => right.lastUpdatedAt - left.lastUpdatedAt)
}
