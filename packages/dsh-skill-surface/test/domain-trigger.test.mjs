import { test } from 'node:test'
import assert from 'node:assert/strict'
import { apply } from '../index.js'
import { setHostApi } from '../lib/host-api.mjs'
import { matchDomains } from '../lib/domains.mjs'

const CATALOG = [
  'make-interfaces-feel-better', 'design-system', 'frontend-design-direction', 'accessibility',
  'api-design', 'backend-patterns', 'tdd-workflow', 'test-coverage',
].map((name) => ({ name, description: name + ' description', provider: 'filesystem', invocation: { modelInvocable: true } }))

function stubHost() {
  setHostApi({
    renderSkillContent: (skill) => '<skill_content name="' + skill.name + '">body</skill_content>',
    isModelInvocable: (skill) => skill.invocation.modelInvocable === true,
    createUserMessage: ({ content, source }) => ({ role: 'user', content, source }),
  })
}

function harness({ catalog = CATALOG, officialSkill = true } = {}) {
  const listeners = []
  const scopeFor = {}
  const ctx = {
    inject(_deps, callback) {
      callback({
        effect(factory) { return factory() },
        logger: { warn() {} },
        systemPrompt: { section: () => () => {}, context: () => () => {} },
        on(event, fn) { if (event === 'agent/pre-step') listeners.push(fn); return () => {} },
        skills: { snapshot: () => Promise.resolve({ skills: catalog, complete: true }), get: () => Promise.resolve(undefined) },
        workingDirectory: { ensure: () => Promise.resolve('/work') },
        tools: { get: (name) => (officialSkill && name === 'skill' ? { name: 'skill' } : undefined), register: () => () => {} },
      })
    },
  }
  apply(ctx)
  return { nudge: listeners[1], handoff: listeners[0] }
}

const agent = () => ({ session: { seq: 0, eventAt: () => undefined } })
const userText = (text) => ({ source: { kind: 'user' }, content: [{ type: 'text', text }] })
const next = () => ({ kind: 'enter', messages: [] })
const run = (h, a, text, turn = 1) => h.nudge({ agent: a, messages: [userText(text)], turn, step: 1, signal: undefined }, next)

test('E1: the reported request gets a nudge naming the on-point skill', async () => {
  stubHost()
  const h = harness()
  const decision = await run(h, agent(), '优化一下dsh-inventory 的页面,不是布局,而是ui等细节')
  assert.equal(decision.messages.length, 1)
  const text = decision.messages[0].content[0].text
  assert.match(text, /make-interfaces-feel-better/)
  assert.match(text, /^本轮涉及/)
  assert.ok(text.length <= 120, 'the nudge stays one short line')
})

test('E2: ordinary task messages do not trigger a domain', async () => {
  stubHost()
  const h = harness()
  for (const text of ['跑一下测试', '修个 bug', '把 README 更新一下', '提交并开 PR']) {
    const decision = await run(h, agent(), text)
    assert.equal(decision.messages.length, 0, text)
  }
})

test('E3: at most two nudges across twenty ordinary messages', async () => {
  stubHost()
  const corpus = [
    '跑一下测试', '修个 bug', '更新 README', '开个 PR', '看看这个报错',
    '把依赖升一下', '合并 master', '查一下日志', '这个函数写错了', '加个命令行参数',
    '把注释补全', '重跑 CI', '删掉没用的代码', '看看 git 状态', '改个变量名',
    '把配置挪到单独文件', '这个测试挂了', '为什么构建失败', '检查一下类型', '提交改动',
  ]
  let fired = 0
  for (const text of corpus) {
    const decision = await run(harness(), agent(), text)
    if (decision.messages.length > 0) fired += 1
  }
  assert.ok(fired <= 2, 'noise budget: got ' + fired)
})

test('E4: one turn speaks at most once', async () => {
  stubHost()
  const h = harness()
  const a = agent()
  assert.equal((await run(h, a, '改一下页面样式', 1)).messages.length, 1)
  assert.equal((await run(h, a, '改一下页面样式', 1)).messages.length, 0, 'same turn')
  assert.equal((await run(h, a, '再改一下界面配色', 2)).messages.length, 1, 'next turn speaks again')
})

test('E5: a curated name the catalog does not have is dropped, and nothing is said', async () => {
  stubHost()
  const h = harness({ catalog: [{ name: 'unrelated-skill', description: 'x', provider: 'p', invocation: { modelInvocable: true } }] })
  const decision = await run(h, agent(), '改一下页面样式')
  assert.equal(decision.messages.length, 0)
})

