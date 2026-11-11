    const FONT_MONO = 'ui-monospace, "SF Mono", SFMono-Regular, Consolas, "Cascadia Mono", Menlo, monospace'
    const EASE = 'cubic-bezier(0.32, 0.72, 0, 1)'

    const T = {
      large: { fontSize: '28px', fontWeight: 700, lineHeight: 1.15, letterSpacing: '-0.02em', margin: 0, textWrap: 'balance' },
      nav: { fontSize: '17px', fontWeight: 600, letterSpacing: '-0.01em' },
      listTitle: { fontSize: '17px', fontWeight: 600, lineHeight: 1.25, letterSpacing: '-0.01em', textWrap: 'pretty' },
      rowTitle: { fontSize: '15px', fontWeight: 500, lineHeight: 1.35, letterSpacing: '-0.003em' },
      caption: { fontSize: '13px', lineHeight: 1.4 },
      captionStrong: { fontSize: '13px', fontWeight: 600 },
      badge: { fontSize: '12px', fontWeight: 500, lineHeight: 1.2, fontVariantNumeric: 'tabular-nums' },
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
        // The host does not guarantee antialiased text; ask for it here so glyphs
        // stay crisp without touching the global html element.
        WebkitFontSmoothing: 'antialiased',
        MozOsxFontSmoothing: 'grayscale',
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
      subtitle: { ...T.caption, color: C.secondary, margin: 0, maxWidth: '62ch', lineHeight: 1.5, textWrap: 'pretty' },
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
      railItemCount: { ...T.caption, fontVariantNumeric: 'tabular-nums', flexShrink: 0 },
      // Size and typography only: background, colour and the on-state live in
      // .inv-chip / .inv-chip-on, because an inline background would outrank the
      // :hover rule and leave the control with no feedback at all.
      chip: {
        display: 'inline-flex',
        alignItems: 'center',
        height: '32px',
        padding: '0 12px',
        boxSizing: 'border-box',
        borderRadius: '10px',
        fontSize: '13px',
        fontWeight: 500,
        cursor: 'pointer',
        flexShrink: 0,
        minWidth: 0,
      },
      chipOn: { fontWeight: 600 },
      stamp: { ...T.caption, color: C.secondary, marginLeft: 'auto', fontVariantNumeric: 'tabular-nums' },
      searchWrap: {
        display: 'flex',
        alignItems: 'center',
        gap: '8px',
        height: '36px',
        padding: '0 10px',
        borderRadius: '10px',
        border: '1px solid transparent',
        boxSizing: 'border-box',
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
        caretColor: C.accent,
        padding: 0,
      },
      card: {
        borderRadius: '14px',
        background: C.card,
        border: `1px solid ${C.hairline}`,
        overflow: 'hidden',
        flexShrink: 0,
        // Label-tinted shadows instead of pure black: black vanishes on the dark
        // theme and looks dirty on the light one.
        boxShadow: '0 1px 2px color-mix(in srgb, var(--dsw-alias-label-primary, #1f2328) 8%, transparent), 0 12px 28px color-mix(in srgb, var(--dsw-alias-label-primary, #1f2328) 10%, transparent)',
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
        color: 'inherit',
        font: 'inherit',
        textAlign: 'left',
        cursor: 'pointer',
        userSelect: 'none',
        flexShrink: 0,
      },
      sectionTitle: { ...T.captionStrong, color: C.text },
      sectionCount: { ...T.caption, color: C.secondary, fontVariantNumeric: 'tabular-nums' },
      sectionHint: { ...T.caption, color: C.secondary, marginLeft: 'auto', paddingRight: '4px', whiteSpace: 'nowrap' },
      // Per-row icon button (hide a skill); swallows the row's own click.
      rowIconBtn: {
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: '26px',
        height: '26px',
        padding: 0,
        border: 'none',
        borderRadius: '8px',
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
        borderRadius: '8px',
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
      // Dimming the whole row also dims its switch, which then reads as disabled
      // while it is still operable. Only the text column steps back.
      rowTextHidden: { opacity: 0.55 },
      rowMain: { display: 'flex', flexDirection: 'column', gap: '2px', flex: '1 1 auto', minWidth: 0 },
      rowTitle: { ...T.rowTitle, wordBreak: 'break-word', textWrap: 'pretty' },
      rowTitleMono: { ...T.rowTitle, fontFamily: FONT_MONO, fontSize: '14px', wordBreak: 'break-all' },
      rowSub: { ...T.caption, color: C.secondary, wordBreak: 'break-word', textWrap: 'pretty' },
      rowMono: { ...T.mono, color: C.secondary, wordBreak: 'break-all' },
      note: {
        ...T.caption,
        color: C.secondary,
        display: '-webkit-box',
        WebkitLineClamp: 2,
        WebkitBoxOrient: 'vertical',
        overflow: 'hidden',
        textWrap: 'pretty',
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
        boxShadow: 'inset 0 0 0 1px rgba(0,0,0,0.08)',
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
        boxShadow: '0 1px 2px rgba(0,0,0,0.2), 0 3px 8px rgba(0,0,0,0.12), 0 0 0 0.5px rgba(0,0,0,0.04)',
      },
      chevronMuted: { color: C.secondary },
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
        border: '1px solid color-mix(in srgb, var(--dsw-static-amber-500, #b7791f) 26%, transparent)',
        background: 'color-mix(in srgb, var(--dsw-static-amber-500, #b7791f) 12%, var(--dsw-alias-bg-layer-2, #fff))',
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
        border: '1px solid color-mix(in srgb, var(--dsw-alias-state-error-primary, #d14343) 24%, transparent)',
        background: 'color-mix(in srgb, var(--dsw-alias-state-error-primary, #d14343) 10%, var(--dsw-alias-bg-layer-2, #fff))',
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
        boxShadow: '0 2px 6px color-mix(in srgb, var(--dsw-alias-label-primary, #1f2328) 12%, transparent), 0 14px 36px color-mix(in srgb, var(--dsw-alias-label-primary, #1f2328) 14%, transparent)',
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
        border: '1px solid transparent',
        boxSizing: 'border-box',
        borderRadius: '10px',
        fontSize: '13px',
        fontWeight: 600,
        padding: '8px 16px',
        minHeight: '32px',
        cursor: 'pointer',
        flexShrink: 0,
      },
      // Fill + shimmer live in .inv-skeleton: an inline background would outrank
      // the keyframes that move it.
      skeleton: { height: '14px', borderRadius: '8px', flexShrink: 0 },
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
        display: 'inline-flex',
        alignItems: 'center',
        minHeight: '26px',
        borderRadius: '8px',
        fontSize: '13px',
        fontWeight: 600,
        padding: '4px 8px',
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
        border: `2px solid color-mix(in srgb, var(--dsw-alias-label-secondary, #6b7280) 26%, transparent)`,
        borderTopColor: C.accent,
        flexShrink: 0,
      },
      groupDir: { ...T.mono, color: C.secondary, wordBreak: 'break-all' },
    }

    /**
     * Pseudo-states and motion. Inline styles cannot express :hover,
     * :focus-visible or a media query, so the panel ships one stylesheet.
     */
    const STYLES = `/* Rows ------------------------------------------------------------------
   Tap targets are >=44px tall via S.row. Hover is guarded by (hover: hover)
   so a touch screen never leaves a row stuck in its hover colour. */
.inv-row { -webkit-tap-highlight-color: transparent; }
.inv-row[data-interactive="true"] { transition: background-color 120ms ease; }
@media (hover: hover) {
  .inv-row[data-interactive="true"]:hover { background: color-mix(in srgb, var(--dsw-alias-label-secondary, #6b7280) 8%, transparent); }
}
.inv-row[data-interactive="true"]:active { background: color-mix(in srgb, var(--dsw-alias-label-secondary, #6b7280) 14%, transparent); }
/* Rows live inside a card with overflow: hidden, so their ring is drawn
   inside the row instead of 5px outside it, where the card would clip it
   (WCAG 2.2 SC 2.4.11 Focus Not Obscured). */
.inv-row[data-interactive="true"]:focus-visible { outline: 2px solid var(--dsw-alias-button-info-fill, #4176e6); outline-offset: -3px; }

/* Buttons ---------------------------------------------------------------
   Inline styles cannot express :hover / :active, so every control carries a
   class hook and the states live here. The press scale is deliberately small:
   it must read as touch feedback, not as movement. */
.inv-btn, .inv-seg-btn, .inv-chip, .inv-primary, .inv-link, .inv-ctrl,
.inv-switch, .inv-rail-item, .inv-row, .inv-search, .inv-textarea { outline: none; }
.inv-btn, .inv-seg-btn { background: transparent; }
.inv-chip {
  background: color-mix(in srgb, var(--dsw-alias-label-secondary, #6b7280) 12%, transparent);
  border: 1px solid var(--dsw-alias-border-l2, rgba(0,0,0,0.12));
  color: var(--dsw-alias-label-primary, #1f2328);
}
.inv-chip-on {
  background: var(--dsw-alias-label-primary, #1f2328);
  border-color: var(--dsw-alias-label-primary, #1f2328);
  color: var(--dsw-alias-bg-base, #fff);
  font-weight: 600;
}
.inv-primary { background: var(--dsw-alias-label-primary, #1f2328); color: var(--dsw-alias-bg-base, #fff); }
.inv-link { background: transparent; color: var(--dsw-alias-button-info-fill, #4176e6); }
.inv-ctrl { background: transparent; color: var(--dsw-alias-label-secondary, #6b7280); border: 1px solid var(--dsw-alias-border-l2, rgba(0,0,0,0.12)); }
.inv-hide { color: var(--dsw-alias-label-secondary, #6b7280); opacity: 0.7; }
/* Bigger hit areas than the visible boxes (WCAG 2.5.8 wants 24px minimum and
   a thumb wants more); the ink does not move. */
.inv-switch, .inv-hide { position: relative; }
.inv-switch::after { content: ''; position: absolute; inset: -6px; }
.inv-hide::after { content: ''; position: absolute; inset: -7px; }
.inv-chip, .inv-primary, .inv-link, .inv-ctrl, .inv-hide {
  transition-property: background-color, border-color, color, opacity, filter, transform;
  transition-duration: 140ms;
  transition-timing-function: ease-out;
}
@media (hover: hover) {
  .inv-btn:not(.inv-chip):not(.inv-primary):not(.inv-link):not(.inv-ctrl):hover { background: color-mix(in srgb, var(--dsw-alias-label-secondary, #6b7280) 8%, transparent); }
  .inv-chip:not(.inv-chip-on):hover {
    background: color-mix(in srgb, var(--dsw-alias-label-secondary, #6b7280) 18%, transparent);
    border-color: color-mix(in srgb, var(--dsw-alias-label-secondary, #6b7280) 45%, transparent);
  }
  .inv-chip-on:hover { filter: brightness(0.96); }
  .inv-primary:hover { filter: brightness(1.06); }
  .inv-link:hover { background: color-mix(in srgb, var(--dsw-alias-label-secondary, #6b7280) 10%, transparent); }
  .inv-ctrl:hover {
    background: color-mix(in srgb, var(--dsw-alias-label-secondary, #6b7280) 12%, transparent);
    border-color: color-mix(in srgb, var(--dsw-alias-label-secondary, #6b7280) 30%, transparent);
  }
  .inv-hide:hover { color: var(--dsw-alias-label-primary, #111827); opacity: 1; }
}
.inv-btn:not(.inv-chip):not(.inv-primary):not(.inv-link):not(.inv-ctrl):active { background: color-mix(in srgb, var(--dsw-alias-label-secondary, #6b7280) 14%, transparent); }
.inv-chip:active:enabled, .inv-primary:active:enabled,
.inv-link:active:enabled, .inv-ctrl:active:enabled { transform: scale(0.96); }
.inv-btn:disabled, .inv-chip:disabled, .inv-primary:disabled,
.inv-link:disabled, .inv-ctrl:disabled,
.inv-switch:disabled { transform: none; cursor: default; opacity: 0.5; }
/* The knob travel lives in a custom property so the press scale can stack on
   top of it instead of fighting the inline transform. */
.inv-switch > span { transform: translateX(var(--inv-x, 0px)); transition: transform 260ms ${EASE}; }
.inv-switch:active:enabled > span { transform: translateX(var(--inv-x, 0px)) scale(0.94); }

/* Focus rings -----------------------------------------------------------
   The ring follows each control's own shape (999px pill, 8px rail item, 10px
   button) because it decorates the element instead of redrawing the box
   (WCAG 2.2 SC 2.4.13 Focus Appearance). */
.inv-btn:focus-visible, .inv-seg-btn:focus-visible, .inv-chip:focus-visible,
.inv-primary:focus-visible, .inv-link:focus-visible, .inv-ctrl:focus-visible,
.inv-rail-item:focus-visible, .inv-switch:focus-visible,
.inv-search:focus-visible, .inv-textarea:focus-visible {
  outline: 2px solid var(--dsw-alias-button-info-fill, #4176e6);
  outline-offset: 2px;
}
.inv-search:focus-visible { outline-offset: 0; }

/* Search ---------------------------------------------------------------- */
.inv-search-wrap {
  background: color-mix(in srgb, var(--dsw-alias-label-secondary, #6b7280) 12%, transparent);
  transition: background-color 160ms ease, box-shadow 160ms ease;
}
.inv-search-wrap:focus-within {
  background: var(--dsw-alias-bg-layer-2, #fff);
  box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--dsw-alias-button-info-fill, #4176e6) 40%, transparent);
}
.inv-search::placeholder { color: color-mix(in srgb, var(--dsw-alias-label-secondary, #6b7280) 78%, transparent); }

/* Multiline editor (prompt) --------------------------------------------- */
.inv-textarea { caret-color: var(--dsw-alias-button-info-fill, #4176e6); transition: border-color 160ms ease, box-shadow 160ms ease; }
.inv-textarea::placeholder { color: color-mix(in srgb, var(--dsw-alias-label-secondary, #6b7280) 78%, transparent); }
.inv-textarea:disabled { opacity: 0.6; }

/* Left rail ------------------------------------------------------------- */
.inv-rail-item { transition: background-color 200ms ${EASE}, color 200ms ${EASE}; }
@media (hover: hover) {
  .inv-rail-item:not(.inv-rail-active):hover { background: color-mix(in srgb, var(--dsw-alias-label-secondary, #6b7280) 10%, transparent); }
}

/* Section entrance + fold chevron --------------------------------------- */
.inv-section-body { animation: inv-section-in 200ms ${EASE}; }
@keyframes inv-section-in { from { opacity: 0; transform: translateY(-4px); } to { opacity: 1; transform: none; } }
.inv-chev { display: inline-flex; }

/* Skeleton -------------------------------------------------------------- */
.inv-skeleton {
  background-color: color-mix(in srgb, var(--dsw-alias-label-secondary, #6b7280) 12%, transparent);
  background-image: linear-gradient(90deg, transparent 0%, color-mix(in srgb, var(--dsw-alias-label-secondary, #6b7280) 9%, transparent) 45%, transparent 90%);
  background-repeat: no-repeat;
  background-size: 200% 100%;
  animation: inv-shimmer 1400ms ease-in-out infinite;
}
@keyframes inv-shimmer { from { background-position: 140% 0; } to { background-position: -60% 0; } }

/* Spinner --------------------------------------------------------------- */
.inv-spin { animation: inv-spin 720ms linear infinite; }
@keyframes inv-spin { to { transform: rotate(360deg); } }

/* Scrollbar + selection: the details that make a panel feel owned -------- */
.inv-scroll {
  scrollbar-width: thin;
  scrollbar-color: color-mix(in srgb, var(--dsw-alias-label-secondary, #6b7280) 35%, transparent) transparent;
  overscroll-behavior: contain;
}
.inv-scroll::-webkit-scrollbar { width: 10px; height: 10px; }
.inv-scroll::-webkit-scrollbar-track { background: transparent; }
.inv-scroll::-webkit-scrollbar-thumb {
  background: color-mix(in srgb, var(--dsw-alias-label-secondary, #6b7280) 32%, transparent);
  border: 3px solid transparent;
  border-radius: 999px;
  background-clip: content-box;
}
.inv-scroll::-webkit-scrollbar-thumb:hover { background: color-mix(in srgb, var(--dsw-alias-label-secondary, #6b7280) 52%, transparent); background-clip: content-box; }
.inv-scroll ::selection { background: color-mix(in srgb, var(--dsw-alias-button-info-fill, #4176e6) 24%, transparent); }

/* Preference fallbacks -------------------------------------------------- */
@media (prefers-reduced-motion: reduce) {
  .inv-row, .inv-switch, .inv-switch > span, .inv-seg-btn, .inv-chip, .inv-primary,
  .inv-link, .inv-ctrl, .inv-hide, .inv-rail-item, .inv-search-wrap, .inv-textarea,
  .inv-chev, .inv-provider-fill, .inv-nav-title { transition-duration: 0ms !important; }
  .inv-chip:active:enabled, .inv-primary:active:enabled, .inv-link:active:enabled,
  .inv-ctrl:active:enabled, .inv-switch:active:enabled > span { transform: none !important; }
  .inv-section-body { animation: none; }
  .inv-skeleton { animation: none; }
  .inv-spin { animation-duration: 1.6s; }
}
@media (prefers-reduced-transparency: reduce) {
  .inv-nav { background: var(--dsw-alias-bg-base, #fff) !important; backdrop-filter: none !important; -webkit-backdrop-filter: none !important; }
}
@media (prefers-contrast: more) {
  /* Every colour here is also set inline, so !important is the only way a
     preference can win (the same reason the panel keeps state colours in CSS). */
  .inv-card { border-color: currentColor !important; }
  .inv-row { border-bottom-color: currentColor !important; }
  .inv-search-wrap { box-shadow: inset 0 0 0 1px currentColor; }
  .inv-chip, .inv-primary, .inv-ctrl { border-color: currentColor !important; }
  .inv-switch { box-shadow: inset 0 0 0 1px currentColor !important; }
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

