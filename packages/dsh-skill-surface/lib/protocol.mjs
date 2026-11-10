// Skill-surface protocol copy, zh/en same-structure dictionaries.
//
// This text is CONSTANT on purpose: it is a systemPrompt section, evaluated on
// every request, and stable text keeps the prompt cache warm. It names no tool
// of its own — the agents that need it may have neither todo_write nor read —
// so it only states the handoff format and what to do without a catalog.

const COPY = {
  zh: {
    heading: '## 技能点名(委派时用)',
    bullets: [
      '派活给子 agent 或队友时,如果你已经知道这次该用哪几个技能,在任务说明里单独起一行写 `skills: a, b`(只认第一处,最多 6 个,kebab-case)。对方开工时直接拿到这些技能正文,不用自己找。',
      '不确定用哪个就留空:对方会先看自己会话里的技能清单再决定,没人会因为你没写而报错。',
      '只写你确实见过的技能名:清单里出现过的,或你已经加载过的。写错的名字会被静默忽略,不会中断任务。',
      '清单只是索引:正文才是指令。拿到正文后按正文执行,不要照着清单里的一句话干活。',
      '委派说明里只写技能名,不要粘技能正文——正文由注入提供,粘一遍会让父子两处重复占位。',
    ],
    footer: '这条规则对派活的一方生效;接活的一方不需要回复确认。',
  },
  en: {
    heading: '## Skill handoff (use it when delegating)',
    bullets: [
      'When you delegate to a subagent or teammate and you already know which skills the work needs, put `skills: a, b` on the first line of the task (at most 6, kebab-case). The child receives those skill bodies on arrival instead of hunting for them.',
      'When unsure, leave it empty: the child checks its own session catalog first and decides for itself. Omitting the line is never an error.',
      'Name only skills you have actually seen: one from the catalog, or one you already loaded. Misspelled names are ignored silently and never fail the task.',
      'The catalog is an index, the body is the instruction. Follow the body once it arrives; never act on the one-line catalog summary alone.',
      'Put names only, never skill bodies: the injection already carries the body, and pasting it duplicates the same text in both contexts.',
    ],
    footer: 'This rule binds the delegating side; the receiving side does not need to acknowledge it.',
  },
}

export function renderProtocol(locale) {
  const copy = COPY[locale] ?? COPY.zh
  return [copy.heading, '', ...copy.bullets.map((line) => `- ` + line), '', copy.footer].join('\n')
}
