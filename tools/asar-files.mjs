#!/usr/bin/env node
// List files inside app.asar with sizes, filtered by a path prefix/substring.
// Usage: node tools/asar-files.cjs [prefix] [--all]
// Reads the asar header (first 16 bytes: 4 uint32; offset 12 = header JSON length).
import fs from 'node:fs'
import path from 'node:path'

const ASAR = process.env.ASAR ?? 'E:/DeepSeekHarness/resources/app.asar'
const argument = process.argv[2] ?? ''
const showAll = process.argv.includes('--all')

const fd = fs.openSync(ASAR, 'r')
const head = Buffer.alloc(16)
fs.readSync(fd, head, 0, 16, 0)
const headerSize = head.readUInt32LE(12)
const headerBuf = Buffer.alloc(headerSize)
fs.readSync(fd, headerBuf, 0, headerSize, 16)
const header = JSON.parse(headerBuf.toString('utf8').replace(/\0+$/, ''))
const base = 16 + headerSize

const out = []
function walk(node, prefix) {
  for (const [name, child] of Object.entries(node.files ?? {})) {
    const full = `${prefix}/${name}`
    if (child.files) walk(child, full)
    else out.push({ path: full, size: child.size ?? 0 })
  }
}
walk(header, '')
fs.closeSync(fd)

const matches = out.filter((f) => (showAll ? true : f.path.includes(argument)))
matches.sort((a, b) => a.path.localeCompare(b.path))
for (const f of matches) console.log(String(f.size).padStart(9), f.path)
console.error(`# ${matches.length} files of ${out.length}`)
