import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const README = readFileSync(join(here, '..', 'README-git-status.md'), 'utf8')

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

test('README documents no dead package names after the merge (#110 P2-4)', () => {
  // 反向验证:合并后两份 README 都不得再指向已删除的包名/路径,
  // 否则照文档操作必失败(P2-3 的死指令曾经全绿漏网)
  assert.equal(README.includes('dev-flow-skill'), false, 'README-git-status 不得再写 dev-flow-skill')
  assert.equal(README.includes('packages/dsh-git-status'), false, 'README-git-status 不得再写 packages/dsh-git-status')
})

test('README documents the right-sidebar mount, not the left-sidebar page (#197)', () => {
  // The panel moved: the two-stage host contract and the seat names are what a
  // future reader needs, and the old left-sidebar story would send them to a
  // seat that no longer exists.
  assert.ok(README.includes('右侧栏'), 'README must say the panel lives in the right sidebar')
  assert.ok(README.includes('sidebar.right.pane.tab'), 'README must name the body seat')
  assert.ok(README.includes('ctx.sidebarRightTabs.register'), 'README must name the tab-type registry')
  // The negative is about the SEAT, not the words: a reader following the old
  // story would register into a seat this package no longer occupies.
  assert.equal(README.includes('sidebar.panellist'), false, 'README must not point at the left-sidebar seat any more')
})
