import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { zstdCompressSync } from 'node:zlib'

import { decodeSessionBuffer, parseSessionEvents, readSessionEvents } from '../lib/decode-session.js'

const line = (o) => JSON.stringify(o) + '\n'

test('decodes multi-frame zstd written one frame per append', () => {
  const events = [
    { type: 'session', version: 4, id: 's1' },
    { type: 'tool/call', seq: 1, data: { name: 'read' } },
    { type: 'tool/result', seq: 2, data: {} },
  ]
  const buf = Buffer.concat(events.map((e) => zstdCompressSync(Buffer.from(line(e), 'utf8'))))

  const { text, frames } = decodeSessionBuffer(buf)
  assert.equal(frames, 3)
  assert.match(text, /tool\/call/)

  const parsed = parseSessionEvents(text)
  assert.equal(parsed.badLines, 0)
  assert.deepEqual(parsed.events.map((e) => e.type), ['session', 'tool/call', 'tool/result'])
})

test('reads a plain jsonl session and skips malformed lines', () => {
  const dir = mkdtempSync(join(tmpdir(), 'inv-decode-'))
  const file = join(dir, 'session.v4.jsonl')
  writeFileSync(file, line({ type: 'session' }) + 'not-json\n' + line({ type: 'tool/call', seq: 1, data: { name: 'x' } }))

  const result = readSessionEvents(file)
  assert.equal(result.format, 'jsonl')
  assert.equal(result.badLines, 1)
  assert.equal(result.events.length, 2)
  assert.equal(result.events[1].data.name, 'x')
})

test('treats an empty session file as an empty observation', () => {
  const dir = mkdtempSync(join(tmpdir(), 'inv-decode-empty-'))
  const file = join(dir, 'session.v4.jsonl')
  writeFileSync(file, '')
  const result = readSessionEvents(file)
  assert.deepEqual(result.events, [])
  assert.equal(result.badLines, 0)
})

test('a truncated or corrupt zstd frame degrades to empty text instead of throwing', () => {
  const garbage = Buffer.concat([Buffer.from([0x28, 0xb5, 0x2f, 0xfd]), Buffer.alloc(32, 0x7a)])
  const decoded = decodeSessionBuffer(garbage)
  assert.equal(decoded.text, '')
  assert.equal(decoded.format, 'empty')
  assert.deepEqual(parseSessionEvents(decoded.text), { events: [], badLines: 0 })
})

test('a frame whose magic appears inside payload still decodes every real frame', () => {
  // Second frame's payload contains the magic bytes, so a naive split mis-slices.
  const first = zstdCompressSync(Buffer.from(line({ type: 'session' }), 'utf8'))
  const payload = Buffer.from(line({ type: 'tool/call', seq: 1, data: { name: 'read' } }), 'utf8')
  const second = zstdCompressSync(payload)
  const { events } = parseSessionEvents(decodeSessionBuffer(Buffer.concat([first, second])).text)
  assert.deepEqual(events.map((event) => event.type), ['session', 'tool/call'])
})
