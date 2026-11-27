import assert from 'node:assert/strict'
import test from 'node:test'

import {
  AnnotationError,
  DOMAIN_SPEC,
  LIMITS,
  buildAnnotation,
  documentIdOf,
  isAnnotationId,
  normalizeDocumentName,
  normalizeDocumentPath,
  parseStoredAnnotation,
  summarizeDocuments,
  updateAnnotation,
} from '../lib/annotations.js'

const NOW = 1_700_000_000_000
const ID = '11111111-2222-4333-8444-555555555555'

test('a selection annotation keeps its quote and derived identity', () => {
  const record = buildAnnotation({
    documentPath: 'E:\\docs\\spec.docx',
    quote: '系统应当支持多用户并发访问。',
    note: '确认并发控制策略。',
    sessionId: 'session-1',
  }, { id: ID, now: NOW })

  assert.equal(record.id, ID)
  assert.equal(record.documentPath, 'E:/docs/spec.docx')
  assert.equal(record.documentName, 'spec.docx')
  assert.equal(record.documentId, documentIdOf('E:/docs/spec.docx'))
  assert.equal(record.type, 'selection')
  assert.equal(record.quote, '系统应当支持多用户并发访问。')
  assert.equal(record.note, '确认并发控制策略。')
  assert.equal(record.sessionId, 'session-1')
  assert.equal(record.createdAt, NOW)
  assert.equal(record.updatedAt, NOW)
  assert.equal(record.version, 1)
})

test('a document annotation needs no quote', () => {
  const record = buildAnnotation({
    documentPath: '/docs/scan.pdf',
    documentName: '扫描件',
    note: '整体需要重新排版。',
  }, { id: ID, now: NOW })
  assert.equal(record.type, 'document')
  assert.equal(record.quote, '')
  assert.equal(record.documentName, '扫描件')
})

test('an explicit selection type without a quote is refused', () => {
  assert.throws(
    () => buildAnnotation({ documentPath: '/a.pdf', type: 'selection', note: 'x' }, { id: ID, now: NOW }),
    (error) => error instanceof AnnotationError && error.code === 'invalid-quote',
  )
})

test('an empty note is refused', () => {
  assert.throws(
    () => buildAnnotation({ documentPath: '/a.pdf', note: '   ' }, { id: ID, now: NOW }),
    (error) => error instanceof AnnotationError && error.code === 'invalid-note',
  )
})

test('oversized fields are refused with their own codes', () => {
  assert.throws(
    () => buildAnnotation({ documentPath: '/a.pdf', note: 'x'.repeat(LIMITS.note + 1) }, { id: ID, now: NOW }),
    (error) => error instanceof AnnotationError && error.code === 'note-too-long',
  )
  assert.throws(
    () => buildAnnotation({ documentPath: '/a.pdf', quote: 'x'.repeat(LIMITS.quote + 1), note: 'n' }, { id: ID, now: NOW }),
    (error) => error instanceof AnnotationError && error.code === 'quote-too-long',
  )
})

test('paths are trimmed, slash-normalized and required', () => {
  assert.equal(normalizeDocumentPath('  C:\\a\\b.md  '), 'C:/a/b.md')
  assert.throws(() => normalizeDocumentPath('   '), AnnotationError)
  assert.throws(() => normalizeDocumentPath(42), AnnotationError)
  assert.throws(() => normalizeDocumentPath('/a\u0000b'), AnnotationError)
  assert.equal(normalizeDocumentName('/a/b.md', ''), 'b.md')
  assert.equal(normalizeDocumentName('/a/b.md', ' 自定义 '), '自定义')
})

test('document ids ignore path case', () => {
  assert.equal(documentIdOf('C:/Docs/A.md'), documentIdOf('c:/docs/a.md'))
  assert.equal(documentIdOf('C:/Docs/A.md').length, 40)
})

