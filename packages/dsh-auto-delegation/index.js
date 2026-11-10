// dsh-auto-delegation — host entry.
//
// Injects two runtime-context segments via the systemPrompt service (the same
// channel dsh-deep-ptc-mode's governor uses; model-visible text must go
// through systemPrompt.section/context, never through event payloads):
//   1. delegation discipline + declarative routing table (lib/delegation-text.mjs)
// The segments appear for the lead agent and every teammate alike, because
// teammates join the parent's composition via composeFrom.

const CONTEXT_NAME = 'dsh:auto-delegation-discipline'
const CONTEXT_ORDER = 21000 // after the exec-discipline block (20000)

export const name = 'dsh-auto-delegation'

// No exported Config: the patch row carries none, and a config on a row
// without a Config schema fails validation at load.
export function apply(ctx) {
  const locale = 'zh' // operator's working language in this deployment
  if (typeof ctx.inject !== 'function') return
  ctx.inject(['systemPrompt'], (scope) => {
    scope.effect(
      () =>
        scope.systemPrompt.context({
          name: CONTEXT_NAME,
          order: CONTEXT_ORDER,
          text: () => renderText(locale),
        }),
      'auto-delegation discipline context',
    )
  })
}

function renderText(locale) {
  return renderDelegationText(locale)
}

import { renderDelegationText } from './lib/delegation-text.mjs'
