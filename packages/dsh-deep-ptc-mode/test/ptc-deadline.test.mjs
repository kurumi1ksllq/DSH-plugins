// issue-236: the single run_code deadline is the ptc-runtime row's config, and a
// foreground tool (ralph) runs its whole loop inside one program. The row is
// declared by @deepseek-ai/dsh-base with NO config, so without this override the
// runtime's loader defaults (120s / 600s) apply and a long batch is cut off.
//
// Read as structure, not as fixed text: a reindented or reflowed patch must stay
// green, while a missing row, a missing key or a smaller ceiling must fail.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { reachabilityText } from '../lib/rules.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const PATCH = readFileSync(join(HERE, '..', 'cordis.patch.yml'), 'utf8');

/** Entries at column 0, each with the lines that belong to it. */
function entries(text) {
  const list = [];
  let current = null;
  for (const line of text.split('\n')) {
    if (line.startsWith('- ')) {
      current = { head: line.slice(2).trim(), body: [] };
      list.push(current);
    } else if (current !== null) {
      current.body.push(line);
    }
  }
  return list;
}

const rowFor = (id) => entries(PATCH).find((entry) => entry.head === 'id: ' + id);

/** The value of one key under the row's `config:` block, as written. */
function configValue(row, key) {
  const configAt = row.body.findIndex((line) => line.trim() === 'config:');
  assert.notEqual(configAt, -1, 'row ' + row.head + ' declares no config block');
  const indent = /^\s*/.exec(row.body[configAt + 1] ?? '')[0].length;
  for (let i = configAt + 1; i < row.body.length; i += 1) {
    const line = row.body[i];
    if (line.trim() === '') continue;
    if (/^\s*/.exec(line)[0].length < indent) break;
    const match = new RegExp('^\\s*' + key + ':\\s*(\\d+)$').exec(line);
    if (match !== null) return Number(match[1]);
  }
  return undefined;
}

test('#236 the bundle raises the ptc-runtime deadline instead of inheriting the 10-minute default', () => {
  const row = rowFor('ptc-runtime');
  assert.ok(row !== undefined, 'the bundle must override the ptc-runtime row');
  const timeoutMs = configValue(row, 'timeoutMs');
  const maxTimeoutMs = configValue(row, 'maxTimeoutMs');
  assert.equal(typeof timeoutMs, 'number', 'the default program budget must be stated');
  assert.equal(typeof maxTimeoutMs, 'number', 'the ceiling must be stated');
  // The host's loader defaults are 120s / 600s. Both must move, or a program that
  // asks for the new ceiling is still clamped to the old one.
  assert.ok(maxTimeoutMs > 600_000, 'the ceiling must exceed the host default of 600s, got ' + maxTimeoutMs);
  assert.ok(timeoutMs <= maxTimeoutMs, 'the default must not exceed the ceiling');
  assert.ok(timeoutMs >= 600_000, 'the default must cover the slowest measured round (577s), got ' + timeoutMs);
});

test('#236 the reachability text warns that one program is bounded and long targets batch', () => {
  const text = reachabilityText({ foregroundSeconds: 30, maxQuestionSeconds: 300, maxPollsPerProgram: 3 });
  assert.match(text, /run_code program has a hard deadline/i);
  assert.match(text, /ralph/i, 'the rule must name the foreground loop it applies to');
  assert.match(text, /batch/i);
  assert.match(text, /round-01\.md/, 'the handoff file naming must be concrete');
  // The number lives in cordis.patch.yml, not in the prompt: two copies would drift.
  assert.doesNotMatch(text, /1800000|1800 s/, 'the prompt must not restate the configured ceiling');
});
