/**
 * `/handoff` — condense the current session log into a document plus a
 * paste-ready continuation prompt. No model call, no session creation.
 */
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

const textOf = (content) =>
  (Array.isArray(content) ? content : [])
    .map((block) => (typeof block?.text === 'string' ? block.text : ''))
    .join('')
    .trim()

const parseArgs = (raw) => {
  if (typeof raw !== 'string') return undefined
  try {
    return JSON.parse(raw)
  } catch {
    return undefined
  }
}

const clip = (text, max) => (text.length > max ? `${text.slice(0, max)}…` : text)

/** Collect the four handoff sections from the session log. */
function collect(events, session, tokens) {
  const users = events.filter((event) => event.type === 'user/message' && event.data?.source?.kind === 'user')
  const assistant = events.filter((event) => event.type === 'assistant/message')
  const calls = events.filter((event) => event.type === 'tool/call')
  const edited = new Set(
    calls
      .filter((event) => event.data?.name === 'write' || event.data?.name === 'edit')
      .map((event) => parseArgs(event.data.arguments)?.file_path)
      .filter((path) => typeof path === 'string'),
  )
  const todoCall = [...calls].reverse().find((event) => event.data?.name === 'todo_write')
  const todos = parseArgs(todoCall?.data?.arguments)?.todos
  const titles = events.filter((event) => event.type === 'session/title')

  return {
    id: session.id,
    cwd: session.header?.cwd ?? process.cwd(),
    tokens,
    title: titles.at(-1)?.data?.title,
    goal: users[0] === undefined ? '' : clip(textOf(users[0].data.content), 800),
    recentUsers: users.slice(-5).map((event) => clip(textOf(event.data.content), 200)),
    recentAssistant: assistant.slice(-2).map((event) => clip(textOf(event.data.message?.content), 400)),
    files: [...edited],
    todos: Array.isArray(todos) ? todos : [],
    todoRaw: todos === undefined && todoCall !== undefined ? clip(String(todoCall.data.arguments ?? ''), 1200) : undefined,
  }
}

function render(doc, titleHint) {
  return [
    `# HANDOFF — ${doc.title ?? titleHint ?? 'handoff'}`,
    '',
    `- 会话: ${doc.id}`,
    `- 生成时间: ${new Date().toISOString()}`,
    `- 来源上下文: ~${doc.tokens} tokens`,
    `- 工作目录: ${doc.cwd}`,
    '',
    '## 目标',
    doc.goal || '(首条用户消息不在本会话日志里)',
    '',
    '## 最近进展',
    ...doc.recentUsers.map((text) => `- 用户: ${text.replace(/\s+/gu, ' ')}`),
    ...doc.recentAssistant.map((text) => `- 助手: ${text.replace(/\s+/gu, ' ')}`),
    '',
    '## 改动文件',
    ...(doc.files.length === 0 ? ['- (无)'] : doc.files.slice(-40).map((path) => `- ${path}`)),
    ...(doc.files.length > 40 ? [`- …共 ${doc.files.length} 个，只列最后 40 个`] : []),
    '',
    '## 未完成',
    ...(doc.todos.length > 0
      ? doc.todos.map((todo) => `- [${todo?.status === 'completed' ? 'x' : ' '}] ${todo?.content ?? ''}`)
      : [doc.todoRaw ?? '(没有 todo_write 记录)']),
    '',
  ].join('\n')
}

export async function handoff(ctx, invocation, titleHint) {
  const session = invocation.agent.session
  let tokens = 0
  try {
    tokens = ctx.tokenMeter.measure(session).totalTokens
  } catch {
    tokens = 0
  }
  const doc = collect(session.snapshotEvents(), session, tokens)
  const dir = join(doc.cwd, '.dsh', 'handoff')
  const path = join(dir, `HANDOFF-${new Date().toISOString().replace(/[:.]/gu, '-')}.md`)
  try {
    await mkdir(dir, { recursive: true })
    await writeFile(path, render(doc, titleHint), 'utf8')
  } catch (error) {
    return { kind: 'error', text: `handoff 写入失败: ${error instanceof Error ? error.message : String(error)}` }
  }
  return {
    kind: 'success',
    text: [
      `交接文档: ${path}`,
      `来源上下文: ~${tokens} tokens；改动文件 ${doc.files.length} 个；待办 ${doc.todos.length} 条`,
      '',
      '新会话直接粘贴：',
      `> 先读 ${path}，按「目标/未完成」继续；改动前先 git diff 确认现状。`,
    ].join('\n'),
  }
}
