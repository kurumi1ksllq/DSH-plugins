import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const HERE = dirname(fileURLToPath(import.meta.url))
const FLOW_DIR = join(HERE, '..', 'docs', 'specs', '.flow')

/** Enumerations published in FLOW.md; the board treats anything else as "no record". */
const STAGES = ['intake', 'spec', 'dev', 'pr', 'ci', 'review', 'merge', 'done']
const GRADES = ['trivial', 'standard']
const TICKET_STATES = ['todo', 'red', 'green', 'done']
const CI_STATUS = ['green', 'red', 'none', 'unknown']
const REVIEW_STATES = ['not-started', 'running', 'pending-decision', 'done']

const files = readdirSync(FLOW_DIR).filter((name) => name.endsWith('.json'))

test('every flow state file is valid JSON', () => {
  // A malformed file is silently downgraded to 'no record' by the board, so
  // nothing else in the repo would ever catch it.
  for (const name of files) {
    const text = readFileSync(join(FLOW_DIR, name), 'utf8')
    assert.doesNotThrow(() => JSON.parse(text), name + ' must parse as JSON')
  }
})

test('every flow state file stays inside the published enums', () => {
  for (const name of files) {
    const doc = JSON.parse(readFileSync(join(FLOW_DIR, name), 'utf8'))
    assert.ok(GRADES.includes(doc.grade), name + ': grade ' + doc.grade)
    assert.ok(STAGES.includes(doc.stage), name + ': stage ' + doc.stage)
    for (const ticket of doc.tickets ?? []) {
      assert.ok(TICKET_STATES.includes(ticket.state), name + ': ticket ' + ticket.id + ' state ' + ticket.state)
    }
    // Older files predate these sections; absent is fine, out-of-enum is not.
    if (doc.ci?.status !== undefined) assert.ok(CI_STATUS.includes(doc.ci.status), name + ': ci.status ' + doc.ci.status)
    if (doc.review?.state !== undefined) assert.ok(REVIEW_STATES.includes(doc.review.state), name + ': review.state ' + doc.review.state)
    if (doc.merge?.authorized !== undefined) assert.equal(typeof doc.merge.authorized, 'boolean', name + ': merge.authorized must be boolean')
  }
})
