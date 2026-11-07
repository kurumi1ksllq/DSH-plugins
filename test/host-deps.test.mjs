import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readdir, readFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
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
    // websearch 的嵌套 bundle:plugin/ 子树有自己的 manifest,声明归属按目录就近取
    const nestedManifestPath = path.join(dir, 'plugin', 'package.json')
    const hasNested = existsSync(nestedManifestPath)
    const rootManifest = JSON.parse(await readFile(path.join(dir, 'package.json'), 'utf8'))
    const nestedManifest = hasNested ? JSON.parse(await readFile(nestedManifestPath, 'utf8')) : null
    const declared = new Set([
      ...Object.keys(rootManifest.dependencies ?? {}),
      ...Object.keys(rootManifest.peerDependencies ?? {}),
    ])
    const walk = async (cur, rel) => {
      for (const it of await readdir(cur, { withFileTypes: true }).catch(() => [])) {
        if (SKIP_DIRS.has(it.name)) continue
        const fp = path.join(cur, it.name)
        const relPath = rel ? rel + '/' + it.name : it.name
        if (it.isDirectory()) { await walk(fp, relPath); continue }
        if (!SRC_EXT.test(it.name)) continue
        const inNested = hasNested && relPath.startsWith('plugin/')
        const declaredHere = inNested
          ? new Set([...Object.keys(nestedManifest.dependencies ?? {}), ...Object.keys(nestedManifest.peerDependencies ?? {})])
          : declared
        const lines = (await readFile(fp, 'utf8')).split('\n')
        lines.forEach((line, i) => {
          if (COMMENT_RE.test(line)) return
          // 动态拼接红线:import('@deepseek-ai/' + x) 或 import(`@deepseek-ai/${x}`) 绕过字面量声明
          if (/\bimport\s*\(\s*['"`]@deepseek-ai\/['"`]\s*\+/.test(line) || /\bimport\s*\(\s*\`@deepseek-ai\/\`/.test(line)) {
            violations.push(`packages/${pkg}/${relPath}:${i + 1} -> 动态拼接宿主 specifier(禁止:请声明完整 specifier)`)
          }
          for (const m of line.matchAll(SPEC_RE)) {
            const spec = m[0]
            const top = spec.split('/').slice(0, 2).join('/')
            if (!declaredHere.has(top)) {
              violations.push(`packages/${pkg}/${relPath}:${i + 1} -> ${spec} (未在 dependencies/peerDependencies 声明)`)
            }
          }
        })
      }
    }
    await walk(dir, '')
  }
  if (violations.length > 0) assert.fail(violations.join('\n'))
})
