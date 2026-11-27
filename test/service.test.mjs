import assert from 'node:assert/strict'
import test from 'node:test'

import { AnnotationError } from '../lib/annotations.js'
import { createAnnotationService } from '../index.js'

/** Minimal in-memory stand-in for one storage-domain table. */
function memoryTable() {
  const map = new Map()
  return {
    get: key => map.get(key),
    entries: () => map.entries(),
    keys: () => map.keys(),
    put: async (key, value) => {
      map.set(key, value)
    },
    delete: async (key) => {
      map.delete(key)
    },
    update: async (key, change) => {
      const next = change(map.get(key))
      map.set(key, next)
      return next
    },
    get size() {
      return map.size
    },
  }
}

function createService() {
  return createAnnotationService({ annotations: memoryTable(), meta: memoryTable() })
}

const DOC = 'E:/docs/spec.docx'

test('adding, listing and deleting an annotation round-trips', async () => {
  const service = createService()
  const created = await service.add({
    documentPath: DOC,
    documentName: 'spec.docx',
    quote: '系统应当支持多用户并发访问。',
    note: '确认并发控制策略。',
    sessionId: 'session-1',
  })

  assert.match(created.id, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
  assert.equal(service.status().annotations, 1)
  assert.equal(service.list(DOC).length, 1)
  assert.equal(service.list('E:/docs/other.md').length, 0)
  assert.deepEqual(service.documents().map(doc => doc.documentPath), [DOC])

  const removed = await service.remove({ id: created.id })
  assert.deepEqual(removed, { id: created.id })
  assert.equal(service.status().annotations, 0)
  await assert.rejects(
    () => service.remove({ id: created.id }),
    (error) => error instanceof AnnotationError && error.status === 404 && error.code === 'not-found',
  )
})

test('updating changes only the note', async () => {
  const service = createService()
  const created = await service.add({ documentPath: DOC, quote: 'q', note: 'first' })
  const updated = await service.update({ id: created.id, note: 'second' })
  assert.equal(updated.note, 'second')
  assert.equal(updated.createdAt, created.createdAt)
  assert.equal(updated.updatedAt >= created.updatedAt, true)
  assert.equal(service.list(DOC)[0].note, 'second')

  await assert.rejects(
    () => service.update({ id: '00000000-0000-4000-8000-000000000000', note: 'x' }),
    (error) => error instanceof AnnotationError && error.status === 404,
  )
  await assert.rejects(
    () => service.update({ id: 'not-an-id', note: 'x' }),
    (error) => error instanceof AnnotationError && error.code === 'invalid-id',
  )
})

test('invalid writes are refused before they reach storage', async () => {
  const service = createService()
  await assert.rejects(
    () => service.add({ documentPath: '', note: 'x' }),
    (error) => error instanceof AnnotationError && error.code === 'invalid-document-path',
  )
  await assert.rejects(
    () => service.add({ documentPath: DOC, note: '   ' }),
    (error) => error instanceof AnnotationError && error.code === 'invalid-note',
  )
  assert.equal(service.status().annotations, 0)
})

test('health records keep their first installation time', async () => {
  const service = createService()
  await service.rememberActivation({ at: 1000, profile: 'desktop' })
  await service.ping({ app: 'doc-reader' })
  await service.rememberActivation({ at: 2000, profile: 'desktop' })

  const state = service.state()
  assert.equal(state.installedAt, 1000)
  assert.equal(state.version, 1)
  assert.equal(state.lastHostActivation.at, 2000)
  assert.equal(state.lastClientPing.app, 'doc-reader')
  assert.equal(typeof state.lastClientPing.at, 'number')
})
