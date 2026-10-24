/**
 * Session log decoding.
 *
 * A DSH session is an append-only JSONL stream, stored either as plain
 * `session.v4.jsonl` or zstd-compressed `session.v4.jsonl.zstd`. The
 * compressed form is NOT one zstd stream: every append writes its own frame,
 * so a 1.5 MB file can hold hundreds of frames and a single
 * `zstdDecompressSync` call only returns the first one. We scan the frame
 * magic, decompress frame by frame, and stitch the text back together.
 */

import { readFileSync } from 'node:fs'
import { zstdDecompressSync } from 'node:zlib'

/** Zstandard frame magic (RFC 8878 §3.1.1). */
export const ZSTD_MAGIC = Buffer.from([0x28, 0xb5, 0x2f, 0xfd])

/**
 * Decode a session file buffer into text.
 * @param {Buffer} buf - raw file bytes.
 * @returns {{text: string, frames: number, format: 'jsonl'|'zstd'|'empty'}}
 */
export function decodeSessionBuffer(buf) {
  const starts = []
  let at = 0
  while ((at = buf.indexOf(ZSTD_MAGIC, at)) !== -1) {
    starts.push(at)
    at += ZSTD_MAGIC.length
  }
  if (starts.length === 0) {
    const text = buf.toString('utf8')
    return { text, frames: 0, format: text.length === 0 ? 'empty' : 'jsonl' }
  }

  const parts = []
  let pending = null
  for (let i = 0; i < starts.length; i += 1) {
    const from = pending ?? starts[i]
    const to = i + 1 < starts.length ? starts[i + 1] : buf.length
    try {
      parts.push(zstdDecompressSync(buf.subarray(from, to)).toString('utf8'))
      pending = null
    } catch {
      // A magic found inside compressed payload is not a frame start: absorb
      // the bytes and retry with the next candidate boundary.
      pending = from
    }
  }
  if (pending !== null) {
    try {
      parts.push(zstdDecompressSync(buf.subarray(pending)).toString('utf8'))
    } catch {
      // Truncated tail (crash mid-append): keep what decoded.
    }
  }
  const text = parts.join('')
  return { text, frames: starts.length, format: text.length === 0 ? 'empty' : 'zstd' }
}

/**
 * Parse decoded text into events, skipping malformed lines.
 * @param {string} text - decoded JSONL text.
 * @returns {{events: object[], badLines: number}}
 */
export function parseSessionEvents(text) {
  const events = []
  let badLines = 0
  for (const raw of text.split('\n')) {
    const line = raw.trim()
    if (line.length === 0) continue
    try {
      events.push(JSON.parse(line))
    } catch {
      badLines += 1
    }
  }
  return { events, badLines }
}

/**
 * Read and decode one session log file.
 * @param {string} file - absolute path to `session.v4.jsonl[.zstd]`.
 * @returns {{events: object[], badLines: number, format: string, frames: number}}
 */
export function readSessionEvents(file) {
  const buf = readFileSync(file)
  const { text, frames, format } = decodeSessionBuffer(buf)
  const { events, badLines } = parseSessionEvents(text)
  return { events, badLines, frames, format }
}
