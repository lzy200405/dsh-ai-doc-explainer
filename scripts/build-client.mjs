// Builds the browser artifact: the vendored KaTeX UMD bundle followed by the
// plugin's own module. The loader serves exactly one file, so the two are
// concatenated; `client.src.js` remains the editable source.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(here, '..')
const source = fs.readFileSync(path.join(root, 'client.src.js'), 'utf8')
const katex = fs.readFileSync(path.join(root, 'vendor', 'katex.min.js'), 'utf8')
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'))

const banner = [
  `/*! ${pkg.name} v${pkg.version} — browser half (built from client.src.js) */`,
  '/*! KaTeX 0.19.1 | MIT License | https://katex.org | see vendor/LICENSE.katex */',
  '',
].join('\n')

// The UMD wrapper resolves `self` in a browser and `this` otherwise; binding
// both to the window keeps `window.katex` defined in the page and in tests.
const katexBlock = `;(function (root) {\n  var module = void 0, exports = void 0;\n${katex}\n}).call(typeof window !== 'undefined' ? window : globalThis, typeof window !== 'undefined' ? window : globalThis);\n`

const output = `${banner}${katexBlock}\n${source}`
fs.writeFileSync(path.join(root, 'client.js'), output)
console.log(`built client.js: ${output.length} bytes (source ${source.length}, katex ${katex.length})`)
