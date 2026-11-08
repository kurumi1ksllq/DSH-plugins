    /**
     * Cross-machine sync panel.
     *
     * Configuration, the diff, and the two actions live in one column. The diff
     * comes from the host and is re-read after every write; the form is local
     * state so typing never triggers a refetch.
     *
     * A checkbox exists only for rows the host calls installable. `blocked`
     * rows show their reason instead — that distinction is the entire reason
     * blocked is not folded into missing.
     */
    function SyncPanel({ t, onReloadSnapshot }) {
      const [payload, setPayload] = React.useState(null)
      const [error, setError] = React.useState('')
      const [notice, setNotice] = React.useState('')
      const [busy, setBusy] = React.useState('')
      const [selection, setSelection] = React.useState([])
      const [preview, setPreview] = React.useState(null)
      const [repo, setRepo] = React.useState('')
      const [repoUrl, setRepoUrl] = React.useState('')
      const [mode, setMode] = React.useState('github')
      const [ref, setRef] = React.useState('main')
      const [path, setPath] = React.useState('dsh-manifest.json')
      const [token, setToken] = React.useState('')
      // The form is seeded once from the host state, then belongs to the user.
      const seeded = React.useRef(false)

      const load = React.useCallback(async () => {
        setBusy('load')
        setError('')
        try {
          const response = await fetch(SYNC_ROUTE, { headers: { accept: 'application/json' } })
          if (!response.ok) throw new Error(`HTTP ${response.status}`)
          const data = await response.json()
          setPayload(data)
          if (seeded.current !== true && data !== null && typeof data.state === 'object') {
            setRepo(data.state.repo ?? '')
            setRepoUrl(data.state.repoUrl ?? '')
            setMode(['github', 'gitee', 'http'].includes(data.state.mode) ? data.state.mode : 'github')
            setRef(data.state.ref ?? 'main')
            setPath(data.state.path ?? 'dsh-manifest.json')
            seeded.current = true
          }
        } catch (e) {
          setError(e !== null && e !== undefined && e.message ? e.message : String(e))
        } finally {
          setBusy('')
        }
      }, [])

      React.useEffect(() => {
        load()
      }, [load])

      /** Read the JSON error detail the host put in the body, if any. */
      const detailOf = async (response) => {
        try {
          const body = await response.json()
          if (typeof body?.error === 'string' && body.error.length > 0) return body.error
          if (Array.isArray(body?.results)) {
            const failed = body.results.filter((item) => item.ok !== true)
            if (failed.length > 0) return failed.map((item) => `${item.key}: ${item.error}`).join('；')
          }
        } catch {
          // A non-JSON body still has a status worth showing.
        }
        return `HTTP ${response.status}`
      }

      const save = React.useCallback(async () => {
        setBusy('save')
        setError('')
        setNotice('')
        try {
          const body = { repo, mode, ref, path, repoUrl }
          // Only send the token when the user typed one: an empty field means
          // "leave the stored token alone", not "erase it".
          if (token.length > 0) body.token = token
          const response = await fetch(SYNC_CONFIG_ROUTE, {
            method: 'POST',
            headers: { 'content-type': 'application/json', accept: 'application/json' },
            body: JSON.stringify(body),
          })
          if (!response.ok) throw new Error(await detailOf(response))
          setToken('')
          setNotice(t('syncSaved'))
          seeded.current = false
          await load()
        } catch (e) {
          setError(e !== null && e !== undefined && e.message ? e.message : String(e))
        } finally {
          setBusy('')
        }
      }, [repo, repoUrl, mode, ref, path, token, load, t])

      /** POST a body to the apply route and re-read both views afterwards. */
      const runApply = React.useCallback(
        async (body, tag) => {
          setBusy(tag)
          setError('')
          setNotice('')
          try {
            const response = await fetch(SYNC_APPLY_ROUTE, {
              method: 'POST',
              headers: { 'content-type': 'application/json', accept: 'application/json' },
              body: JSON.stringify(body),
            })
            const result = await response.json()
            if (!response.ok || result?.ok !== true) throw new Error(await detailOf(response))
            if (tag === 'install') {
              setNotice(t('syncInstalled').replace('{count}', String(result.applied ?? 0)))
              setSelection([])
              if (typeof onReloadSnapshot === 'function') onReloadSnapshot()
            } else if (result.unchanged === true) {
              setNotice(t('syncPublishUnchanged'))
            } else {
              setNotice(t('syncPublished'))
            }
            await load()
          } catch (e) {
            setError(e !== null && e !== undefined && e.message ? e.message : String(e))
          } finally {
            setBusy('')
          }
        },
        [load, t, onReloadSnapshot],
      )

      const install = React.useCallback(async () => {
        if (selection.length === 0) {
          setError(t('syncNothingSelected'))
          return
        }
        await runApply({ selection }, 'install')
      }, [selection, runApply, t])

      const publish = React.useCallback(async () => {
        await runApply({ action: 'publish' }, 'publish')
      }, [runApply])

      const showPreview = React.useCallback(async () => {
        setBusy('preview')
        setError('')
        try {
          const response = await fetch(SYNC_PREVIEW_ROUTE, { headers: { accept: 'application/json' } })
          if (!response.ok) throw new Error(await detailOf(response))
          setPreview(await response.json())
        } catch (e) {
          setError(e !== null && e !== undefined && e.message ? e.message : String(e))
        } finally {
          setBusy('')
        }
      }, [t])

      const toggleRow = (key) =>
        setSelection((prev) => (prev.includes(key) ? prev.filter((item) => item !== key) : [...prev, key]))

      const rows = Array.isArray(payload?.rows) ? payload.rows : []
      const installable = rows.filter((item) => item.status === 'missing' || item.status === 'outdated')
      const counts = payload?.counts ?? {}
      const state = payload?.state ?? {}
      const capabilities = payload?.capabilities ?? {}
      const configured = typeof state.repo === 'string' && state.repo.length > 0

      // One line about the fleet: how many machines share the manifest, which
      // one this panel is, and whether this machine has published at all.
      const manifestInfo = payload?.manifest ?? null
      const fleetCount = typeof manifestInfo?.fleetMachines === 'number' ? manifestInfo.fleetMachines : 0
      const selfPublished = manifestInfo?.publishedByThisMachine === true
      const fleetLine = fleetCount > 0
        ? t('syncFleet')
            .replace('{count}', String(fleetCount))
            .replace('{machine}', typeof state.machineId === 'string' && state.machineId.length > 0 ? state.machineId : '—')
            + (selfPublished ? '' : '')
        : manifestInfo !== null
          ? t('syncFleetSelf')
          : ''

      const field = (label, value, onChange, placeholder, isSecret) =>
        h(
          'label',
          { style: { display: 'flex', flexDirection: 'column', gap: '4px', flex: '1 1 auto', minWidth: 0 } },
          h('span', { style: S.rowSub }, label),
          h('input', {
            style: { ...S.search, height: '34px', padding: '0 10px', borderRadius: '9px', background: C.fill, fontSize: '14px' },
            value,
            placeholder,
            type: isSecret === true ? 'password' : 'text',
            onChange: (event) => onChange(event.target.value),
          }),
        )

      const configCard = h(
        'div',
        { style: { ...S.card, padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: '10px' } },
        configured
          ? null
          : h('div', { style: S.rowSub }, t('syncNotConfigured')),
        h('div', { style: { display: 'flex', gap: '10px', flexWrap: 'wrap' } },
          h(
            'label',
            { style: { display: 'flex', flexDirection: 'column', gap: '4px', flex: '1 1 auto', minWidth: 0 } },
            h('span', { style: S.rowSub }, t('syncMode')),
            h(
              'select',
              {
                style: { ...S.search, height: '34px', padding: '0 10px', borderRadius: '9px', background: C.fill, fontSize: '14px' },
                value: mode,
                onChange: (event) => setMode(event.target.value),
              },
              h('option', { value: 'github' }, t('syncModeGithub')),
              h('option', { value: 'gitee' }, t('syncModeGitee')),
              h('option', { value: 'http' }, t('syncModeHttp')),
            ),
          ),
        ),
        h('div', { style: { display: 'flex', gap: '10px', flexWrap: 'wrap' } },
          field(t('syncRepo'), repo, setRepo, mode === 'http' ? t('syncRepoPlaceholderHttp') : t('syncRepoPlaceholder')),
          mode === 'http'
            ? h('span', { style: { flex: '1 1 auto', minWidth: 0 } })
            : field(t('syncRef'), ref, setRef, 'main'),
        ),
        h('div', { style: { display: 'flex', gap: '10px', flexWrap: 'wrap' } },
          field(t('syncRepoUrl'), repoUrl, setRepoUrl, t('syncRepoUrlPlaceholder')),
        ),
        mode === 'http' ? h('div', { style: S.rowSub }, t('syncModeHttpHint')) : null,
        mode === 'http'
          ? null
          : h('div', { style: { display: 'flex', gap: '10px', flexWrap: 'wrap' } },
              field(t('syncPath'), path, setPath, 'dsh-manifest.json'),
              field(
                t('syncToken'),
                token,
                setToken,
                state.hasToken === true ? t('syncTokenSet') : t('syncTokenPlaceholder'),
                true,
              ),
            ),
        h('div', { style: { display: 'flex', gap: '10px', flexWrap: 'wrap' } },
          mode === 'http'
            ? field(
                t('syncToken'),
                token,
                setToken,
                state.hasToken === true ? t('syncTokenSet') : t('syncTokenPlaceholder'),
                true,
              )
            : h('span', { style: { display: 'none' } }),
        ),
        h('div', { style: S.rowSub }, t('syncTokenHint')),
        h('div', { style: { display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' } },
          h(
            'button',
            {
              type: 'button',
              className: 'inv-btn',
              style: { ...S.chip, ...S.chipOn, opacity: busy === 'save' ? 0.5 : 1 },
              disabled: busy === 'save',
              onClick: save,
            },
            t('syncSave'),
          ),
          h(
            'button',
            {
              type: 'button',
              className: 'inv-btn',
              style: { ...S.chip, opacity: busy === 'load' ? 0.5 : 1 },
              disabled: busy === 'load',
              onClick: load,
            },
            t('syncRefresh'),
          ),
          h('span', { style: S.rowSub },
            `${t('syncCanPull')}: ${capabilities.canPull === true ? '✓' : t('syncNo')} · ${t('syncCanPublish')}: ${capabilities.canPublish === true ? '✓' : t('syncNo')}`),
        ),
        h('span', { style: S.rowSub }, fleetLine),
        error.length > 0 ? h('div', { style: S.rowSub, role: 'alert' }, `${t('syncErrorTitle')}: ${error}`) : null,
        notice.length > 0 ? h('div', { style: S.rowSub, role: 'status' }, notice) : null,
      )

      const diffCard = h(
        'div',
        { style: S.card },
        h(
          'div',
          { style: S.row },
          h('div', { style: S.rowMain },
            h('span', { style: S.rowTitle }, t('syncTitle')),
            h('span', { style: S.rowSub },
              rows.length === 0
                ? t('syncEmpty')
                : `${counts.missing ?? 0} ${t('syncStatusMissing')} · ${counts.outdated ?? 0} ${t('syncStatusOutdated')} · ${counts.blocked ?? 0} ${t('syncStatusBlocked')} · ${counts.current ?? 0} ${t('syncStatusCurrent')}`),
          ),
        ),
        ...rows.map((item, index) =>
          h(
            'div',
            { key: `${item.key}-${index}`, style: { ...S.row, ...(index === rows.length - 1 ? S.rowLast : {}) } },
            item.status === 'missing' || item.status === 'outdated'
              ? h('input', {
                  type: 'checkbox',
                  checked: selection.includes(item.key),
                  onChange: () => toggleRow(item.key),
                  'aria-label': `${syncKindLabel(t, item.kind)} ${item.name}`,
                  style: { width: '17px', height: '17px', flexShrink: 0, cursor: 'pointer' },
                })
              : h('span', { style: { width: '17px', flexShrink: 0 } }),
            h('div', { style: S.rowMain },
              h('span', { style: S.rowTitleMono }, item.name),
              h('span', { style: S.rowSub },
                `${syncKindLabel(t, item.kind)}${typeof item.version === 'string' ? ` · ${item.version}` : ''}${Array.isArray(item.requires) && item.requires.length > 0 ? ` · ${t('syncRequires')} ${item.requires.join(', ')}` : ''}`),
              item.reason !== null && item.reason !== undefined ? h('span', { style: S.rowSub }, item.reason) : null,
            ),
            h(Badge, { label: syncStatusLabel(t, item.status), tone: syncTone(item.status), dot: true }),
          ),
        ),
      )

      const actionsCard = h(
        'div',
        { style: { ...S.card, padding: '12px 16px', display: 'flex', flexDirection: 'column', gap: '8px' } },
        h('div', { style: { display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' } },
          h(
            'button',
            {
              type: 'button',
              className: 'inv-btn',
              style: { ...S.chip, ...S.chipOn, opacity: busy === 'install' || selection.length === 0 ? 0.45 : 1 },
              disabled: busy === 'install' || selection.length === 0,
              onClick: install,
            },
            busy === 'install' ? t('syncInstalling') : `${t('syncInstall')} (${selection.length})`,
          ),
          h(
            'button',
            {
              type: 'button',
              className: 'inv-btn',
              style: S.chip,
              onClick: () => setSelection(selection.length === installable.length ? [] : installable.map((item) => item.key)),
            },
            selection.length === installable.length && installable.length > 0 ? t('syncClearAll') : t('syncSelectAll'),
          ),
          h(
            'button',
            {
              type: 'button',
              className: 'inv-btn',
              style: { ...S.chip, opacity: busy === 'publish' ? 0.5 : 1 },
              disabled: busy === 'publish',
              onClick: publish,
            },
            busy === 'publish' ? t('syncPublishing') : t('syncPublish'),
          ),
          h(
            'button',
            {
              type: 'button',
              className: 'inv-btn',
              style: { ...S.chip, opacity: busy === 'preview' ? 0.5 : 1 },
              disabled: busy === 'preview',
              onClick: showPreview,
            },
            t('syncPreview'),
          ),
        ),
        preview !== null
          ? h('div', { style: { display: 'flex', flexDirection: 'column', gap: '4px' } },
              h('span', { style: S.rowTitle }, t('syncPreviewTitle')),
              h('span', { style: S.rowSub },
                `${t('syncPreviewRedacted')}: ${t('syncPreviewSecrets').replace('{count}', String(preview.report?.secretCount ?? 0))} · ${t('syncPreviewPaths').replace('{count}', String(preview.report?.pathCount ?? 0))}`),
              h('pre', { style: { ...S.rowMono, maxHeight: '220px', overflow: 'auto', margin: 0, whiteSpace: 'pre-wrap' } }, preview.text ?? ''),
            )
          : null,
      )

      return h(
        'div',
        { style: { display: 'flex', flexDirection: 'column', gap: '14px', padding: '0 16px 24px' } },
        h('h3', { style: S.h1 }, t('syncTitle')),
        h('p', { style: S.subtitle }, t('syncSubtitle')),
        configCard,
        diffCard,
        actionsCard,
      )
    }

