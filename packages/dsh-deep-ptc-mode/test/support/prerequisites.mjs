// Optional-prerequisite probes for this package's tests.
//
// The client suites need react; the composition suites need js-yaml plus the
// installed Harness declaration. In a bare checkout (no node_modules) those
// cannot resolve, and a red test there is a false alarm that gets blamed on
// whatever the reader happened to change. Skip instead.
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)

/** First specifier that cannot be resolved, or undefined. */
/** Resolvable the way the loader will resolve it: ESM first, then CJS. */
function resolvable(specifier) {
  try {
    import.meta.resolve(specifier)
    return true
  } catch {
    try {
      require.resolve(specifier)
      return true
    } catch {
      return false
    }
  }
}

export function missingModule(specifiers) {
  for (const specifier of specifiers) {
    if (!resolvable(specifier)) return specifier
  }
  return undefined
}

/** Skip reason for a suite, or undefined when every prerequisite resolves. */
export function skipUnlessModules(specifiers) {
  const missing = missingModule(specifiers)
  return missing === undefined ? undefined : missing + ' is not installed in this checkout (run pnpm install)'
}
