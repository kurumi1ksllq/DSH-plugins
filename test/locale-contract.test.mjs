// T4.H3 (#127): one source of truth for every client locale dictionary.
//
// For each bundle that registers a locale namespace (zh/en dicts) this pins:
//   1. zh and en carry EXACTLY the same key sets;
//   2. the dict keys still exist (a deleted-elsewhere key that drifted back
//      or a half-edit is red here).
// Key-level consumption checks live in the per-package suites; this file is
// the repo-level net that keeps the dictionaries themselves honest.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const repo = join(dirname(fileURLToPath(import.meta.url)), '..')

/** Extract the brace-balanced object text following "const NAME = {" (or "NAME: {"). */
function extractDict(source, decl) {
  const start = source.indexOf(decl)
  if (start === -1) return null
  const open = source.indexOf('{', start)
  let depth = 0
  for (let i = open; i < source.length; i += 1) {
    if (source[i] === '{') depth += 1
    if (source[i] === '}') {
      depth -= 1
      if (depth === 0) return source.slice(open, i + 1)
    }
  }
  return null
}

/** Evaluate a brace-balanced object literal in a controlled context (issue #136
 * 轴2 P1):正则提键漏点分键且被文案内容里的括号干扰;vm 求值后 Object.keys
 * 天然字符串安全、键集完整。仅用于本仓库自有的字典源码(非不可信输入)。 */
function evalDictKeys(text) {
  const fn = new Function(`return (${text});`)
  return Object.keys(fn())
}

/** Top-level keys of one dict object (string keys, quoted or bare). */
function dictKeys(text) {
  const keys = []
  let depth = 0
  for (const line of text.split('\n')) {
    const opens = (line.match(/[{([]/g) ?? []).length
    const closes = (line.match(/[})\]]/g) ?? []).length
    if (depth === 1) {
      const m = line.match(/^\s*'?([A-Za-z0-9_.\-]+)'?\s*:/)
      if (m) keys.push(m[1])
    }
    depth += opens - closes
  }
  return keys
}

// Decl strings per bundle: how its two dicts are declared in source.
const BUNDLES = [
  { pkg: 'dsh-inventory', path: 'packages/dsh-inventory/client/10-header.js', zh: 'const zh = {', en: 'const en = {' },
  { pkg: 'dev-flow', path: 'packages/dev-flow/client.js', zh: 'const zh = {', en: 'const en = {' },
  { pkg: 'dsh-websearch-failover', path: 'packages/dsh-websearch-failover/client.js', zh: 'const zh = {', en: 'const en = {' },
  { pkg: 'dsh-credential-vault', path: 'packages/dsh-credential-vault/client.js', zh: 'const zh = {', en: 'const en = {' },
  { pkg: 'dsh-deep-ptc-mode', path: 'packages/dsh-deep-ptc-mode/lib/client.js', zh: 'zh: {', en: 'en: {' },
]

for (const { pkg, path, zh, en } of BUNDLES) {
  test(`${pkg}: zh and en locale dictionaries carry the same keys`, () => {
    const source = readFileSync(join(repo, path), 'utf8')
    const zhDict = extractDict(source, zh)
    const enDict = extractDict(source, en)
    assert.ok(zhDict, `zh dict found in ${path}`)
    assert.ok(enDict, `en dict found in ${path}`)
    const zhKeys = evalDictKeys(zhDict)
    const enKeys = evalDictKeys(enDict)
    assert.ok(zhKeys.length > 5, `${pkg}: zh dict non-trivial (${zhKeys.length} keys)`)
    const missingInEn = zhKeys.filter((k) => !enKeys.includes(k))
    const missingInZh = enKeys.filter((k) => !zhKeys.includes(k))
    assert.deepEqual(missingInEn, [], `${pkg}: keys missing in en: ${missingInEn.join(',')}`)
    assert.deepEqual(missingInZh, [], `${pkg}: keys missing in zh: ${missingInZh.join(',')}`)
  })
}

// ---- #136:locale/*.json 侧(宿主 dsh-client-locale 消费面)契约 ----
//
// locale/{zh,en}.json 经 package.json exports["./locale/*.json"] 由宿主
// @deepseek-ai/dsh-client-locale 注册,是宿主渲染的文案全集;client.js 内嵌
// 字典是其消费子集(审计 #136:websearch 完全同源 51=51;vault JSON 43 ⊇
// client 40,差集 createdName/entriesCount/never 为宿主面板碎片)。钉住两条:
//   1. zh/en 键集一致(双向);
//   2. client 内嵌 zh 字典 ⊆ locale/zh.json(防「client 加键忘 JSON」的真漂移;
//      JSON ⊃ client 的余量是宿主专用键,合法,不要求反向)。
const JSON_CONTRACTS = [
  { pkg: 'dsh-credential-vault', dir: 'packages/dsh-credential-vault/locale', client: 'packages/dsh-credential-vault/client.js' },
  { pkg: 'dsh-websearch-failover', dir: 'packages/dsh-websearch-failover/locale', client: 'packages/dsh-websearch-failover/client.js' },
  // dsh-inventory 的 locale/*.json 同样经 exports 声明(轴1#1 补键集一致);但它通过
  // ctx.locale.register(NS,{zh,en}) 自注字典(client.js:4671),client 内嵌字典与
  // locale/*.json 不同源——subset 断言不适用,故 skipSubset。
  { pkg: 'dsh-inventory', dir: 'packages/dsh-inventory/locale', client: 'packages/dsh-inventory/client.js', minKeys: 1, skipSubset: true },
];

for (const { pkg, dir, client, minKeys, skipSubset } of JSON_CONTRACTS) {
  const zhJson = JSON.parse(readFileSync(join(repo, dir, 'zh.json'), 'utf8'))
  const enJson = JSON.parse(readFileSync(join(repo, dir, 'en.json'), 'utf8'))

  test(`${pkg}: locale/*.json zh and en carry the same keys`, () => {
    const zhKeys = Object.keys(zhJson).sort()
    const enKeys = Object.keys(enJson).sort()
    assert.ok(zhKeys.length > 0, `${pkg}: locale zh non-trivial (${zhKeys.length} keys)`)
    assert.deepEqual(
      enKeys.filter((k) => !zhKeys.includes(k)), [],
      `${pkg}: locale keys missing in en.json`,
    )
    assert.deepEqual(
      zhKeys.filter((k) => !enKeys.includes(k)), [],
      `${pkg}: locale keys missing in zh.json`,
    )
  })

  if (!skipSubset) {
    // client 内嵌字典 ⊆ locale/*.json(双侧对称,#136 轴2 P3):只钉 zh 侧会漏
    // 「zh.json 加了 en.json 漏了」的组合漂移。
    const clientSource = readFileSync(join(repo, client), 'utf8')
    const zhDictText = extractDict(clientSource, 'const zh = {')
    assert.ok(zhDictText, `${pkg}: client embedded zh dict found`)
    const enDictText = extractDict(clientSource, 'const en = {')
    assert.ok(enDictText, `${pkg}: client embedded en dict found`)
    const zhClientKeys = [...new Set(evalDictKeys(zhDictText))]
    const enClientKeys = [...new Set(evalDictKeys(enDictText))]
    assert.deepEqual(
      zhClientKeys.filter((k) => !Object.keys(zhJson).includes(k)), [],
      `${pkg}: client zh keys absent from locale/zh.json`,
    )
    assert.deepEqual(
      enClientKeys.filter((k) => !Object.keys(enJson).includes(k)), [],
      `${pkg}: client en keys absent from locale/en.json`,
    )
  }
}
