// Verifies the LibreOfficeKit conversion chain the shipped Word preview uses.
// Run with ELECTRON_RUN_AS_NODE=1 and the Desktop Electron executable.
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const kitEntry = 'D:/Programs/dsh/resources/app.asar/dsh/node_modules/@deepseek-ai/libreoffice-kit/lib/index.js'
const requireFromKit = createRequire(kitEntry)

function resolveEnginePackage(name) {
  const manifest = requireFromKit.resolve(`${name}/package.json`)
  return manifest.replace(/\.asar(?=[\\/]|$)/, '.asar.unpacked')
}

const kit = await import(pathToFileURL(kitEntry).href)
const dir = await mkdtemp(join(tmpdir(), 'doc-reader-lokit-'))
const input = 'E:/文档/deepseek-harness/default-workspace/samples/word-demo.docx'
const output = join(dir, 'rendered.pdf')
let converter
try {
  converter = await kit.createConverter({ resolveEnginePackage, timeoutMs: 120000 })
  const result = await converter.render({ inputPath: input, outputPath: output })
  const bytes = await readFile(output)
  console.log(JSON.stringify({
    ok: true,
    bytes: bytes.length,
    header: bytes.subarray(0, 5).toString('latin1'),
    missingFonts: result && result.missingFonts,
    pageCount: result && result.pageCount,
  }))
} catch (error) {
  console.log(JSON.stringify({ ok: false, error: String(error && error.stack ? error.stack : error) }))
} finally {
  try {
    if (converter) await converter.dispose()
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}
