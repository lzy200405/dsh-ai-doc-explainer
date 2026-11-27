// Inspects the PDF LibreOfficeKit produces for the sample Word file: embedded
// fonts, /ToUnicode maps and text operators are what make the preview's text
// layer selectable.
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { inflateSync } from 'node:zlib'

const kitEntry = 'D:/Programs/dsh/resources/app.asar/dsh/node_modules/@deepseek-ai/libreoffice-kit/lib/index.js'
const requireFromKit = createRequire(kitEntry)
const resolveEnginePackage = (name) => {
  const manifest = requireFromKit.resolve(`${name}/package.json`)
  return manifest.replace(/\.asar(?=[\\/]|$)/, '.asar.unpacked')
}

const kit = await import(pathToFileURL(kitEntry).href)
const dir = await mkdtemp(join(tmpdir(), 'doc-reader-fonts-'))
const output = join(dir, 'word.pdf')
let converter
try {
  converter = await kit.createConverter({ resolveEnginePackage, timeoutMs: 120000 })
  await converter.render({
    inputPath: 'E:/文档/deepseek-harness/default-workspace/samples/word-demo.docx',
    outputPath: output,
  })
  const bytes = await readFile(output)
  const text = bytes.toString('latin1')
  const count = pattern => (text.match(pattern) ?? []).length

  let streams = 0
  let inflated = 0
  let textOperators = 0
  const parts = text.split('stream')
  for (let index = 1; index < parts.length; index += 1) {
    const end = parts[index].indexOf('endstream')
    if (end < 0) continue
    const raw = parts[index].slice(0, end).replace(/^\r?\n/, '')
    streams += 1
    try {
      const decoded = inflateSync(Buffer.from(raw, 'latin1')).toString('latin1')
      inflated += 1
      textOperators += (decoded.match(/\bTj\b|\bTJ\b/g) ?? []).length
    } catch {
      // Not every stream is Flate-compressed; the counts above only need the ones that are.
    }
  }

  console.log(JSON.stringify({
    bytes: bytes.length,
    header: text.slice(0, 5),
    fonts: count(/\/Font\b/g),
    fontFiles: count(/\/FontFile2?\b/g),
    toUnicodeMaps: count(/\/ToUnicode\b/g),
    streams,
    inflated,
    textOperators,
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
