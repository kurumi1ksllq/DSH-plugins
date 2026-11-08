/**
 * dsh-inventory — browser half.
 *
 * Adds a left-sidebar entry (id `inventory`) with a full-height main panel.
 * Reads `GET /inventory/snapshot` from the host half and renders five read-only
 * views plus a per-workspace view that assigns or removes an MCP server / skill.
 *
 * Visual language: Apple grouped lists — one large title, grouped inset cards,
 * 44px rows separated by hairlines, a segmented control, iOS switches, and a
 * translucent sticky toolbar. Base styling is inline (the offline preview
 * renders inline styles only); pseudo-states and motion live in `STYLES`, which
 * is injected once so :hover / :focus-visible / reduced-motion exist at all.
 */
