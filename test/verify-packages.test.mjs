// Contract tests for scripts/verify-packages.mjs.
//
// The client check reads `exports["./client"]` because that is what the host
// (dsh-client-modules) actually resolves — a bundle that declares `dsh.client`
// without the export fails at runtime, so it must fail `pnpm verify` here.
// Each case builds its own throwaway workspace under the OS temp dir (the
// script's `--root` flag) and asserts the script's verdict, so nothing here
// reads or writes this repository's packages/, and breaking the check turns
// these tests red.
//
// The malformed-manifest case pins the host's semantics (clientExportOf throws
// "must be a string or an object with a string default"), not a vague fallback:
// a verifier that says "missing export" for a malformed export sends the reader
// editing the wrong field.

import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const ROOT = join(here, '..')
const SCRIPT = join(ROOT, 'scripts', 'verify-packages.mjs')

/** Run the verifier against a throwaway workspace; parse the text verdict. */
function run(rootDir) {
  const result = spawnSync(process.execPath, [SCRIPT, '--root', rootDir], { encoding: 'utf8' })
  return { status: result.status, out: (result.stdout ?? '') + (result.stderr ?? '') }
}

/** A workspace with one minimal bundle in it, shaped by `manifest` overrides. */
function makeWorkspace({ name = 'fake-bundle', manifest = {}, files = {} } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-verify-packages-'))
  const bundle = join(dir, 'packages', name)
  mkdirSync(bundle, { recursive: true })
  writeFileSync(join(bundle, 'cordis.patch.yml'), '# fake\n')
  writeFileSync(
    join(bundle, 'package.json'),
    JSON.stringify({
      name,
      version: '1.0.0',
      engines: { dsh: '^0.2.0' },
      scripts: { test: 'node --test test/*.test.mjs' },
      dsh: { bundle: { patch: './cordis.patch.yml' } },
      ...manifest,
    }),
  )
  for (const [file, content] of Object.entries(files)) {
    mkdirSync(join(bundle, dirname(file)), { recursive: true })
    writeFileSync(join(bundle, file), content)
  }
  return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) }
}

test('a bundle with a string exports["./client"] passes when the target exists', () => {
  const { dir, cleanup } = makeWorkspace({
    manifest: { exports: { './client': './web/client.js' } },
    files: { 'web/client.js': 'export const face = "client"\n' },
  })
  try {
    const { status, out } = run(dir)
    assert.equal(status, 0, out)
    assert.match(out, /1 bundle/)
  } finally {
    cleanup()
  }
})

test('a bundle with a conditional exports["./client"] resolves through default', () => {
  const { dir, cleanup } = makeWorkspace({
    manifest: { exports: { './client': { import: './web/client.mjs', default: './web/client.js' } } },
    files: { 'web/client.js': 'export const face = "client"\n' },
  })
  try {
    const { status, out } = run(dir)
    assert.equal(status, 0, out)
  } finally {
    cleanup()
  }
})

test('a bundle that declares dsh.client without exports["./client"] fails', () => {
  const { dir, cleanup } = makeWorkspace({ manifest: { dsh: { bundle: { patch: './cordis.patch.yml' }, client: { platform: 'web' } } } })
  try {
    const { status, out } = run(dir)
    assert.equal(status, 1)
    assert.match(out, /declares a web client but exports no "\.\/client" entry/)
  } finally {
    cleanup()
  }
})

test('a bundle whose exports["./client"] points at a missing file fails', () => {
  const { dir, cleanup } = makeWorkspace({
    manifest: { dsh: { bundle: { patch: './cordis.patch.yml' }, client: { platform: 'web' } }, exports: { './client': './web/client.js' } },
  })
  try {
    const { status, out } = run(dir)
    assert.equal(status, 1)
    assert.match(out, /exports\["\.\/client"\] -> \.\/web\/client\.js missing/)
  } finally {
    cleanup()
  }
})

test('a malformed exports["./client"] fails with the host wording, not a vague fallback', () => {
  // The host throws "must be a string or an object with a string default" for
  // this shape (dsh-client-modules clientExportOf); the verifier must speak the
  // same language so the reader edits the right field.
  const { dir, cleanup } = makeWorkspace({
    manifest: {
      dsh: { bundle: { patch: './cordis.patch.yml' }, client: { platform: 'web' } },
      exports: { './client': { import: './web/client.js' } },
    },
    files: { 'web/client.js': 'export const face = "client"\n' },
  })
  try {
    const { status, out } = run(dir)
    assert.equal(status, 1)
    assert.match(out, /must be a string or an object with a string default/)
    assert.equal(/missing/.test(out), false, `the verdict must not say "missing" for a malformed export: ${out}`)
  } finally {
    cleanup()
  }
})

test('a bundle with no dsh.client needs no client export at all', () => {
  const { dir, cleanup } = makeWorkspace()
  try {
    const { status, out } = run(dir)
    assert.equal(status, 0, out)
  } finally {
    cleanup()
  }
})
