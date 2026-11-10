// ecc-agent-presets — data-only bundle.
//
// This package exists for its cordis.patch.yml (133 collected agent-preset
// rows); it registers nothing itself. The host resolves `main` for every
// bundle, and scripts/check-profile.mjs enforces the same, so the entry is an
// inert marker.
export const name = 'ecc-agent-presets'

export function apply() {
  // inert: all behavior lives in the patch rows
}
