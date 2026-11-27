// Proves the converted Word document carries a selectable text layer, and that
// the PDF sample can be read by the same engine the preview uses.
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const DSH = 'D:/Programs/dsh/resources/app.asar/dsh/node_modules'
const kitEntry = `${DSH}/@deepseek-ai/libreoffice-kit/lib/index.js`
const pdfjsEntry = `${DSH}/pdfjs-dist/legacy/build/pdf.mjs`

const requireFromKit = createRequire(kitEntry)
const resolveEnginePackage = (name) => {
  const manifest = requireFromKit.resolve(`${name}/package.json`)
  return manifest.replace(/\.asar(?=[\\/]|$)/, '.asar.unpacked')
}

const kit = await import(pathToFileURL(kitEntry).href)
const pdfjs = await import(pathToFileURL(pdfjsEntry).href)

const dir = await mkdtemp(join(tmpdir(), 'doc-reader-text-'))
const converted = join(dir, 'word.pdf')
let converter
try {
  converter = await kit.createConverter({ resolveEnginePackage, timeoutMs: 120000 })
  await converter.render({
    inputPath: 'E:/文档/deepseek-harness/default-workspace/samples/word-demo.docx',
    outputPath: converted,
  })

  async function extract(label, path) {
    const data = new Uint8Array(await readFile(path))
    const loading = pdfjs.getDocument({ data, disableFontFace: true, isEvalSupported: false })
    const document = await loading.promise
    try {
      const page = await document.getPage(1)
      const content = await page.getTextContent()
      const text = content.items.map(item => (typeof item.str === 'string' ? item.str : '')).join(' ')
      return { label, pages: document.numPages, chars: text.length, sample: text.slice(0, 90) }
    } finally {
      await document.destroy()
    }
  }

  console.log(JSON.stringify(await extract('word', converted)))
  console.log(JSON.stringify(await extract('pdf', 'E:/文档/deepseek-harness/default-workspace/samples/pdf-demo.pdf')))
} catch (error) {
  console.log(JSON.stringify({ ok: false, error: String(error && error.stack ? error.stack : error) }))
} finally {
  try {
    if (converter) await converter.dispose()
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}
