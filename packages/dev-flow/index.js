/**
 * dev-flow — host half.
 *
 * The rules are a prose document (`FLOW.md`). What this module does is make
 * sure the model actually sees the non-negotiable part of them: it registers an
 * always-on runtime-context contribution through the `systemPrompt` service —
 * the same channel `dsh-auto-delegation` uses for its discipline block.
 *
 * Why not a skill: a registered skill is a catalog entry. Measured on
 * 2026-11-10 in the live deployment, the catalog held 270 skills and dev-flow
 * was not among them (the filesystem symlink pointed at a directory that no longer exists),
 * so "改代码先走 dev-flow" depended on a routing decision nobody could verify.
 * A context contribution has no such failure mode: it is in the assembled
 * prompt or the row is not active, and that is visible.
 *
 * The body of the procedure is *not* inlined here. `renderFlowContract` takes
 * the path of the shipped `FLOW.md`, so the always-on text stays short while a
 * single file remains the one source of the details.
 *
 * @module dev-flow
 */

import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { renderFlowContract } from './lib/contract.mjs'

export const name = 'dev-flow'

const PACKAGE_ROOT = dirname(fileURLToPath(import.meta.url))

/** Absolute path of the shipped procedure. */
export const FLOW_DOC = join(PACKAGE_ROOT, 'FLOW.md')

/** Context name; also the address other plugins would use to shadow it. */
export const CONTEXT_NAME = 'dev-flow:flow-contract'

/**
 * Placement: after the command discipline (20000) and the delegation discipline
 * (21000, dsh-auto-delegation). The flow tells the agent *how* to work, which
 * only makes sense once it knows *what it must not do* (discipline) and *who
 * does the work* (delegation).
 */
export const CONTEXT_ORDER = 21050

/**
 * Cordis plugin entry.
 * @param {import('@deepseek-ai/cordis').Context} ctx
 */
export function apply(ctx) {
  if (typeof ctx.inject !== 'function') return
  ctx.inject(['systemPrompt'], (scope) => {
    scope.effect(
      () =>
        scope.systemPrompt.context({
          name: CONTEXT_NAME,
          order: CONTEXT_ORDER,
          text: () => renderFlowContract({ docPath: FLOW_DOC }),
          // Keep it when a caller disables optional runtime context: the flow
          // rules are the point of this plugin, not a nice-to-have.
          required: true,
        }),
      'dev-flow contract context',
    )
  })
}
