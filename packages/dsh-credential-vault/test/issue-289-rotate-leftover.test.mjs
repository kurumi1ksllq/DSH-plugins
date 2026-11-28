// #289 F2:上次 rotate 中途退出留下的 vault.json.new 不得让下一次 rotate 直接 EEXIST 崩。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync, existsSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { createVaultStore } from '../lib/vault-store.js'

function tempDir() {
  return mkdtempSync(join(tmpdir(), 'vault-rotate-289-'))
}

test('#289 残留 vault.json.new 时 rotate 给出可读结论而非 EEXIST', () => {
  const dir = tempDir()
  try {
    const store = createVaultStore(dir)
    store.set('a', { secret: 'alpha' })
    const staged = join(dir, 'vault.json.new')
    // 模拟上一次 rotate 中断:留下一个没被换上去的暂存文件。
    writeFileSync(staged, readFileSync(join(dir, 'vault.json'), 'utf8'))

    let outcome = null
    try {
      store.rotateKey()
      outcome = 'rotated'
    } catch (error) {
      outcome = error
    }

    // 只有两种可接受结果:要么安全完成轮换(残留被替换),要么给出可读错误。
    if (outcome instanceof Error) {
      assert.notEqual(outcome.code, 'EEXIST', '不得把 EEXIST 原样抛给用户')
      assert.match(outcome.message, /轮换|rotate|vault\.json\.new/i)
    } else {
      assert.equal(outcome, 'rotated')
      assert.equal(existsSync(staged), false, '成功轮换后不应留下暂存文件')
    }
    // 无论哪种结果,原有凭据都不能丢。
    assert.equal(store.reveal('a').secret, 'alpha')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
