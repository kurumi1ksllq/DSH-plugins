import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, normalize } from 'node:path'

import { buildSkillDeps, extractRefs, resolveRef } from '../lib/skill-deps.js'

function skill(root, name, body, refs = {}) {
  mkdirSync(join(root, name), { recursive: true })
  writeFileSync(join(root, name, 'SKILL.md'), `---\nname: ${name}\ndescription: ${name}\n---\n${body}`)
  for (const [file, content] of Object.entries(refs)) {
    const full = join(root, name, 'refs', file)
    mkdirSync(join(full, '..'), { recursive: true })
    writeFileSync(full, content)
  }
}

const graphOf = (root, name) =>
  buildSkillDeps({ skills: [{ name, path: join(root, name, 'SKILL.md') }], roots: [root] })

test('a router skill sees the files it points at under refs/', () => {
  const root = mkdtempSync(join(tmpdir(), 'inv-deps-'))
  skill(root, 'office', ['Read `refs/one.md` first.', 'Then `refs/missing.md`.'].join('\n'), { 'one.md': '# one\n' })
  const graph = graphOf(root, 'office')
  const entry = graph.bySkill.office
  assert.equal(entry.assets, 2)
  assert.equal(entry.refs, 2)
  assert.equal(entry.missing, 1)
  assert.deepEqual(
    entry.edges.map((edge) => [edge.to, edge.exists]).sort(),
    [['office/refs/missing.md', false], ['office/refs/one.md', true]],
  )
  assert.equal(graph.totals.missing, 1)
  assert.equal(graph.missing[0].from, 'office/SKILL.md')
})

test('relative paths inside refs/ resolve against the file, not the skill root', () => {
  const root = mkdtempSync(join(tmpdir(), 'inv-deps-rel-'))
  skill(root, 'deck', 'See `refs/morph/guide.md`.', {
    'morph/guide.md': 'Read `reference/rules.md` and `reference/styles`.\n',
    'morph/reference/rules.md': '# rules\n',
    'morph/reference/styles/INDEX.md': '# styles\n',
  })
  const graph = graphOf(root, 'deck')
  const edges = graph.bySkill.deck.edges
  assert.ok(edges.every((edge) => edge.exists), JSON.stringify(edges))
  assert.equal(graph.totals.missing, 0)
  assert.ok(edges.some((edge) => edge.to === 'deck/refs/morph/reference/rules.md'))
  // `reference/styles` written inside `reference/` must not double the folder.
  assert.ok(!edges.some((edge) => edge.to.includes('reference/reference')))
})

test('command snippets, URLs, XML paths and placeholders are not edges', () => {
  const root = mkdtempSync(join(tmpdir(), 'inv-deps-noise-'))
  skill(
    root,
    'noisy',
    [
      'Run `officecli create a.pptx` then `officecli view / --screenshot`.',
      'POST http://HOST:8188/prompt',
      'Set `/body/p[1]` and `/Sheet1/A1`.',
      'Read `refs/<name>.md` when unsure.',
      'Bare mention: style.md',
    ].join('\n'),
  )
  const graph = graphOf(root, 'noisy')
  assert.equal(graph.bySkill.noisy.refs, 0)
  assert.equal(graph.totals.missing, 0)
})

test('a bare filename counts only when the file is really there', () => {
  const root = mkdtempSync(join(tmpdir(), 'inv-deps-bare-'))
  skill(root, 'plain', 'See `notes.md` and `gone.md`.', { 'notes.md': '# notes\n' })
  const graph = graphOf(root, 'plain')
  assert.deepEqual(graph.bySkill.plain.edges.map((edge) => edge.to), ['plain/refs/notes.md'])
  assert.equal(graph.totals.missing, 0)
})

test('extractRefs keeps drive-letter paths and drops XML document paths', () => {
  assert.deepEqual(extractRefs('`C:\\Users\\me\\.dsh\\skills\\a\\refs\\b.md`'), ['C:\\Users\\me\\.dsh\\skills\\a\\refs\\b.md'])
  assert.deepEqual(extractRefs('Set `/body/p[1]` here.'), [])
  assert.deepEqual(extractRefs('`refs/<name>.md`'), [])
})

test('resolveRef maps known prefixes and refuses unknown shapes', () => {
  const root = mkdtempSync(join(tmpdir(), 'inv-deps-resolve-'))
  mkdirSync(join(root, 'x', 'refs'), { recursive: true })
  const base = { fileDir: join(root, 'x'), skillDir: join(root, 'x'), skillsRoot: root }
  assert.equal(resolveRef('refs/a.md', base), join(root, 'x', 'refs', 'a.md'))
  assert.equal(resolveRef('skills/other/SKILL.md', base), join(root, 'other', 'SKILL.md'))
  assert.equal(resolveRef('C:\\tmp\\a.md', base), normalize('C:/tmp/a.md'))
  assert.equal(resolveRef('nonsense/a.md', base), null)
})

test('a prefix that does not exist under the skill is an external project path', () => {
  const root = mkdtempSync(join(tmpdir(), 'inv-deps-external-'))
  // `scripts\selftest.py` belongs to E:\AI\qwen3-asr-0.6b, not to this skill.
  skill(root, 'asr', '自检：`E:\\AI\\qwen3-asr-0.6b\\py.bat scripts\\selftest.py`')
  const graph = graphOf(root, 'asr')
  assert.equal(graph.bySkill.asr.refs, 0)
  assert.equal(graph.totals.missing, 0)
})
