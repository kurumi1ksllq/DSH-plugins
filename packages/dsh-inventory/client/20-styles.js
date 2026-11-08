    const FONT_MONO = 'ui-monospace, "SF Mono", SFMono-Regular, Consolas, "Cascadia Mono", Menlo, monospace'
    const EASE = 'cubic-bezier(0.32, 0.72, 0, 1)'

    const T = {
      large: { fontSize: '28px', fontWeight: 700, lineHeight: 1.15, letterSpacing: '-0.02em', margin: 0 },
      nav: { fontSize: '17px', fontWeight: 600, letterSpacing: '-0.01em' },
      listTitle: { fontSize: '17px', fontWeight: 600, lineHeight: 1.25, letterSpacing: '-0.01em' },
      rowTitle: { fontSize: '15px', fontWeight: 500, lineHeight: 1.3 },
      caption: { fontSize: '13px', lineHeight: 1.4 },
      captionStrong: { fontSize: '13px', fontWeight: 600 },
      badge: { fontSize: '12px', fontWeight: 500 },
      stat: { fontSize: '20px', fontWeight: 600, fontVariantNumeric: 'tabular-nums', letterSpacing: '-0.01em' },
      mono: { fontFamily: FONT_MONO, fontSize: '12.5px' },
    }

    const S = {
      root: {
        position: 'relative',
        boxSizing: 'border-box',
        width: '100%',
        height: '100%',
        minHeight: 0,
        display: 'flex',
        flexDirection: 'column',
        color: C.text,
        font: 'inherit',
        padding: 0,
      },
      // The scroll host of the rail layout: the sticky nav and the rail stay
      // put while only this column scrolls. Children declare flexShrink: 0 so
      // an expanded section can never be clipped away (issue #33's regression).
      scrollHost: {
        display: 'flex',
        flexDirection: 'column',
        flex: '1 1 auto',
        minWidth: 0,
        minHeight: 0,
        overflowY: 'auto',
      },
      // Translucent chrome: content scrolls under it (Apple "material").
      nav: {
        position: 'sticky',
        top: 0,
        zIndex: 10,
        display: 'flex',
        alignItems: 'center',
        gap: '2px',
        height: '52px',
        padding: '0 8px',
        flexShrink: 0,
        background: 'color-mix(in srgb, var(--dsw-alias-bg-base, #fff) 78%, transparent)',
        backdropFilter: 'blur(20px) saturate(180%)',
        WebkitBackdropFilter: 'blur(20px) saturate(180%)',
        borderBottom: `1px solid ${C.hairline}`,
      },
      navTitle: { ...T.nav, flex: '1 1 auto', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', padding: '0 6px' },
      back: {
        display: 'inline-flex',
        alignItems: 'center',
        gap: '2px',
        height: '40px',
        padding: '0 8px 0 4px',
        border: 'none',
        borderRadius: '10px',
        background: 'transparent',
        color: C.text,
        fontSize: '15px',
        fontWeight: 500,
        cursor: 'pointer',
        flexShrink: 0,
      },
      iconBtn: {
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: '40px',
        height: '40px',
        border: 'none',
        borderRadius: '10px',
        background: 'transparent',
        color: C.text,
        cursor: 'pointer',
        flexShrink: 0,
      },
      page: {
        width: '100%',
        maxWidth: '780px',
        margin: '0 auto',
        padding: '0 24px',
        boxSizing: 'border-box',
        display: 'flex',
        flexDirection: 'column',
        flexShrink: 0,
      },
      hero: { display: 'flex', flexDirection: 'column', gap: '8px', padding: '20px 0 4px', flexShrink: 0 },
      h1: { ...T.large },
      subtitle: { ...T.caption, color: C.secondary, margin: 0, maxWidth: '62ch' },
      controls: { display: 'flex', alignItems: 'center', gap: '12px', padding: '16px 0 0', flexWrap: 'wrap', flexShrink: 0 },
      // Left navigation rail (issue #91). A fixed 196px column beside the main
      // list; groups are caption-styled headers, the active item is the
      // inverted pill (the only selected treatment that survives the accent
      // token inverting between themes).
      rail: {
        display: 'flex',
        flexDirection: 'column',
        gap: '2px',
        width: '196px',
        flexShrink: 0,
        padding: '10px 10px 14px',
        boxSizing: 'border-box',
        borderRight: `1px solid ${C.hairline}`,
        background: C.fill,
      },
      railGroup: { ...T.captionStrong, color: C.secondary, padding: '14px 10px 4px' },
      railItem: {
        display: 'flex',
        alignItems: 'center',
        gap: '8px',
        minHeight: '34px',
        padding: '0 10px',
        border: 'none',
        borderRadius: '8px',
        background: 'transparent',
        color: C.secondary,
        fontSize: '13.5px',
        fontWeight: 500,
        textAlign: 'left',
        cursor: 'pointer',
        flexShrink: 0,
      },
      railItemActive: {
        background: C.invertedFill,
        color: C.invertedText,
        fontWeight: 600,
        boxShadow: '0 1px 3px rgba(0,0,0,0.18)',
      },
      railItemLabel: { flex: '1 1 auto', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', textAlign: 'left' },
      railItemCount: { ...T.caption, fontVariantNumeric: 'tabular-nums', opacity: 0.75, flexShrink: 0 },
      chip: {
        display: 'inline-flex',
        alignItems: 'center',
        height: '32px',
        padding: '0 12px',
        border: 'none',
        borderRadius: '9px',
        background: C.fill,
        color: C.secondary,
        fontSize: '13px',
        fontWeight: 500,
        cursor: 'pointer',
        flexShrink: 0,
        transition: `background-color 200ms ${EASE}, color 200ms ${EASE}`,
      },
      chipOn: { background: C.invertedFill, color: C.invertedText, fontWeight: 600 },
      stamp: { ...T.caption, color: C.secondary, marginLeft: 'auto', fontVariantNumeric: 'tabular-nums' },
      searchWrap: {
        display: 'flex',
        alignItems: 'center',
        gap: '8px',
        height: '36px',
        padding: '0 10px',
        borderRadius: '10px',
        background: C.fill,
        flexShrink: 0,
        marginTop: '10px',
      },
      search: {
        flex: '1 1 auto',
        minWidth: 0,
        height: '100%',
        border: 'none',
        background: 'transparent',
        color: C.text,
        fontSize: '15px',
        outline: 'none',
        padding: 0,
      },
      card: {
        borderRadius: '14px',
        background: C.card,
        border: `1px solid ${C.hairline}`,
        overflow: 'hidden',
        flexShrink: 0,
        boxShadow: '0 1px 2px rgba(0,0,0,0.04)',
      },
      stats: {
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(104px, 1fr))',
        gap: 0,
        flexShrink: 0,
      },
      statCell: { display: 'flex', flexDirection: 'column', gap: '2px', padding: '12px 16px', flexShrink: 0 },
      statLabel: { ...T.caption, color: C.secondary },
      statValue: { ...T.stat },
      sectionHead: {
        display: 'flex',
        alignItems: 'center',
        gap: '8px',
        width: '100%',
        padding: '22px 4px 8px',
        border: 'none',
        background: 'transparent',
        color: 'inherit',
        font: 'inherit',
        textAlign: 'left',
        cursor: 'pointer',
        userSelect: 'none',
        flexShrink: 0,
      },
      sectionTitle: { ...T.captionStrong, color: C.secondary },
      sectionCount: { ...T.caption, color: C.secondary, opacity: 0.75, fontVariantNumeric: 'tabular-nums' },
      sectionHint: { ...T.caption, color: C.secondary, opacity: 0.75, marginLeft: 'auto', paddingRight: '4px', whiteSpace: 'nowrap' },
      // Per-row icon button (hide a skill); swallows the row's own click.
      rowIconBtn: {
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: '26px',
        height: '26px',
        padding: 0,
        border: 'none',
        borderRadius: '7px',
        background: 'transparent',
        color: C.secondary,
        opacity: 0.7,
        cursor: 'pointer',
        flexShrink: 0,
      },
      // 26px control that sits inside a row (provider priority arrows). No fill
      // until hover, so two stacked arrows read as one control column.
      rowCtrlBtn: {
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: '24px',
        height: '24px',
        padding: 0,
        border: `1px solid ${C.hairline}`,
        borderRadius: '7px',
        background: 'transparent',
        color: C.secondary,
        cursor: 'pointer',
        flexShrink: 0,
      },
      rowCtrlBtnDisabled: { opacity: 0.3, cursor: 'default' },
      providerRank: {
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        minWidth: '22px',
        height: '22px',
        padding: '0 6px',
        borderRadius: '999px',
        background: C.fillStrong,
        color: C.secondary,
        ...T.badge,
        fontVariantNumeric: 'tabular-nums',
        flexShrink: 0,
      },
      providerTrack: {
        boxSizing: 'border-box',
        width: '100%',
        height: '4px',
        marginTop: '2px',
        overflow: 'hidden',
        borderRadius: '999px',
        background: C.fill,
        flexShrink: 0,
      },
      providerFill: { height: '100%', borderRadius: '999px', transition: `width 180ms ${EASE}` },
      feedback: { ...T.caption, color: C.secondary },
      chev: { display: 'inline-flex', alignItems: 'center', justifyContent: 'center', color: C.secondary, transition: `transform 200ms ${EASE}`, flexShrink: 0 },
      row: {
        display: 'flex',
        alignItems: 'center',
        gap: '12px',
        minHeight: '44px',
        padding: '10px 16px',
        boxSizing: 'border-box',
        borderBottom: `1px solid ${C.hairline}`,
        flexShrink: 0,
      },
      rowLast: { borderBottom: 'none' },
      rowHidden: { opacity: 0.55 },
      rowMain: { display: 'flex', flexDirection: 'column', gap: '2px', flex: '1 1 auto', minWidth: 0 },
      rowTitle: { ...T.rowTitle, wordBreak: 'break-word' },
      rowTitleMono: { ...T.rowTitle, fontFamily: FONT_MONO, fontSize: '14px', wordBreak: 'break-all' },
      rowSub: { ...T.caption, color: C.secondary, wordBreak: 'break-word' },
      rowMono: { ...T.mono, color: C.secondary, wordBreak: 'break-all' },
      note: {
        ...T.caption,
        color: C.secondary,
        display: '-webkit-box',
        WebkitLineClamp: 2,
        WebkitBoxOrient: 'vertical',
        overflow: 'hidden',
      },
      badge: {
        display: 'inline-flex',
        alignItems: 'center',
        gap: '5px',
        height: '22px',
        padding: '0 8px',
        borderRadius: '999px',
        background: C.fill,
        color: C.text,
        ...T.badge,
        whiteSpace: 'nowrap',
        flexShrink: 0,
      },
      dot: { width: '7px', height: '7px', borderRadius: '999px', flexShrink: 0 },
      lockLabel: { ...T.caption, color: C.secondary, whiteSpace: 'nowrap', flexShrink: 0 },
      // iOS switch: 51×31 track, 27px knob. The knob is always white, so the dark
      // theme no longer paints it with the page colour (a "hole" in the track).
      switchTrack: {
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'flex-start',
        boxSizing: 'border-box',
        width: '51px',
        height: '31px',
        padding: '2px',
        flexShrink: 0,
        marginLeft: 'auto',
        borderRadius: '999px',
        border: 'none',
        background: C.switchOff,
        cursor: 'pointer',
        transition: `background-color 220ms ${EASE}`,
      },
      switchTrackOn: { background: C.accent },
      switchDisabled: { opacity: 0.4, cursor: 'default' },
      switchKnob: {
        display: 'block',
        width: '27px',
        height: '27px',
        borderRadius: '999px',
        background: C.knob,
        boxShadow: '0 2px 4px rgba(0,0,0,0.18), 0 0 0 0.5px rgba(0,0,0,0.04)',
      },
      chevronMuted: { color: C.secondary, opacity: 0.7 },
      listRow: { cursor: 'pointer' },
      subRow: { display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap', minWidth: 0 },
      edgeList: {
        margin: '4px 0 0',
        padding: '8px 10px',
        listStyle: 'none',
        display: 'flex',
        flexDirection: 'column',
        gap: '6px',
        background: C.fill,
        borderRadius: '10px',
        width: '100%',
        boxSizing: 'border-box',
      },
      edge: { display: 'flex', gap: '6px', alignItems: 'center', flexWrap: 'wrap', fontSize: '12.5px' },
      evidence: { ...T.caption, color: C.secondary, wordBreak: 'break-word' },
      warn: {
        display: 'flex',
        gap: '10px',
        padding: '12px 14px',
        borderRadius: '14px',
        background: 'color-mix(in srgb, var(--dsw-static-amber-500, #b7791f) 14%, transparent)',
        color: C.text,
        ...T.caption,
        flexShrink: 0,
      },
      errorBox: {
        display: 'flex',
        alignItems: 'center',
        gap: '10px',
        padding: '12px 14px',
        borderRadius: '14px',
        background: 'color-mix(in srgb, var(--dsw-alias-state-error-primary, #d14343) 12%, transparent)',
        color: C.text,
        ...T.caption,
        flexShrink: 0,
      },
      toast: {
        position: 'sticky',
        bottom: '16px',
        alignSelf: 'center',
        zIndex: 20,
        display: 'flex',
        alignItems: 'center',
        gap: '10px',
        width: 'min(720px, calc(100% - 32px))',
        margin: '16px auto 0',
        padding: '12px 14px',
        borderRadius: '14px',
        background: 'color-mix(in srgb, var(--dsw-alias-state-error-primary, #d14343) 14%, var(--dsw-alias-bg-layer-2, #fff))',
        border: `1px solid ${C.hairline}`,
        boxShadow: '0 8px 24px rgba(0,0,0,0.18)',
        color: C.text,
        ...T.caption,
        flexShrink: 0,
      },
      toastBtn: {
        border: 'none',
        borderRadius: '8px',
        background: C.fillStrong,
        color: C.text,
        fontSize: '13px',
        fontWeight: 600,
        padding: '6px 12px',
        cursor: 'pointer',
        flexShrink: 0,
      },
      primary: {
        border: 'none',
        borderRadius: '10px',
        background: C.invertedFill,
        color: C.invertedText,
        fontSize: '13px',
        fontWeight: 600,
        padding: '8px 16px',
        cursor: 'pointer',
        flexShrink: 0,
      },
      skeleton: { height: '14px', borderRadius: '6px', background: C.fill, flexShrink: 0 },
      // Quiet one-line note for "written to cordis.patch.yml, applies next start".
      notice: {
        display: 'flex',
        alignItems: 'center',
        gap: '6px',
        alignSelf: 'center',
        margin: '10px auto 0',
        padding: '6px 12px',
        borderRadius: '999px',
        background: C.fill,
        color: C.secondary,
        ...T.caption,
        flexShrink: 0,
      },
      empty: { ...T.caption, color: C.secondary, padding: '14px 16px' },
      // Small text button for row-level actions (vault moves); no fill, so it
      // reads as a link next to the row title instead of a second control.
      linkBtn: {
        border: 'none',
        background: 'transparent',
        color: C.accent,
        fontSize: '13px',
        fontWeight: 600,
        padding: '4px 6px',
        borderRadius: '8px',
        cursor: 'pointer',
        flexShrink: 0,
        whiteSpace: 'nowrap',
      },
      linkBtnDisabled: { opacity: 0.4, cursor: 'default' },
      rowActions: { display: 'flex', alignItems: 'center', justifyContent: 'flex-end', padding: '6px 16px 2px', flexShrink: 0 },
      // Header that folds a block of rows away: a divider, not a box.
      foldHeader: {
        display: 'flex',
        alignItems: 'center',
        gap: '6px',
        width: '100%',
        padding: '10px 16px 6px',
        border: 'none',
        borderTop: `1px solid ${C.hairline}`,
        background: 'transparent',
        color: 'inherit',
        font: 'inherit',
        textAlign: 'left',
        cursor: 'pointer',
        userSelect: 'none',
        flexShrink: 0,
      },
      foldHeaderEmpty: { cursor: 'default', opacity: 0.6 },
      spinner: {
        width: '16px',
        height: '16px',
        borderRadius: '999px',
        border: `2px solid ${C.fillStrong}`,
        borderTopColor: C.accent,
        flexShrink: 0,
      },
      groupDir: { ...T.mono, color: C.secondary, wordBreak: 'break-all' },
    }

    /**
     * Pseudo-states and motion. Inline styles cannot express :hover,
     * :focus-visible or a media query, so the panel ships one stylesheet.
     */
    const STYLES = `
.inv-row { -webkit-tap-highlight-color: transparent; }
.inv-row[data-interactive="true"] { transition: background-color 120ms ease; }
@media (hover: hover) {
  .inv-row[data-interactive="true"]:hover { background: color-mix(in srgb, var(--dsw-alias-label-secondary, #6b7280) 8%, transparent); }
}
.inv-row[data-interactive="true"]:active { background: color-mix(in srgb, var(--dsw-alias-label-secondary, #6b7280) 14%, transparent); }
.inv-switch:active > span { transform: scale(0.94); }
@media (hover: hover) {
  .inv-hide:hover { color: var(--dsw-alias-label-primary, #111827); opacity: 1; }
}
.inv-switch, .inv-btn, .inv-seg-btn, .inv-rail-item, .inv-row { outline: none; }
.inv-switch:focus-visible, .inv-btn:focus-visible, .inv-seg-btn:focus-visible, .inv-rail-item:focus-visible, .inv-row[data-interactive="true"]:focus-visible {
  outline: 3px solid color-mix(in srgb, var(--dsw-alias-button-info-fill, #4176e6) 45%, transparent);
  outline-offset: 2px;
  border-radius: 10px;
}
.inv-search-wrap { transition: background-color 160ms ease, box-shadow 160ms ease; }
.inv-search-wrap:focus-within {
  background: var(--dsw-alias-bg-layer-2, #fff);
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--dsw-alias-button-info-fill, #4176e6) 35%, transparent);
}
.inv-rail-item { transition: background-color 200ms ${EASE}, color 200ms ${EASE}; }
@media (hover: hover) {
  .inv-rail-item:not(.inv-rail-active):hover { background: color-mix(in srgb, var(--dsw-alias-label-secondary, #6b7280) 10%, transparent); }
}
.inv-section-body { animation: inv-section-in 200ms ${EASE}; }
@keyframes inv-section-in { from { opacity: 0; transform: translateY(-4px); } to { opacity: 1; transform: none; } }
.inv-spin { animation: inv-spin 720ms linear infinite; }
@keyframes inv-spin { to { transform: rotate(360deg); } }
@media (prefers-reduced-motion: reduce) {
  .inv-row, .inv-switch, .inv-switch > span, .inv-seg-btn, .inv-rail-item, .inv-search-wrap { transition-duration: 0ms !important; }
  .inv-section-body { animation: none; }
  .inv-spin { animation-duration: 1.6s; }
}
@media (prefers-reduced-transparency: reduce) {
  .inv-nav { background: var(--dsw-alias-bg-base, #fff) !important; backdrop-filter: none !important; -webkit-backdrop-filter: none !important; }
}
@media (prefers-contrast: more) {
  .inv-card { border-color: currentColor !important; }
}
`

    function installStyles() {
      if (typeof document === 'undefined' || document === null) return () => {}
      const existing = document.querySelector('style[data-dsh-inventory]')
      if (existing !== null) return () => {}
      const node = document.createElement('style')
      node.setAttribute('data-dsh-inventory', '')
      node.textContent = STYLES
      document.head.appendChild(node)
      return () => {
        if (node.parentNode !== null) node.parentNode.removeChild(node)
      }
    }

