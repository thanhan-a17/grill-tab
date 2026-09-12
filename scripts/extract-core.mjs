import { readFile, writeFile } from 'node:fs/promises'

const sourcePath = new URL('../desktop/plugin.js', import.meta.url)
const targetPath = new URL('../desktop/grill-core.mjs', import.meta.url)
const source = await readFile(sourcePath, 'utf8')
const startMarker = '// @core-start'
const endMarker = '// @core-end'
const start = source.indexOf(startMarker)
const end = source.indexOf(endMarker)

if (start < 0 || end < 0 || end <= start) {
  throw new Error('plugin.js must contain one ordered @core-start/@core-end marker pair')
}

await writeFile(targetPath, `${source.slice(start + startMarker.length, end).trim()}\n`, 'utf8')
