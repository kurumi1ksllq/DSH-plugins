import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readdir, readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const SKIP_DIRS = new Set(['node_modules', 'test', 'scripts', 'tools', '.git'])
const SRC_EXT = /\.(js|mjs|cjs|mts|ts)$/
// 运行时代码中的任何 @deepseek-ai/* 引用(静态导入、动态导入、importHost、specifier 常量)都必须声明。
const SPEC_RE = /@deepseek-ai\/[a-z0-9-]+(?:\/[a-z0-9-./]+)?/g
const COMMENT_RE = /^\s*(\/\/|\/\*|\*)/

test('runtime @deepseek-ai references must be declared in package.json (0-intrusion rule B)', async () => {
  const packagesDir = path.join(ROOT, 'packages')
  const violations = []
  for (const d of (await readdir(packagesDir, { withFileTypes: true })).filter(x => x.isDirectory())) {
    const pkg = d.name
    const dir = path.join(packagesDir, pkg)
    const manifest = JSON.parse(await readFile(path.join(dir, 'package.json'), 'utf8'))
    const declared = new Set([
      ...Object.keys(manifest.dependencies ?? {}),
      ...Object.keys(manifest.peerDependencies ?? {}),
    ])
    const walk = async (cur, rel) => {
      for (const it of await readdir(cur, { withFileTypes: true }).catch(() => [])) {
        if (SKIP_DIRS.has(it.name)) continue
        const fp = path.join(cur, it.name)
        const relPath = rel ? rel + '/' + it.name : it.name
        if (it.isDirectory()) { await walk(fp, relPath); continue }
        if (!SRC_EXT.test(it.name)) continue
        const lines = (await readFile(fp, 'utf8')).split('\n')
        lines.forEach((line, i) => {
          if (COMMENT_RE.test(line)) return
          for (const m of line.matchAll(SPEC_RE)) {
            const spec = m[0]
            const top = spec.split('/').slice(0, 2).join('/')
            if (!declared.has(top)) {
              violations.push(`packages/${pkg}/${relPath}:${i + 1} -> ${spec} (未在 dependencies/peerDependencies 声明)`)
            }
          }
        })
      }
    }
    await walk(dir, '')
  }
  assert.deepEqual(violations, [])
})
