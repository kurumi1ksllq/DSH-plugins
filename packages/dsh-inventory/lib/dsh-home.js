/**
 * Single source of truth for `$DSH_HOME`.
 *
 * The codebase previously resolved the DSH home directory in several places
 * with slightly different env fallbacks (`DSH_HOME ?? homedir()`,
 * `DSH_HOME ?? HOME ?? USERPROFILE`, …). Every consumer now imports this one
 * helper: `process.env.DSH_HOME` when set, otherwise the OS home plus `.dsh`.
 */
import { homedir } from 'node:os'
import { join } from 'node:path'

/**
 * Resolve the DSH home directory.
 * @param {{DSH_HOME?: string, HOME?: string, USERPROFILE?: string}} [env] injectable for tests.
 * @returns {string} absolute path of the DSH home.
 */
export function dshHome(env = process.env) {
  const explicit = env.DSH_HOME
  if (typeof explicit === 'string' && explicit.length > 0) return explicit
  const home = env.HOME ?? env.USERPROFILE ?? homedir()
  return join(home, '.dsh')
}
