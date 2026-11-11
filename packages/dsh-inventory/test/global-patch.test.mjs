import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { definedIds, patchLayerOf, setPatchEnabled, writePatchEnabled } from '../lib/global-patch.js'

// #145: every scratch directory this file makes is registered and removed at the
// end of the run. Leaving them behind accumulated hundreds of dsh-* trees in the
// OS temp dir on every full test run.
const scratchRegistry = []
after(() => {
  for (const dir of scratchRegistry) {
    try {
      rmSync(dir, { recursive: true, force: true })
    } catch {
      // Windows may still hold a handle; a temp leftover is harmless.
    }
  }
})

/** Register a directory for cleanup at the end of the run. */
function track(dir) {
  scratchRegistry.push(dir)
  return dir
}

/**
 * `setPatchEnabled` edits a profile `cordis.patch.yml` by hand: comments and
 * unrelated sequence items must survive, a quoted id must still match, and a
 * block that carries extra keys is a different block (it is not the id/disabled
 * pair this route owns).
 */

/** Read the top-level `- id: ...` blocks of a patch file, in order. */
function blocksOf(text) {
  const blocks = []
  let current = null
  for (const line of text.split(/\r?\n/)) {
    const head = /^-\s+id:\s*(.+?)\s*$/.exec(line)
    if (head !== null) {
      current = { id: head[1].replace(/^["']|["']$/g, ''), lines: [line] }
      blocks.push(current)
      continue
    }
    if (current !== null) current.lines.push(line)
  }
  return blocks.map((block) => {
    const body = block.lines.join('\n')
    const disabled = /^[ \t]+disabled:\s*(true|false)\s*$/m.exec(body)
    return { id: block.id, text: body, disabled: disabled === null ? null : disabled[1] }
  })
}

test('an empty patch gains a new id/disabled block', () => {
  const { text, changed } = setPatchEnabled('', { id: 'mcp-officecli', enabled: false })

  assert.equal(changed, true)
  assert.match(text, /^-\s+id:\s*mcp-officecli$/m)
  assert.match(text, /^[ \t]+disabled:\s*true$/m)
  assert.equal(blocksOf(text).length, 1)
})

test('an existing id/disabled block is flipped in place, comments and neighbours intact', () => {
  const source = [
    '# profile patch (fixture)',
    '# keep this comment',
    '- id: dsh-inventory',
    '  disabled: false',
    '- id: mcp-officecli',
    '  disabled: false',
    '',
  ].join('\n')

  const { text, changed } = setPatchEnabled(source, { id: 'mcp-officecli', enabled: false })

  assert.equal(changed, true)
  assert.ok(text.includes('# profile patch (fixture)'), 'header comment dropped')
  assert.ok(text.includes('# keep this comment'), 'inline comment dropped')
  const blocks = blocksOf(text)
  assert.deepEqual(blocks.map((block) => block.id), ['dsh-inventory', 'mcp-officecli'])
  assert.equal(blocks[0].disabled, 'false', 'unrelated block was rewritten')
  assert.equal(blocks[1].disabled, 'true')
  assert.equal(blocksOf(text).length, 2, 'a duplicate block was appended')
})

test('a quoted id still matches its block', () => {
  for (const quoted of ['- id: "mcp-officecli"', "- id: 'mcp-officecli'"]) {
    const source = `${quoted}\n  disabled: false\n`
    const { text, changed } = setPatchEnabled(source, { id: 'mcp-officecli', enabled: false })

    assert.equal(changed, true, `quoted id not matched: ${quoted}`)
    const blocks = blocksOf(text)
    assert.equal(blocks.length, 1, `appended a second block for ${quoted}`)
    assert.equal(blocks[0].id, 'mcp-officecli')
    assert.equal(blocks[0].disabled, 'true')
  }
})

test('a block that already carries the requested value reports changed:false and is not rewritten', () => {
  const source = '# keep\n- id: mcp-officecli\n  disabled: true\n'

  const { text, changed } = setPatchEnabled(source, { id: 'mcp-officecli', enabled: false })

  assert.equal(changed, false)
  assert.equal(text, source)
})

test('a block with extra keys is not the id/disabled pair, so a new block is appended', () => {
  const source = ['# keep', '- id: mcp-officecli', '  name: something-else', '  disabled: false', ''].join('\n')

  const { text, changed } = setPatchEnabled(source, { id: 'mcp-officecli', enabled: false })

  assert.equal(changed, true)
  const blocks = blocksOf(text)
  assert.equal(blocks.length, 2, 'the extra-key block must not be treated as the toggle target')
  assert.equal(blocks[0].disabled, 'false', 'the extra-key block was rewritten')
  assert.equal(blocks[1].disabled, 'true')
})

test('the last matching block wins when the id appears more than once', () => {
  const source = [
    '- id: mcp-officecli',
    '  disabled: false',
    '- id: other',
    '  disabled: false',
    '- id: mcp-officecli',
    '  disabled: false',
    '',
  ].join('\n')

  const { text } = setPatchEnabled(source, { id: 'mcp-officecli', enabled: false })

  const blocks = blocksOf(text)
  assert.equal(blocks.length, 3)
  assert.equal(blocks[0].disabled, 'false', 'the first duplicate was rewritten')
  assert.equal(blocks[1].disabled, 'false')
  assert.equal(blocks[2].disabled, 'true', 'the last duplicate is the one to flip')
})

test('a block with only an id counts as enabled, so enabling it is a no-op', () => {
  const source = '- id: mcp-officecli\n'

  const on = setPatchEnabled(source, { id: 'mcp-officecli', enabled: true })
  assert.equal(on.changed, false)
  assert.equal(on.text, source)

  const off = setPatchEnabled(source, { id: 'mcp-officecli', enabled: false })
  assert.equal(off.changed, true)
  const blocks = blocksOf(off.text)
  assert.equal(blocks.length, 1, 'the id-only block must be completed, not duplicated')
  assert.equal(blocks[0].disabled, 'true')
})

test('writePatchEnabled persists a new block and preserves the trailing newline', () => {
  const dir = track(mkdtempSync(join(tmpdir(), 'inv-global-patch-')))
  const file = join(dir, 'cordis.patch.yml')
  const source = '# profile patch\n- id: dsh-inventory\n  disabled: false\n'
  writeFileSync(file, source, 'utf8')

  const first = writePatchEnabled(file, { id: 'mcp-officecli', enabled: false })

  assert.equal(first.path, file)
  assert.equal(first.changed, true)
  const written = readFileSync(file, 'utf8')
  assert.ok(written.startsWith('# profile patch\n'), written)
  assert.match(written, /- id: mcp-officecli\n[ \t]+disabled: true/)
  assert.ok(written.endsWith('\n'), 'trailing newline dropped')
  assert.equal(written.endsWith('\n\n'), false, 'extra trailing newline added')

  const second = writePatchEnabled(file, { id: 'mcp-officecli', enabled: false })
  assert.equal(second.changed, false)
  assert.equal(readFileSync(file, 'utf8'), written, 'a no-op write changed the file')
})

test('writePatchEnabled flips an existing block and keeps its neighbours', () => {
  const dir = track(mkdtempSync(join(tmpdir(), 'inv-global-patch-flip-')))
  const file = join(dir, 'cordis.patch.yml')
  writeFileSync(file, '# keep\n- id: mcp-officecli\n  disabled: false\n', 'utf8')

  const result = writePatchEnabled(file, { id: 'mcp-officecli', enabled: false })

  assert.equal(result.changed, true)
  const text = readFileSync(file, 'utf8')
  assert.ok(text.startsWith('# keep\n'), text)
  const blocks = blocksOf(text)
  assert.equal(blocks.length, 1)
  assert.equal(blocks[0].disabled, 'true')
  assert.ok(text.endsWith('\n'))
})

test('patchLayerOf reports home over profile, and null when neither defines the id', () => {
  // The compositor applies profile first, home last: a home insert lands after
  // any profile disable, so the layer that actually decides the final state is
  // the home one. `null` means the id comes from a bundle (or nothing) — the
  // caller keeps writing the profile patch in that case. Definitions are full
  // entries or insert children; the bare `id/disabled` profile block below is
  // the override shape this module writes and must never claim a layer.
  const profile = '- id: dsh-inventory\n  disabled: false\n- id: rea-mcp\n  disabled: true\n'
  const home = '- id: mcp-officecli\n  name: "@deepseek-ai/dsh-mcp-client"\n  disabled: false\n'
  const both = '- insert:\n    - id: rea-mcp\n      name: "@deepseek-ai/dsh-mcp-client"\n'

  assert.equal(patchLayerOf({ id: 'rea-mcp', profilePatch: profile, homePatch: home }), null, 'the profile rea-mcp block is a bare override — it must not claim the layer')
  assert.equal(patchLayerOf({ id: 'mcp-officecli', profilePatch: profile, homePatch: home }), 'home')
  assert.equal(patchLayerOf({ id: 'rea-mcp', profilePatch: profile, homePatch: both }), 'home', 'the last applied layer wins')
  assert.equal(patchLayerOf({ id: 'dsh-inventory', profilePatch: null, homePatch: null }), null)
  assert.equal(patchLayerOf({ id: 'never-seen', profilePatch: profile, homePatch: home }), null)
  assert.equal(patchLayerOf({ id: 'never-seen', profilePatch: null, homePatch: null }), null)
})

test('patchLayerOf matches quoted ids and ignores unrelated id mentions', () => {
  const profile = '- id: "rea-mcp"\n  name: "@deepseek-ai/dsh-mcp-client"\n'
  assert.equal(patchLayerOf({ id: 'rea-mcp', profilePatch: profile, homePatch: null }), 'profile')
  // A config value that merely contains the id must not count as a definition.
  const noise = '- id: other\n  config:\n    name: rea-mcp\n'
  assert.equal(patchLayerOf({ id: 'rea-mcp', profilePatch: noise, homePatch: null }), null)
})

test('definedIds sees insert-nested definitions and full top-level entries, never bare overrides', () => {
  // The rea setup shape: a top-level insert whose children define the rows.
  const home = [
    '# machine-local overrides',
    '- insert:',
    '    - id: rea-mcp',
    '      name: "@deepseek-ai/dsh-mcp-client"',
    '      options:',
    '        config:',
    '          serverName: rea',
    '          transport: stdio',
    '          command: rea',
    '',
  ].join('\n')
  assert.deepEqual([...definedIds(home)], ['rea-mcp'])

  // A full top-level entry (fields beyond disabled) defines its id.
  const profile = '- id: llm-deepseek\n  config:\n    baseURL: http://127.0.0.1:3065\n'
  assert.deepEqual([...definedIds(profile)], ['llm-deepseek'])

  // Bare id/disabled blocks are overrides this module writes, not definitions.
  const dead = '- id: rea-mcp\n  disabled: true\n'
  assert.deepEqual([...definedIds(dead)], [])
})

test('definedIds only counts the shallowest children of an insert block', () => {
  // config lists nested INSIDE an insert child carry their own `- id:` lines;
  // those are data, not definitions.
  const home = [
    '- insert:',
    '    - id: rea-mcp',
    '      options:',
    '        config:',
    '          models:',
    '            - id: shadow-model',
    '              name: Shadow',
    '',
  ].join('\n')
  assert.deepEqual([...definedIds(home)], ['rea-mcp'])
})

test('patchLayerOf resolves the real #89 shape: home insert over a stale profile dead entry', () => {
  // Before #89 both defects stacked: the insert went unseen AND the dead
  // manager write claimed the profile layer, so the toggle kept routing to the
  // manager. The definition must win over the residue.
  const profile = '# profile patch (fixture)\n- id: dsh-inventory\n  disabled: false\n- id: rea-mcp\n  disabled: true\n'
  const home = '- insert:\n    - id: rea-mcp\n      name: "@deepseek-ai/dsh-mcp-client"\n'
  assert.equal(patchLayerOf({ id: 'rea-mcp', profilePatch: profile, homePatch: home }), 'home')

  // With no insert anywhere, the dead entry alone must not claim the layer.
  assert.equal(patchLayerOf({ id: 'rea-mcp', profilePatch: profile, homePatch: null }), null)
})