test('updating an annotation moves only the note and timestamp', () => {
  const record = buildAnnotation({ documentPath: '/a.md', quote: 'q', note: 'first' }, { id: ID, now: NOW })
  const next = updateAnnotation(record, { note: 'second', createdAt: 1 }, NOW + 5)
  assert.equal(next.note, 'second')
  assert.equal(next.createdAt, NOW)
  assert.equal(next.updatedAt, NOW + 5)
  assert.equal(next.id, ID)
  assert.equal(next.quote, 'q')
  assert.throws(() => updateAnnotation(record, { note: '' }, NOW), AnnotationError)
})

test('ask records keep their question, source and document address', () => {
  const record = buildAnnotation({
    documentPath: '/docs/a.md',
    quote: 'q',
    note: '为什么这样设计？',
    question: '为什么这样设计？',
    source: 'ask',
    documentAddress: 'dsh-resource://file/session/s1/notes/a.md',
  }, { id: ID, now: NOW })
  assert.equal(record.question, '为什么这样设计？')
  assert.equal(record.source, 'ask')
  assert.equal(record.documentAddress, 'dsh-resource://file/session/s1/notes/a.md')

  const stored = parseStoredAnnotation({ ...record })
  assert.equal(stored.source, 'ask')
  assert.equal(stored.documentAddress, record.documentAddress)

  assert.throws(
    () => buildAnnotation({
      documentPath: '/docs/a.md',
      note: 'n',
      documentAddress: 'x'.repeat(LIMITS.documentAddress + 1),
    }, { id: ID, now: NOW }),
    (error) => error instanceof AnnotationError && error.code === 'invalid-document-address',
  )
})

test('stored records are repaired instead of failing the domain open', () => {
  const repaired = parseStoredAnnotation({
    id: ID,
    documentPath: '/a.md',
    note: 'n',
  })
  assert.equal(repaired.documentName, 'a.md')
  assert.equal(repaired.type, 'selection')
  assert.equal(repaired.quote, '')
  assert.equal(repaired.updatedAt, 0)
  assert.equal(repaired.documentId, documentIdOf('/a.md'))

  assert.throws(() => parseStoredAnnotation(null))
  assert.throws(() => parseStoredAnnotation({ path: '/a.md' }))
})

test('document summaries group by document and follow recent activity', () => {
  const first = buildAnnotation({ documentPath: '/a.md', note: 'one' }, { id: ID, now: 10 })
  const second = buildAnnotation({ documentPath: '/b.md', note: 'two' }, { id: '22222222-2222-4333-8444-555555555555', now: 30 })
  const third = buildAnnotation({
    documentPath: '/a.md', documentName: 'a.md', note: 'three',
  }, { id: '33333333-2222-4333-8444-555555555555', now: 20 })

  const summary = summarizeDocuments([first, second, third])
  assert.equal(summary.length, 2)
  assert.equal(summary[0].documentPath, '/b.md')
  assert.equal(summary[0].count, 1)
  assert.equal(summary[1].documentPath, '/a.md')
  assert.equal(summary[1].count, 2)
  assert.equal(summary[1].lastUpdatedAt, 20)
})

test('annotation ids accept only Host-minted UUIDs', () => {
  assert.equal(isAnnotationId(ID), true)
  assert.equal(isAnnotationId('nope'), false)
  assert.equal(isAnnotationId('11111111-2222-4333-8444-55555555555z'), false)
  assert.equal(isAnnotationId(undefined), false)
})

test('the domain spec declares per-record storage and lenient schemas', () => {
  assert.equal(DOMAIN_SPEC.name, 'doc_reader')
  assert.equal(DOMAIN_SPEC.layout, 'per-record')
  assert.equal(DOMAIN_SPEC.invalidRecords, 'backup-and-skip')
  assert.deepEqual(Object.keys(DOMAIN_SPEC.tables).sort(), ['annotations', 'meta'])
  assert.equal(typeof DOMAIN_SPEC.tables.annotations.valueSchema.parse, 'function')
  assert.deepEqual(DOMAIN_SPEC.tables.meta.valueSchema.parse({ a: 1 }), { a: 1 })
})
