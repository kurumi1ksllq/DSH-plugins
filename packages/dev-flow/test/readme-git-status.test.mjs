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
test('README documents that every gh query names the repository (#199)', () => {
  // 反向验证:删掉 --repo 说明 → 本测试红。这条文档对应一次真实事故:
  // 镜像改写的机器上 gh 认不出 remote,所有查询静默失败,面板把已合并的
  // issue 显示成开发中。
  assert.ok(README.includes('--repo'), 'must name the explicit --repo flag')
  assert.ok(README.includes('insteadOf'), 'must explain the mirror rewriting that breaks gh')
  assert.ok(README.includes('MERGED_PR_LIMIT'), 'must state the merged-PR window')
})