test('E6: an agent without the official loader is pointed at skill_get', async () => {
  stubHost()
  const h = harness({ officialSkill: false })
  const decision = await run(h, agent(), '改一下页面样式')
  assert.equal(decision.messages.length, 1)
  assert.match(decision.messages[0].content[0].text, /skill_get/)
})

test('domain matching needs two distinct signals, not one', () => {
  assert.equal(matchDomains('跑一下测试').length, 0)
  assert.equal(matchDomains('看看测试覆盖率').length, 1)
})

function agentWith(events) {
  return { session: { seq: events.length, eventAt: (index) => events[index] } }
}

const loadedSkillCall = (name) => ({
  type: 'tool/call',
  data: { name: 'skill', arguments: JSON.stringify({ name }) },
})

test('E7: a skill the model loaded through the official tool is not named again', async () => {
  stubHost()
  const h = harness()
  const a = agentWith([loadedSkillCall('design-system'), loadedSkillCall('make-interfaces-feel-better')])
  const decision = await run(h, a, '改一下页面样式', 2)
  assert.equal(decision.messages.length, 0, 'both shortlist names are already in context')
})

test('E8: a relayed delegate prompt is treated as the task statement', async () => {
  stubHost()
  const h = harness()
  const relay = { source: { kind: 'agent-message', form: 'relay' }, content: [{ type: 'text', text: '把弹窗的间距调整一下' }] }
  const decision = await h.nudge({ agent: agent(), messages: [relay], turn: 1, step: 1, signal: undefined }, next)
  assert.equal(decision.messages.length, 1)
})

test('E9: an already-loaded domain does not swallow a different domain in the same turn', async () => {
  stubHost()
  const withDb = [
    ...CATALOG,
    { name: 'database-migrations', description: 'x', provider: 'p', invocation: { modelInvocable: true } },
  ]
  const h = harness({ catalog: withDb })
  const a = agentWith([loadedSkillCall('design-system')])
  const decision = await run(h, a, '界面样式先放一边,看看数据库索引和迁移', 2)
  assert.equal(decision.messages.length, 1)
  assert.match(decision.messages[0].content[0].text, /database-migrations/)
})

test('E10: one nudge names at most three skills', async () => {
  stubHost()
  const h = harness()
  const decision = await run(h, agent(), '改一下页面样式和配色')
  const text = decision.messages[0].content[0].text
  const named = (text.match(/[a-z]+(-[a-z]+)+/g) ?? []).filter((token) => !token.startsWith('skill'))
  assert.ok(named.length <= 3, 'named ' + named.length + ': ' + text)
  assert.ok(text.length <= 120, 'length ' + text.length)
})

test('E11: common Chinese UI phrasings trigger, not just the reported one', async () => {
  stubHost()
  for (const text of ['帮我把弹窗美化一下', '把颜色改深一点', '按钮太挤了', '页面的空行和边距再收一收']) {
    const decision = await run(harness(), agent(), text)
    assert.equal(decision.messages.length, 1, text)
  }
})


const dispatchedLoad = (name) => ({
  type: 'tool/ptc-dispatch',
  data: { name: 'skill', arguments: { name }, isError: false },
})

test('F1: a load recorded through PTC dispatch also suppresses the next nudge', async () => {
  // deep-ptc routes tool calls through tool/ptc-dispatch; reading only tool/call
  // made the nudge repeat skills the model had just loaded (#175).
  stubHost()
  const h = harness()
  const a = agentWith([dispatchedLoad('design-system'), dispatchedLoad('make-interfaces-feel-better')])
  const decision = await run(h, a, '改一下页面样式', 2)
  assert.equal(decision.messages.length, 0, 'dispatch-recorded loads count as loaded')
})

test('F1b: an unrelated dispatch does not count as a load', async () => {
  stubHost()
  const h = harness()
  const a = agentWith([{ type: 'tool/ptc-dispatch', data: { name: 'tool_search', arguments: { query: 'x' } } }])
  const decision = await run(h, a, '改一下页面样式', 2)
  assert.equal(decision.messages.length, 1, 'only loader dispatches suppress')
})

test('F2: a message that already contains the nudge line is not nudged again', async () => {
  stubHost()
  const quoted = '本轮涉及UI/界面细节:用 `skill` 先看 make-interfaces-feel-better,再动手。'
  const decision = await run(harness(), agent(), '子 agent 回报:' + quoted)
  assert.equal(decision.messages.length, 0, 'no echo')
})

