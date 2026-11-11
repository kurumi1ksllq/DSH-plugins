    function apply(ctx) {
      ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'dsh-inventory: dictionaries')
      ctx.effect(installStyles, 'dsh-inventory: styles')
      const t = ctx.locale.bind(NS)

      // Sidebar entry and main panel share the same id/key, so selecting the
      // entry routes the shell to this panel (same contract as the shipped
      // prompt-inject sidebar panel).
      ctx.slots.inject('sidebar.panellist', () =>
        ctx.slots.register(
          {
            name: 'sidebar.panellist',
            id: 'inventory',
            order: 20,
            label: () => t('panel'),
            locale: NS,
          },
          SidebarIcon,
        ),
      )
      ctx.slots.inject('main', () =>
        ctx.slots.register(
          {
            name: 'main',
            key: 'inventory',
            locale: NS,
            inject: () => ({
              t,
              back: () => ctx.layout.selectPanel(null),
            }),
          },
          InventoryPanel,
        ),
      )

      // The Plugins page's own slots: a button at the head of a bundle's detail
      // page and a tag beside its version. Both filter on this checkout's bundle
      // list, so a foreign package renders nothing.
      ctx.slots.inject('plugins.detail.actions', () =>
        ctx.slots.register(
          { name: 'plugins.detail.actions', id: 'inventory-update', order: 10, locale: NS, inject: () => ({ t }) },
          PluginUpdateAction,
        ),
      )
      ctx.slots.inject('plugins.detail.badge', () =>
        ctx.slots.register(
          { name: 'plugins.detail.badge', id: 'inventory-update-badge', order: 10, locale: NS, inject: () => ({ t }) },
          PluginUpdateBadge,
        ),
      )
    }

    /**
     * The update affordances on the Plugins page (issue #45).
     *
     * Two slots, one source of truth: `plugins.detail.actions` draws the button,
     * `plugins.detail.badge` the tag beside the version. Both render `null` for
     * any package that is not in this checkout's bundle list, so every other
     * plugin page on the page looks exactly as it did before.
     *
     * A recomposition cannot be rolled back, so the click asks first and the
     * request itself is what decides whether an update may start — the browser
     * never decides that.
     */
    const UPDATE_ROUTE = '/inventory/plugin-update'
    const UPDATE_APPLY_ROUTE = '/inventory/plugin-update/apply'

    /**
     * One shared read of the update state.
     *
     * Both slots are mounted for the same bundle and this route runs a
     * `git fetch`, so a request per component would double every poll. The cache
     * also keeps "is this ours" from costing a network round trip per page.
     */
    const updateCache = { at: 0, state: null, inFlight: null }
    const UPDATE_CACHE_MS = 10_000

    function loadUpdateState(force = false) {
      const now = Date.now()
      if (!force && updateCache.state !== null && now - updateCache.at < UPDATE_CACHE_MS) {
        return Promise.resolve(updateCache.state)
      }
      if (updateCache.inFlight !== null) return updateCache.inFlight
      updateCache.inFlight = fetch(UPDATE_ROUTE, { headers: { accept: 'application/json' } })
        .then((response) => response.json())
        .catch((error) => ({ ok: false, error: String(error?.message ?? error) }))
        .then((state) => {
          updateCache.state = state
          updateCache.at = Date.now()
          updateCache.inFlight = null
          return state
        })
      return updateCache.inFlight
    }

    function useUpdateState() {
      const [state, setState] = React.useState(updateCache.state)
      React.useEffect(() => {
        let live = true
        loadUpdateState().then((next) => {
          if (live) setState(next)
        })
        return () => {
          live = false
        }
      }, [])
      return state
    }

    /**
     * Whether this subject could be one of ours, decided WITHOUT a request.
     *
     * Every other page on the Plugins page must stay free: an official bundle is
     * never ours, so opening it must not cause a `git fetch`.
     */
    function mayBeOurs(subject) {
      if (subject?.kind !== 'bundle') return false
      const name = subject.pkg?.name
      if (typeof name !== 'string' || name.length === 0) return false
      if (name.startsWith('@deepseek-ai/')) return false
      return subject.pkg?.installed === true
    }

    /** The row for one bundle in the status payload, or null when it is not ours. */
    function updateRowFor(state, subject) {
      if (state?.ok !== true || Array.isArray(state.bundles) !== true) return null
      if (mayBeOurs(subject) !== true) return null
      return state.bundles.find((row) => row.name === subject.pkg.name) ?? null
    }

    function PluginUpdateBadge({ subject, t }) {
      if (mayBeOurs(subject) !== true) return null
      return h(BadgeBody, { subject, t })
    }

    function BadgeBody({ subject, t }) {
      const state = useUpdateState()
      const row = updateRowFor(state, subject)
      if (row === null || row.updatable !== true) return null
      return h(
        'span',
        {
          style: {
            display: 'inline-flex',
            alignItems: 'center',
            height: '20px',
            padding: '0 8px',
            borderRadius: '999px',
            background: C.fill,
            color: C.secondary,
            fontSize: '11px',
            fontWeight: 600,
          },
        },
        `${t('updateBadge')} ${row.version} → ${row.nextVersion}`,
      )
    }

    function PluginUpdateAction({ subject, t }) {
      if (mayBeOurs(subject) !== true) return null
      return h(ActionBody, { subject, t })
    }

    function ActionBody({ subject, t }) {
      const state = useUpdateState()
      const [busy, setBusy] = React.useState(false)
      const [note, setNote] = React.useState(null)
      const row = updateRowFor(state, subject)
      const outcome = state?.last ?? null

      if (row === null) return null

      const run = async () => {
        setBusy(true)
        setNote(t('updateRunning'))
        try {
          const response = await fetch(UPDATE_APPLY_ROUTE, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ name: row.name }),
          })
          const payload = await response.json()
          if (payload?.accepted !== true) setNote(payload?.detail ?? payload?.error ?? t('updateFailed'))
        } catch (error) {
          setNote(String(error?.message ?? error))
        } finally {
          setBusy(false)
          setTimeout(() => {
            loadUpdateState(true).then(() => setNote(null))
          }, 1500)
        }
      }

      const confirm =
        typeof window !== 'undefined' && typeof window.confirm === 'function' ? window.confirm.bind(window) : () => true
      const onClick = () => {
        if (!confirm(t('updateConfirm'))) return
        run()
      }

      // The host writes the outcome to disk because a self-update stops this
      // module; reading it back is how the page learns what actually happened.
      const restart = outcome?.restart
      const verdict =
        restart === undefined
          ? null
          : restart.application === 'applied'
            ? t('updateDone')
            : `${t('updateDone')} · ${restart.restartReason ?? restart.application}`

      if (row.updatable !== true) {
        return h('span', { style: { ...T.caption, color: C.secondary } }, verdict ?? t('updateCurrent'))
      }

      return h(
        'div',
        { style: { display: 'inline-flex', alignItems: 'center', gap: '8px' } },
        h(
          'button',
          {
            type: 'button',
            className: 'inv-seg-btn inv-primary',
            style: { ...S.primary, ...(busy ? { opacity: 0.5, cursor: 'default' } : {}) },
            disabled: busy,
            onClick: busy ? undefined : onClick,
          },
          t('updateTo').replace('{version}', String(row.nextVersion ?? '')),
        ),
        note === null ? null : h('span', { style: { ...T.caption, color: C.secondary } }, note),
        verdict === null ? null : h('span', { style: { ...T.caption, color: C.secondary } }, verdict),
      )
    }
