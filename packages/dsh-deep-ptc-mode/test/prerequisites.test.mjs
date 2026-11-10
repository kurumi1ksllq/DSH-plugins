import test from 'node:test'
import assert from 'node:assert/strict'
import { missingModule, skipUnlessModules } from './support/prerequisites.mjs'

// These assertions exist because a probe that ALWAYS reports a reason would
// silently skip suites forever while every gate stays green. Both directions
// are asserted here, so a broken probe fails loudly instead of hiding tests.

test('the probe reports a resolvable module as present', () => {
  assert.equal(missingModule(['node:fs']), undefined)
  assert.equal(skipUnlessModules(['node:fs', 'node:module']), undefined)
})

test('the probe reports an unresolvable module with an actionable reason', () => {
  const missing = 'dsh-surely-not-installed-package'
  assert.equal(missingModule([missing]), missing)
  const reason = skipUnlessModules([missing])
  assert.match(reason, new RegExp(missing))
  assert.match(reason, /pnpm install/)
})
