// #103/T1.web: refresh 的 read-modify-write 互斥队列。
// 两个并发 refresh 在 probeBalance 的 await 上交错时,后写的会覆盖先写的余额;
// 互斥队列让每个 refresh 的 RMW 段不可分割。
import assert from 'node:assert/strict'
import { createMutex } from '../lib/runtime.mjs'

let pass = 0
function ok(name, fn) {
  return Promise.resolve(fn()).then(() => {
    pass += 1
    console.log(`PASS ${name}`)
  })
}

const tests = [
  ok('createMutex serializes overlapping runs', async () => {
    const mutex = createMutex()
    const order = []
    let releaseFirst
    const first = mutex.run(async () => {
      order.push('first-start')
      await new Promise((resolve) => { releaseFirst = resolve })
      order.push('first-end')
    })
    const second = mutex.run(async () => {
      order.push('second-start')
      order.push('second-end')
    })
    await new Promise((resolve) => setImmediate(resolve))
    releaseFirst()
    await Promise.all([first, second])
    assert.deepEqual(order, ['first-start', 'first-end', 'second-start', 'second-end'],
      'second run must not start until the first finishes')
  }),

  ok('a failing run must not poison the queue', async () => {
    const mutex = createMutex()
    await assert.rejects(mutex.run(async () => { throw new Error('boom') }), /boom/)
    const after = await mutex.run(async () => 'ok')
    assert.equal(after, 'ok')
  }),
]

const results = await Promise.allSettled(tests)
for (const r of results) if (r.status === 'rejected') { console.error(r.reason); process.exit(1) }
console.log(`mutex tests: ${pass}/${tests.length} passed`)
if (pass !== tests.length) process.exit(1)
