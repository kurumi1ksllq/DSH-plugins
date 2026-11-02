// dsh-git-bash-tool had no test at all, so `pnpm -r --if-present` skipped it in
// silence and nothing verified that the plugin's one real seam still works.
//
// The plugin's whole job is rewriting argv[0] for the bash tool, and its
// failure modes are all about *not* touching things: a command that merely
// contains the word "bash", a non-bash argv, or a non-Windows host. These tests
// run on any platform because `apply()` is the only thing that gates on win32 —
// the rewriting itself is pure.
import { test } from 'node:test'
import assert from 'node:assert/strict'

import * as plugin from '../index.js'

const GIT_BASH = 'C:\\Program Files\\Git\\bin\\bash.exe'

/**
 * Run `fn` with `process.platform` reporting win32.
 *
 * `apply()` returns immediately on non-Windows hosts — correctly, since
 * rewriting argv to a Windows path would break every command — but that means
 * a test on Linux would verify nothing at all. The override is restored after.
 */
function asWindows(fn) {
  const original = Object.getOwnPropertyDescriptor(process, 'platform')
  Object.defineProperty(process, 'platform', { value: 'win32', configurable: true })
  try {
    return fn()
  } finally {
    Object.defineProperty(process, 'platform', original)
  }
}

/** Drive the plugin against a fake ctx and capture the patched spawnSpec. */
function mount(ctxShell = {}) {
  const shell = { ...ctxShell }
  const effects = []
  const ctx = {
    logger: { debug() {}, warn() {}, info() {} },
    inject(_deps, cb) {
      cb({ shell, effect: (fn) => effects.push(fn()) })
    },
  }
  asWindows(() => plugin.apply(ctx))
  return { shell, effects }
}

test('isSupported is true only on Windows', () => {
  assert.equal(plugin.isSupported(), process.platform === 'win32')
})

test('a bare bash argv[0] is rewritten to the absolute Git Bash path', () => {
  const { shell } = mount({ spawnSpec: (spec, argv) => ({ spec, argv }) })
  const out = shell.spawnSpec({}, ['bash', '-c', 'echo hi'], 1024)
  assert.equal(out.argv[0], GIT_BASH)
  assert.deepEqual(out.argv.slice(1), ['-c', 'echo hi'])
})

test('a command containing the word bash is not rewritten', () => {
  // The rewrite is positional on purpose: matching the string anywhere would
  // corrupt any command that mentions bash, e.g. `which bash` or `bash -x`.
  const { shell } = mount({ spawnSpec: (spec, argv) => ({ spec, argv }) })
  const out = shell.spawnSpec({}, ['sh', '-c', 'whoami && bash -x ./run.sh'], 1024)
  assert.equal(out.argv[0], 'sh')
  assert.equal(out.argv[2], 'whoami && bash -x ./run.sh')
})

test('a non-array or empty argv passes through untouched', () => {
  const { shell } = mount({ spawnSpec: (spec, argv) => ({ spec, argv }) })
  // The seam still forwards the call; what matters is the argv it forwards.
  assert.equal(shell.spawnSpec({}, undefined).argv, undefined)
  // An empty argv must not become a one-element argv containing the bash path.
  assert.deepEqual(shell.spawnSpec({}, []).argv, [])
})

test('the disposer restores the original spawnSpec', () => {
  const original = (spec, argv) => ({ spec, argv })
  const { shell, effects } = mount({ spawnSpec: original })
  assert.notEqual(shell.spawnSpec, original)
  assert.equal(effects.length, 1)
  effects[0]()
  assert.equal(shell.spawnSpec, original)
})

test('without a spawnSpec seam it falls back instead of throwing', () => {
  // A host that drops the seam must not break activation: no throw, and a
  // disposer is still handed back for cleanup.
  const { effects } = mount({})
  assert.equal(effects.length, 1)
  assert.equal(typeof effects[0], 'function')
})
