// #290(原 #270):关键配置必须原子写 —— 中途失败不能截断目标文件,已存在文件的权限位要被纠正。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  chmodSync,
  closeSync,
  mkdtempSync,
  openSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { atomicWrite } from '../lib/atomic-write.js'
import { writeState, statePath } from '../lib/sync-state.js'
import { writePatchEnabled } from '../lib/global-patch.js'

function tempDir() {
  return mkdtempSync(join(tmpdir(), 'atomic-write-290-'))
}

const modeOf = (file) => statSync(file).mode & 0o777

test('#290 写入中途抛错时目标文件保持原内容,且不留临时文件', () => {
  const dir = tempDir()
  try {
    const target = join(dir, 'cordis.patch.yml')
    writeFileSync(target, 'original: true\n', 'utf8')
    // 只让「写」这一步失败,其余交给真实 fs:模拟磁盘写满 / 断电。
    const failingFs = {
      openSync,
      closeSync,
      fchmodSync: () => {},
      renameSync,
      rmSync,
      writeFileSync: () => {
        throw new Error('disk full')
      },
    }
    assert.throws(() => atomicWrite(target, 'replaced: true\n', { fs: failingFs }), /disk full/)
    assert.equal(readFileSync(target, 'utf8'), 'original: true\n')
    assert.deepEqual(readdirSync(dir), ['cordis.patch.yml'], '失败后不得残留临时文件')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('#290 atomicWrite 把已存在文件的权限位纠正为指定 mode', () => {
  const dir = tempDir()
  try {
    const target = join(dir, 'state.json')
    writeFileSync(target, '{}\n', 'utf8')
    chmodSync(target, 0o644)
    atomicWrite(target, '{"a":1}\n', { mode: 0o600 })
    assert.equal(readFileSync(target, 'utf8'), '{"a":1}\n')
    assert.equal(modeOf(target), 0o600)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('#290 writeState 覆盖已存在的状态文件时把权限收紧到 0600', async () => {
  const home = tempDir()
  const env = { ...process.env, DSH_HOME: home }
  try {
    const path = statePath(env)
    writeFileSync(path, JSON.stringify({ repo: 'owner/repo', token: 't' }) + '\n', 'utf8')
    chmodSync(path, 0o644)
    await writeState({ ref: 'dev' }, env)
    const saved = JSON.parse(readFileSync(path, 'utf8'))
    assert.equal(saved.repo, 'owner/repo', '部分更新不得丢已有字段')
    assert.equal(saved.ref, 'dev')
    assert.equal(modeOf(path), 0o600)
  } finally {
    rmSync(home, { recursive: true, force: true })
  }
})

test('#290 writePatchEnabled 写入后不留临时文件', () => {
  const dir = tempDir()
  try {
    const file = join(dir, 'cordis.patch.yml')
    writeFileSync(file, '- id: demo\n  disabled: true\n', 'utf8')
    const result = writePatchEnabled(file, { id: 'demo', enabled: true })
    assert.equal(result.changed, true)
    assert.match(readFileSync(file, 'utf8'), /disabled: false/)
    assert.deepEqual(readdirSync(dir), ['cordis.patch.yml'])
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
