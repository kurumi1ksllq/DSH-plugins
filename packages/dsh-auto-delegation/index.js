// dsh-auto-delegation — host entry.
//
// Injects ONE runtime-context segment via the systemPrompt service (the same
// channel dsh-deep-ptc-mode's governor uses; model-visible text must go
// through systemPrompt.section/context, never through event payloads). The
// segment text carries two sections:
//   1. delegation discipline + declarative routing table (lib/delegation-text.mjs)
// The segment appears for the lead agent and every teammate alike, because
// teammates join the parent's composition via composeFrom.
//
// Locale note: fixed to zh (the operator's working language in this
// deployment); the en dictionary in lib/delegation-text.mjs is reserved until
// a host-side locale signal is wired in.

import { renderDelegationText } from './lib/delegation-text.mjs'

const CONTEXT_NAME = 'dsh:auto-delegation-discipline'
const CONTEXT_ORDER = 21000 // after the exec-discipline block (20000)

export const name = 'dsh-auto-delegation'

// No exported Config: the patch row carries none, and a config on a row
// without a Config schema fails validation at load.
export function apply(ctx) {
  if (typeof ctx.inject !== 'function') return
  ctx.inject(['systemPrompt'], (scope) => {
    scope.effect(
      () =>
        scope.systemPrompt.context({
          name: CONTEXT_NAME,
          order: CONTEXT_ORDER,
          text: () => renderDelegationText('zh'),
        }),
      'auto-delegation discipline context',
    )
  })
}
