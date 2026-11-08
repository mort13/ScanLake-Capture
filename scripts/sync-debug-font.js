#!/usr/bin/env node
// Copies the debug-text fonts (r_DisplayInfo glyphs, cut with the desktop repo's
// `scanlake-train font cut`) into public/display_info_font/ and lists them in index.json.
//
//   npm run sync-debug-font [-- <font folder>]
//
// The folder defaults to the desktop repo's shipped fonts next to this repo.
import { copyFileSync, existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'fs'
import { fileURLToPath } from 'url'
import { dirname, join, resolve } from 'path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const source = resolve(process.argv[2] ?? join(
  __dirname, '../../ScanLake Desktop/packages/scanlake-core/src/scanlake_core/resources/display_info_font',
))
const target = join(__dirname, '../public/display_info_font')

if (!existsSync(source)) {
  console.error(`No font folder at ${source}`)
  process.exit(1)
}
mkdirSync(target, { recursive: true })

const fonts = readdirSync(source)
  .filter(f => f.endsWith('.json') && existsSync(join(source, f.replace(/\.json$/, '.png'))))
  .map(f => f.replace(/\.json$/, ''))
  .sort()

for (const f of readdirSync(target)) {
  if (f !== 'index.json') rmSync(join(target, f))
}
for (const name of fonts) {
  copyFileSync(join(source, `${name}.json`), join(target, `${name}.json`))
  copyFileSync(join(source, `${name}.png`), join(target, `${name}.png`))
}
writeFileSync(join(target, 'index.json'), JSON.stringify({ fonts }, null, 2) + '\n', 'utf-8')
console.log(`Copied ${fonts.length} debug font(s) from ${source}: ${fonts.join(', ') || '(none)'}`)
