// Optional Chinese-intent lookup for the deep-ptc skill search.
//
// WHY THIS MODULE EXISTS (axis-1 review P1-2): the curated table used to live only
// in dsh-skill-surface's `skill_get`, which deep-ptc hides from every agent that has
// the official loader. So the fallback never ran in the one composition #206 is
// about — measured `deep_ptc_tools({action:'skills', query:'跑测试'})` → {total:0}.
//
// WHY IT IS SEPARATE: keeping it out of tool-compatibility.mjs lets the behaviour be
// tested without pulling the host's schemastery dependency.
//
// WHY IT IS OPTIONAL: deep-ptc does not depend on dsh-skill-surface. A missing
// package must never cost the caller its lexical answer, so every failure is empty.

/**
 * Curated Chinese-intent guesses, re-checked against this call's live catalog.
 * @param query - the user's words.
 * @param entries - live catalog rows, `{ name, description }`.
 * @param baseUrl - module resolution base; normally the profile that owns both bundles.
 * @returns candidate names, possibly empty. Never throws.
 */
export async function intentFallback(query, entries, baseUrl) {
  if (typeof query !== 'string' || query.trim() === '') return []
  if (typeof baseUrl !== 'string' || baseUrl === '') return []
  try {
    // A bare specifier would fail: ESM resolves a dynamic import from THIS module's
    // location, and deep-ptc does not depend on skill-surface. Resolve from the
    // profile that owns both bundles instead — the same place the host loads them.
    const { createRequire } = await import('node:module')
    const { intentCandidates } = await import(createRequire(baseUrl).resolve('dsh-skill-surface/intent-map'))
    if (typeof intentCandidates !== 'function') return []
    // Re-check against THIS call's rows: a stale table row can never name a skill
    // the live catalog does not have.
    return intentCandidates(query, new Set(entries.map(row => row.name)))
  } catch {
    return []
  }
}
