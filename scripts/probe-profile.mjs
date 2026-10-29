import fs from 'node:fs'
import path from 'node:path'

const profile = process.argv[2] ?? 'C:/Users/admin/.dsh/profiles/desktop'
const names = [
  '@local/dsh-prompt-inject',
  'dsh-ctx-guard',
  'dsh-inventory',
  'dsh-websearch-failover',
  'dsh-git-bash-tool',
]
for (const n of names) {
  try {
    const dir = fs.realpathSync(path.join(profile, 'node_modules', n))
    const m = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'))
    const patch = m.dsh?.bundle?.patch
    if (patch === undefined) {
      console.log(`META ${n} -> ${dir}`)
      continue
    }
    const ok = fs.existsSync(path.join(dir, patch))
    const rows = ok
      ? fs.readFileSync(path.join(dir, patch), 'utf8').split('\n').filter((l) => /^\s+- id:/.test(l)).map((s) => s.trim())
      : []
    console.log(`${ok ? 'OK  ' : 'BAD '} ${n} -> ${dir.split(path.sep).join('/')} | rows: ${rows.join(' , ') || '(none)'}`)
  } catch (error) {
    console.log(`FAIL ${n}: ${error.message}`)
  }
}
