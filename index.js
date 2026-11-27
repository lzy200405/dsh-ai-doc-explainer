/**
 * DSH Host half of the document reader.
 *
 * Owns exactly one thing the browser cannot own durably: the annotation store.
 * It opens the `doc_reader` storage domain, exposes annotation CRUD over one
 * same-origin JSON route, and keeps a small health record so a boot can be
 * diagnosed from disk.
 *
 * Document reading, rendering and PDF conversion stay with DSH's shipped
 * document preview; this plugin never parses or renders a document.
 */
import { randomUUID } from 'node:crypto'
import {
  AnnotationError,
  DOMAIN_SPEC,
  buildAnnotation,
  documentIdOf,
  isAnnotationId,
  normalizeDocumentPath,
  summarizeDocuments,
  updateAnnotation,
} from './lib/annotations.js'

/** One endpoint for every browser operation; the body carries `{ op, payload }`. */
const ROUTE = '/doc-reader/api'
/** Unauthenticated liveness route: presence and version only. */
const HEALTH_ROUTE = '/doc-reader/api/health'
/** Bumped when the wire or record shape changes. */
const PLUGIN_VERSION = 1
/** A browser operation is a small JSON object; anything larger is hostile. */
const MAX_BODY_BYTES = 64 * 1024

/** The store, the route carrier and the request trust fence. */
export const inject = ['storageDomain', 'webServer', 'connection']

/** Coarse logging that never breaks the plugin when the logger is unavailable. */
function warn(ctx, message) {
  try {
    if (ctx.logger && typeof ctx.logger.warn === 'function') ctx.logger.warn(`[doc-reader] ${message}`)
    else console.warn(`[doc-reader] ${message}`)
  } catch {
    // Logging is best effort.
  }
}

/** JSON response without caching. */
function sendJson(res, status, payload) {
  const body = JSON.stringify(payload)
  res.statusCode = status
  res.setHeader('content-type', 'application/json; charset=utf-8')
  res.setHeader('cache-control', 'no-store')
  res.setHeader('x-content-type-options', 'nosniff')
  res.setHeader('content-length', String(Buffer.byteLength(body)))
  res.end(body)
}

/** One failure in the response envelope. */
function sendError(res, status, code, message) {
  sendJson(res, status, { ok: false, error: { code, message } })
}

/** Collect a bounded JSON body; `null` means the ceiling was exceeded. */
async function readBoundedBody(req) {
  const chunks = []
  let total = 0
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    total += buffer.length
    if (total > MAX_BODY_BYTES) {
      req.resume()
      return null
    }
    chunks.push(buffer)
  }
  return Buffer.concat(chunks, total).toString('utf8')
}

/** Whether the request declares JSON as its media type. */
function isJsonRequest(req) {
  const essence = String(req.headers['content-type'] || '').split(';', 1)[0].trim().toLowerCase()
  return essence === 'application/json'
}

/**
 * Ask the composition's connection service to fence the request.
 * @returns {number|undefined} a rejection status, or undefined when accepted.
 */
function rejectionOf(ctx, req) {
  try {
    const rejection = ctx.connection.requestRejection(req)
    return typeof rejection === 'number' ? rejection : undefined
  } catch (error) {
    warn(ctx, `request trust check failed: ${error instanceof Error ? error.message : String(error)}`)
    // Fail closed: an unreadable trust decision is not an accepted request.
    return 403
  }
}

/**
 * Build the annotation operations over the open domain. One implementation
 * serves the browser route today and any future agent tool unchanged.
 * Exported for the Host test suite.
 */
export function createAnnotationService(tables) {
  const annotations = tables.annotations
  const meta = tables.meta

  /** @returns {object[]} every stored annotation. */
  function all() {
    const records = []
    for (const [, record] of annotations.entries()) records.push(record)
    return records
  }

  /** @returns {object} the health record, never undefined. */
  function state() {
    const stored = meta.get('state')
    return stored && typeof stored === 'object' ? stored : {}
  }

  return {
    all,
    state,
    async rememberActivation(facts) {
      const previous = state()
      await meta.put('state', {
        ...previous,
        version: PLUGIN_VERSION,
        ...(Number.isFinite(previous.installedAt) ? {} : { installedAt: facts.at }),
        lastHostActivation: facts,
      })
    },
    async ping(payload) {
      const previous = state()
      await meta.put('state', {
        ...previous,
        version: PLUGIN_VERSION,
        lastClientPing: {
          at: Date.now(),
          app: typeof payload?.app === 'string' ? payload.app.slice(0, 64) : 'unknown',
        },
      })
    },
    status() {
      const records = all()
      return {
        version: PLUGIN_VERSION,
        annotations: records.length,
        documents: summarizeDocuments(records).length,
      }
    },
    documents() {
      return summarizeDocuments(all())
    },
    list(documentPath) {
      const path = normalizeDocumentPath(documentPath)
      const documentId = documentIdOf(path)
      return all()
        .filter(record => record.documentId === documentId)
        .sort((left, right) => right.createdAt - left.createdAt)
    },
    async add(input) {
      const record = buildAnnotation(input, { id: randomUUID(), now: Date.now() })
      await annotations.put(record.id, record)
      return record
    },
    async update(input) {
      const id = input?.id
      if (!isAnnotationId(id)) throw new AnnotationError('invalid-id', '批注 ID 无效。')
      const current = annotations.get(id)
      if (current === undefined) throw new AnnotationError('not-found', '批注不存在或已被删除。', 404)
      const record = updateAnnotation(current, input, Date.now())
      await annotations.put(record.id, record)
      return record
    },
    async remove(input) {
      const id = input?.id
      if (!isAnnotationId(id)) throw new AnnotationError('invalid-id', '批注 ID 无效。')
      if (annotations.get(id) === undefined) throw new AnnotationError('not-found', '批注不存在或已被删除。', 404)
      await annotations.delete(id)
      return { id }
    },
  }
}

