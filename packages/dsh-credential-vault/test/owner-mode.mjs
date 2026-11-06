// Shared by the tests that assert credential files are private to their owner.
//
// On POSIX the promise is exact: mode & 0o777 === 0o600. Windows has no POSIX
// permission bits (chmodSync is a no-op, fresh files report 0o666), so there
// the check can only confirm the file exists — the mode half is untestable,
// not optional.
import { statSync } from 'node:fs'

export function assertOwnerOnly(file) {
  const mode = statSync(file).mode & 0o777
  if (process.platform === 'win32') {
    statSync(file)
    return
  }
  if (mode !== 0o600) {
    throw new Error(`expected ${file} to be owner-only (0600), got ${mode.toString(8)}`)
  }
}
