import fs from 'node:fs'

const snapshot = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'))
const text = JSON.stringify(snapshot)
const probes = [
  'DSH-plugins',
  'dsh-ctx-guard',
  'dsh-git-bash-tool',
  'dsh-inventory',
  'dsh-prompt-inject',
  'dsh-websearch-failover',
  'dsh-lsp-actions',
  'Project-hub/dsh-ctx-guard',
  'Project-hub/dsh-inventory',
  'Project-hub/dsh-gitBash-plugin',
  'Project-hub/dsh-prompt-inject',
  'Project-hub/websearch-dsh-plugin',
]
for (const probe of probes) {
  const hits = text.split(probe).length - 1
  console.log(String(hits).padStart(4), probe)
}
console.log('\nkeys:', Object.keys(snapshot).join(', '))

// tools that should exist if ctx-guard / git-bash / websearch are live
const toolNames = new Set()
const collect = (node) => {
  if (Array.isArray(node)) return node.forEach(collect)
  if (node && typeof node === 'object') {
    if (typeof node.name === 'string' && typeof node.owner === 'string') toolNames.add(node.name)
    for (const value of Object.values(node)) collect(value)
  }
}
collect(snapshot)
const expect = ['bash', 'lsp_diagnostics', 'web_search', 'read', 'write']
for (const name of expect) console.log(toolNames.has(name) ? `ok  tool ${name}` : `??  tool ${name} not found in snapshot`)
