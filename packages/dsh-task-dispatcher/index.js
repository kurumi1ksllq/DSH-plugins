// dsh-task-dispatcher -- host entry.
//
// Injects ONE runtime-context segment via the systemPrompt service (the same
// channel dsh-deep-ptc-mode's governor uses; model-visible text must go
// through systemPrompt.section/context, never through event payloads). The
// segment text carries two headings:
//   1. delegation discipline (lanes: startup questions, lanes, stop line, dedupe,
//      waiting/polling) + the role table (lib/delegation-text.mjs)
// The segment appears for the lead agent and every teammate alike, because
// teammates join the parent's composition via composeFrom.
//
// It also registers two model-facing tools (#194) that delegate to a specialist
// ROLE: role_search finds one, delegate_role starts a child that INHERITS this
// agent's full composition and receives the role's persona as its opening
// message. Naming an agent preset instead would replace the child's whole
// composition, leaving no file tools at all (see the measurement note in
// README.md; #207 removed that path rather than merely discouraging it).
//
// Locale note: fixed to zh (the operator's working language in this
// deployment); the en dictionary in lib/delegation-text.mjs is reserved until
// a host-side locale signal is wired in.

import { renderDelegationText } from './lib/delegation-text.mjs'
import { registerRoleTools } from './lib/role-tools.mjs'

const CONTEXT_NAME = 'dsh:auto-delegation-discipline'
const CONTEXT_ORDER = 21000 // after the exec-discipline block (20000)

export const name = 'dsh-task-dispatcher'

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
  // The role tools need the tool registry; the preset registry and the
  // subagents service are resolved lazily per call, so a composition without
  // them still loads this bundle and reports why the tool cannot run.
  ctx.inject(['tools'], (scope) => {
    registerRoleTools(scope)
  })
}
