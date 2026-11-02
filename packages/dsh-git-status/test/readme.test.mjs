import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const README = readFileSync(join(here, '..', 'README.md'), 'utf8')

test('README documents the task board, not the old card stack', () => {
  assert.ok(README.includes('任务板'), 'README must describe the task board')
})

test('README lists all eight columns by name', () => {
  for (const col of ['待处理', '方案中', '开发中', '待 PR', 'CI', '待 review', '待 merge', '已完成']) {
    assert.ok(README.includes(col), `README missing column ${col}`)
  }
})

test('README documents the .flow state file path and contract', () => {
  assert.ok(README.includes('docs/specs/.flow/<issue>.json'))
  assert.ok(README.includes('state'), 'must mention the state-file field')
})

test('README states that git evidence overrides a stale state file', () => {
  assert.ok(README.includes('状态过期'))
})

test('README still claims read-only behaviour', () => {
  assert.ok(README.includes('只读'))
})