/**
 * One browser request: trust fence, bounded JSON body, one operation.
 * Exported for the Host test suite.
 * @param {import('@deepseek-ai/cordis').Context} ctx - Host context.
 * @param {ReturnType<typeof createAnnotationService>} service - annotation operations.
 */
export async function handleAnnotationRequest(ctx, service, req, res) {
  const rejection = rejectionOf(ctx, req)
  if (rejection !== undefined) {
    res.statusCode = rejection
    res.end()
    return
  }
  if (req.method !== 'POST') {
    res.setHeader('allow', 'POST')
    sendError(res, 405, 'method-not-allowed', '只支持 POST。')
    return
  }
  if (!isJsonRequest(req)) {
    sendError(res, 415, 'unsupported-media-type', '请求必须是 application/json。')
    return
  }

  let text
  try {
    text = await readBoundedBody(req)
  } catch (error) {
    warn(ctx, `request body unreadable: ${error instanceof Error ? error.message : String(error)}`)
    sendError(res, 400, 'bad-request', '请求体无法读取。')
    return
  }
  if (text === null) {
    sendError(res, 413, 'payload-too-large', '请求体过大。')
    return
  }

  let body
  try {
    body = JSON.parse(text)
  } catch {
    sendError(res, 400, 'bad-request', '请求体不是合法 JSON。')
    return
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    sendError(res, 400, 'bad-request', '请求体必须是 JSON 对象。')
    return
  }
  const op = typeof body.op === 'string' ? body.op : ''
  const payload = body.payload && typeof body.payload === 'object' ? body.payload : {}

  try {
    switch (op) {
      case 'ping':
        await service.ping(payload)
        sendJson(res, 200, { ok: true, data: { version: PLUGIN_VERSION, stored: true } })
        return
      case 'status':
        sendJson(res, 200, { ok: true, data: service.status() })
        return
      case 'documents':
        sendJson(res, 200, { ok: true, data: { documents: service.documents() } })
        return
      case 'list':
        sendJson(res, 200, { ok: true, data: { annotations: service.list(payload.documentPath) } })
        return
      case 'add':
        sendJson(res, 200, { ok: true, data: { annotation: await service.add(payload) } })
        return
      case 'update':
        sendJson(res, 200, { ok: true, data: { annotation: await service.update(payload) } })
        return
      case 'delete':
        sendJson(res, 200, { ok: true, data: { deleted: await service.remove(payload) } })
        return
      default:
        sendError(res, 400, 'invalid-op', '不支持的批注操作。')
    }
  } catch (error) {
    if (error instanceof AnnotationError) {
      sendError(res, error.status, error.code, error.message)
      return
    }
    warn(ctx, `annotation operation failed: ${error instanceof Error ? error.message : String(error)}`)
    sendError(res, 500, 'internal', '批注服务内部错误。')
  }
}

/**
 * Activate the Host half: open the store, expose the route, record the boot.
 * @param {import('@deepseek-ai/cordis').Context} ctx - Host plugin context.
 */
export async function apply(ctx) {
  const domain = await ctx.storageDomain.open(DOMAIN_SPEC)
  ctx.effect(() => async () => {
    await domain.close()
  }, 'doc-reader: annotation domain')

  const service = createAnnotationService({
    annotations: domain.table('annotations'),
    meta: domain.table('meta'),
  })

  try {
    await service.rememberActivation({ at: Date.now(), profile: process.env.DSH_PROFILE ?? null })
  } catch (error) {
    // A failed health write must not disable annotation storage.
    warn(ctx, `activation record failed: ${error instanceof Error ? error.message : String(error)}`)
  }

  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: ROUTE,
    handler: (req, res) => handleAnnotationRequest(ctx, service, req, res),
  }), `doc-reader: POST ${ROUTE}`)

  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: HEALTH_ROUTE,
    handler: (req, res) => {
      if (req.method !== 'GET') {
        res.setHeader('allow', 'GET')
        sendError(res, 405, 'method-not-allowed', '只支持 GET。')
        return
      }
      sendJson(res, 200, {
        ok: true,
        plugin: '@local/doc-reader',
        version: PLUGIN_VERSION,
        store: domain.name,
      })
    },
  }), `doc-reader: GET ${HEALTH_ROUTE}`)
}
