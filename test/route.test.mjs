import assert from 'node:assert/strict'
import test from 'node:test'

import { createAnnotationService, handleAnnotationRequest } from '../index.js'

function memoryTable() {
  const map = new Map()
  return {
    get: key => map.get(key),
    entries: () => map.entries(),
    keys: () => map.keys(),
    put: async (key, value) => { map.set(key, value) },
    delete: async (key) => { map.delete(key) },
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

function makeService() {
  return createAnnotationService({ annotations: memoryTable(), meta: memoryTable() })
}

function makeCtx(rejection) {
  return {
    connection: { requestRejection: () => rejection },
    logger: { warn() {} },
  }
}

function makeRequest(body, { method = 'POST', headers = { 'content-type': 'application/json' } } = {}) {
  const buffer = Buffer.isBuffer(body) ? body : Buffer.from(body ?? '')
  return {
    method,
    headers,
    resume() {},
    async *[Symbol.asyncIterator]() {
      if (buffer.length > 0) yield buffer
    },
  }
}

function makeResponse() {
  return {
    statusCode: 200,
    headers: {},
    body: '',
    setHeader(name, value) {
      this.headers[name.toLowerCase()] = value
    },
    end(chunk) {
      this.body = chunk === undefined ? '' : String(chunk)
    },
  }
}

async function call(body, options, { rejection = undefined, service = makeService() } = {}) {
  const request = makeRequest(body, options)
  const response = makeResponse()
  await handleAnnotationRequest(makeCtx(rejection), service, request, response)
  return { response, service }
}

const DOC = 'E:/docs/spec.docx'
const addBody = JSON.stringify({ op: 'add', payload: { documentPath: DOC, quote: 'q', note: 'n' } })

test('the trust fence rejects before any body handling', async () => {
  const { response } = await call(addBody, undefined, { rejection: 401 })
  assert.equal(response.statusCode, 401)
  assert.equal(response.body, '')
})

test('the trust fence fails closed when it cannot decide', async () => {
  const request = makeRequest(addBody)
  const response = makeResponse()
  const ctx = {
    connection: {
      requestRejection() {
        throw new Error('boom')
      },
    },
    logger: { warn() {} },
  }
  await handleAnnotationRequest(ctx, makeService(), request, response)
  assert.equal(response.statusCode, 403)
})

test('the route accepts only POST with JSON', async () => {
  let result = await call(addBody, { method: 'GET' })
  assert.equal(result.response.statusCode, 405)
  assert.equal(result.response.headers.allow, 'POST')

  result = await call(addBody, { headers: { 'content-type': 'text/plain' } })
  assert.equal(result.response.statusCode, 415)
  assert.equal(JSON.parse(result.response.body).error.code, 'unsupported-media-type')
})

test('malformed and oversized bodies are refused', async () => {
  let result = await call('{not json')
  assert.equal(result.response.statusCode, 400)
  assert.equal(JSON.parse(result.response.body).error.code, 'bad-request')

  result = await call('x'.repeat(70 * 1024))
  assert.equal(result.response.statusCode, 413)
  assert.equal(JSON.parse(result.response.body).error.code, 'payload-too-large')

  result = await call('[]')
  assert.equal(result.response.statusCode, 400)
})

test('unknown operations are refused', async () => {
  const result = await call(JSON.stringify({ op: 'nope' }))
  assert.equal(result.response.statusCode, 400)
  assert.equal(JSON.parse(result.response.body).error.code, 'invalid-op')
})

test('add, list, update and delete round-trip through the route', async () => {
  const service = makeService()

  let result = await call(addBody, undefined, { service })
  assert.equal(result.response.statusCode, 200)
  const added = JSON.parse(result.response.body)
  assert.equal(added.ok, true)
  const id = added.data.annotation.id

  result = await call(JSON.stringify({ op: 'list', payload: { documentPath: DOC } }), undefined, { service })
  assert.equal(JSON.parse(result.response.body).data.annotations.length, 1)

  result = await call(JSON.stringify({ op: 'documents' }), undefined, { service })
  assert.equal(JSON.parse(result.response.body).data.documents.length, 1)

  result = await call(JSON.stringify({ op: 'update', payload: { id, note: 'edited' } }), undefined, { service })
  assert.equal(JSON.parse(result.response.body).data.annotation.note, 'edited')

  result = await call(JSON.stringify({ op: 'delete', payload: { id } }), undefined, { service })
  assert.equal(result.response.statusCode, 200)

  result = await call(JSON.stringify({ op: 'list', payload: { documentPath: DOC } }), undefined, { service })
  assert.equal(JSON.parse(result.response.body).data.annotations.length, 0)
})

test('domain validation errors map to their status and code', async () => {
  let result = await call(JSON.stringify({ op: 'add', payload: { documentPath: DOC, note: '' } }))
  assert.equal(result.response.statusCode, 400)
  assert.equal(JSON.parse(result.response.body).error.code, 'invalid-note')

  result = await call(JSON.stringify({ op: 'update', payload: { id: 'not-an-id', note: 'x' } }))
  assert.equal(result.response.statusCode, 400)
  assert.equal(JSON.parse(result.response.body).error.code, 'invalid-id')
})
