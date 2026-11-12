import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { setSkillEnabled } from '../lib/skill-toggle.js'

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
 * `setSkillEnabled` flips `disable-model-invocation` in one SKILL.md without
 * touching anything else: the file is hand-edited markdown, so a byte the
 * caller did not ask about (BOM, CRLF, a folded description, the body) must
 * survive the round trip.
 */

function skillFixture(label, text) {
  const dir = track(mkdtempSync(join(tmpdir(), `inv-skill-toggle-${label}-`)))
  const path = join(dir, 'SKILL.md')
  writeFileSync(path, text, 'utf8')
  return { path, read: () => readFileSync(path, 'utf8') }
}

/** setSkillEnabled may throw synchronously or reject; both are contract failures. */
async function failureOf(fn) {
  try {
    await fn()
  } catch (error) {
    return error
  }
  assert.fail('expected setSkillEnabled to throw')
}

const LF_SKILL = [
  '---',
  'name: demo-skill',
  'description: toggle fixture',
  '---',
  '# demo-skill',
  '',
  'Body line one.',
  '',
].join('\n')

test('disabling a skill adds the flag and leaves every other line intact', () => {
  const fixture = skillFixture('add', LF_SKILL)

  const result = setSkillEnabled({ path: fixture.path, enabled: false })

  assert.equal(result.ok, true)
  assert.equal(result.path, fixture.path)
  assert.equal(result.changed, true)

  const text = fixture.read()
  assert.match(text, /^disable-model-invocation: true$/m)
  assert.equal(text.match(/disable-model-invocation/g).length, 1, 'the flag must be written exactly once')
  // The untouched frontmatter keys and the body are byte-identical.
  assert.ok(text.startsWith('---\nname: demo-skill\ndescription: toggle fixture\n'), text)
  assert.ok(text.includes('\n---\n# demo-skill\n\nBody line one.\n'), text)
})

test('a CRLF skill keeps CRLF line endings after the flag is added', () => {
  const source = '---\r\nname: demo-skill\r\ndescription: crlf fixture\r\n---\r\n# demo\r\n\r\nbody\r\n'
  const fixture = skillFixture('crlf', source)

  const result = setSkillEnabled({ path: fixture.path, enabled: false })

  assert.equal(result.changed, true)
  const text = fixture.read()
  assert.match(text, /\r\ndisable-model-invocation: true\r\n/)
  // No lone LF may be introduced into a CRLF file.
  assert.equal(text.split('\r\n').join('').includes('\n'), false, 'mixed line endings')
  assert.ok(text.endsWith('\r\n# demo\r\n\r\nbody\r\n'), text)
})

test('a UTF-8 BOM is preserved', () => {
  const source = '\uFEFF---\r\nname: demo-skill\r\ndescription: bom fixture\r\n---\r\nbody\r\n'
  const fixture = skillFixture('bom', source)

  setSkillEnabled({ path: fixture.path, enabled: false })

  const text = fixture.read()
  assert.equal(text.charCodeAt(0), 0xfeff, 'BOM dropped')
  assert.ok(text.startsWith('\uFEFF---\r\nname: demo-skill'), text)
  assert.equal(text.split('\r\n').join('').includes('\n'), false, 'mixed line endings')
})

test('a file without frontmatter is refused with no-frontmatter and not written', async () => {
  const source = '# just a body\n\nno frontmatter here\n'
  const fixture = skillFixture('no-fm', source)

  const error = await failureOf(() => setSkillEnabled({ path: fixture.path, enabled: false }))

  assert.equal(error.code, 'no-frontmatter')
  assert.equal(fixture.read(), source, 'a refused file must be left alone')
})

test('disabling an already-disabled skill reports changed:false and writes nothing', () => {
  const source = '---\nname: demo-skill\ndescription: off fixture\ndisable-model-invocation: true\n---\nbody\n'
  const fixture = skillFixture('already-off', source)

  const result = setSkillEnabled({ path: fixture.path, enabled: false })

  assert.equal(result.ok, true)
  assert.equal(result.changed, false)
  assert.equal(fixture.read(), source)
})

test('enabling a disabled skill removes the flag line and keeps the rest', () => {
  const source = [
    '---',
    'name: demo-skill',
    'description: on fixture',
    'disable-model-invocation: true',
    'user-invocable: true',
    '---',
    '# demo',
    '',
    'body',
    '',
  ].join('\n')
  const fixture = skillFixture('remove', source)

  const result = setSkillEnabled({ path: fixture.path, enabled: true })

  assert.equal(result.changed, true)
  const text = fixture.read()
  assert.equal(/disable-model-invocation/.test(text), false, 'flag line survived')
  assert.equal(
    text,
    ['---', 'name: demo-skill', 'description: on fixture', 'user-invocable: true', '---', '# demo', '', 'body', ''].join('\n'),
  )
})

test('enabling an already-enabled skill reports changed:false and writes nothing', () => {
  const fixture = skillFixture('already-on', LF_SKILL)

  const result = setSkillEnabled({ path: fixture.path, enabled: true })

  assert.equal(result.changed, false)
  assert.equal(fixture.read(), LF_SKILL)
})

test('an explicit false value is rewritten to true, not duplicated', () => {
  const source = '---\nname: demo-skill\ndescription: stale fixture\ndisable-model-invocation: false\n---\nbody\n'
  const fixture = skillFixture('stale', source)

  const result = setSkillEnabled({ path: fixture.path, enabled: false })

  assert.equal(result.changed, true)
  const text = fixture.read()
  assert.match(text, /^disable-model-invocation: true$/m)
  assert.equal(text.match(/disable-model-invocation/g).length, 1, 'duplicate flag')
  assert.equal(text.includes('disable-model-invocation: false'), false)
})

test('a missing skill file is refused with missing-file', async () => {
  const dir = track(mkdtempSync(join(tmpdir(), 'inv-skill-toggle-missing-')))

  const error = await failureOf(() => setSkillEnabled({ path: join(dir, 'SKILL.md'), enabled: false }))

  assert.equal(error.code, 'missing-file')
})
