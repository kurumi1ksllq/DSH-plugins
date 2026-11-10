    /* ------------------------ credential vault (live) ---------------------- */

    // The credential manager was its own sidebar entry. It belongs on the same
    // page as the tools that consume those credentials: the `credential` tool
    // lives in the tool list, so its vault is edited right below it.
    const VAULT_BASE = '/credential-vault/api'
    const CREDENTIAL_ROUTES = {
      list: `${VAULT_BASE}/list`,
      audit: `${VAULT_BASE}/audit`,
      set: `${VAULT_BASE}/set`,
      remove: `${VAULT_BASE}/delete`,
      rotate: `${VAULT_BASE}/rotate`,
      export: `${VAULT_BASE}/export`,
      import: `${VAULT_BASE}/import`,
    }

    const CREDENTIAL_KINDS = ['password', 'token', 'api-key', 'ssh-key', 'database', 'other']

    const credentialKindLabel = (t, kind) => {
      if (kind === 'password') return t('credentialKindPassword')
      if (kind === 'token') return t('credentialKindToken')
      if (kind === 'api-key') return t('credentialKindApiKey')
      if (kind === 'ssh-key') return t('credentialKindSshKey')
      if (kind === 'database') return t('credentialKindDatabase')
      return t('credentialKindOther')
    }

    /**
     * The same normalization the host applies to a credential name: lower-case,
     * every run of non-alphanumeric characters folded to one dash. Shown live
     * under the name field so the user sees that "GitHub Token" and
     * "github-token" are the same credential.
     */
    const credentialSlug = (name) =>
      String(name ?? '')
        .toLowerCase()
        .replace(/[^\p{L}\p{N}]+/gu, '-')
        .replace(/^-+|-+$/g, '')

    /** Parse the comma-separated alias field into the array the host stores. */
    const credentialAliases = (text) =>
      String(text ?? '')
        .split(/[,，]/)
        .map((part) => part.trim())
        .filter((part) => part.length > 0)

    async function credentialApi(path, options) {
      const response = await fetch(path, options ?? {})
      const payload = await response.json().catch(() => ({}))
      if (!response.ok || payload.ok === false) {
        throw new Error(payload.message || payload.error || `HTTP ${response.status}`)
      }
      return payload
    }

    const credentialPost = (path, body) =>
      credentialApi(path, {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify(body ?? {}),
        cache: 'no-store',
      })

    const CREDENTIAL_INPUT = {
      boxSizing: 'border-box',
      width: '100%',
      padding: '8px 10px',
      fontSize: '14px',
      borderRadius: '9px',
      border: `1px solid ${C.hairline}`,
      background: C.base,
      color: C.text,
      font: 'inherit',
    }

    function CredentialField({ label, value }) {
      return h(
        'div',
        { style: { display: 'flex', alignItems: 'baseline', gap: '10px', minWidth: 0 } },
        h('span', { style: { ...T.caption, color: C.secondary, flex: '0 0 88px' } }, label),
        h('span', { style: { ...T.caption, color: C.text, flex: '1 1 auto', minWidth: 0, wordBreak: 'break-all' } }, value),
      )
    }

    /** Add/edit form. Editing an entry leaves the stored secret alone unless retyped. */
    function CredentialEditor({ t, initial, busy, onSave, onCancel }) {
      const isUpdate = Boolean(initial && initial.name && initial.updatedAt)
      const [form, setForm] = React.useState({
        name: initial.name ?? '',
        kind: CREDENTIAL_KINDS.includes(initial.kind) ? initial.kind : 'other',
        secret: '',
        service: initial.service ?? '',
        aliases: Array.isArray(initial.aliases) ? initial.aliases.join(', ') : '',
        username: initial.username ?? '',
        url: initial.url ?? '',
        note: initial.note ?? '',
      })
      const bind = (key) => ({
        value: form[key],
        onChange: (event) => setForm((current) => ({ ...current, [key]: event.target.value })),
      })
      const canSave = form.name.trim().length > 0 && (form.secret.length > 0 || isUpdate)
      return h(
        'form',
        {
          style: { display: 'flex', flexDirection: 'column', gap: '10px' },
          onSubmit: (event) => {
            event.preventDefault()
            if (canSave && !busy) {
              onSave({
                ...form,
                name: form.name.trim(),
                service: form.service.trim(),
                aliases: credentialAliases(form.aliases),
              })
            }
          },
        },
        [
          h('span', { key: 'caption', style: S.sectionTitle }, isUpdate ? t('credentialEdit') : t('credentialAdd')),
          h(
            'label',
            { key: 'name', style: { display: 'flex', flexDirection: 'column', gap: '4px' } },
            h('span', { style: { ...T.caption, color: C.secondary } }, t('credentialName')),
            h('input', { style: CREDENTIAL_INPUT, placeholder: t('credentialNamePlaceholder'), ...bind('name') }),
            form.name.trim().length > 0
              ? h(
                  'span',
                  { style: { ...T.caption, color: C.secondary } },
                  `${t('credentialSlugPreview')}: ${credentialSlug(form.name) || '—'}`,
                )
              : null,
          ),
          h(
            'label',
            { key: 'kind', style: { display: 'flex', flexDirection: 'column', gap: '4px' } },
            h('span', { style: { ...T.caption, color: C.secondary } }, t('credentialKind')),
            h(
              'select',
              { style: CREDENTIAL_INPUT, ...bind('kind') },
              ...CREDENTIAL_KINDS.map((kind) => h('option', { key: kind, value: kind }, credentialKindLabel(t, kind))),
            ),
          ),
          h(
            'label',
            { key: 'service', style: { display: 'flex', flexDirection: 'column', gap: '4px' } },
            h('span', { style: { ...T.caption, color: C.secondary } }, t('credentialService')),
            h('input', { style: CREDENTIAL_INPUT, placeholder: t('credentialServicePlaceholder'), ...bind('service') }),
          ),
          h(
            'label',
            { key: 'aliases', style: { display: 'flex', flexDirection: 'column', gap: '4px' } },
            h('span', { style: { ...T.caption, color: C.secondary } }, t('credentialAliases')),
            h('input', { style: CREDENTIAL_INPUT, placeholder: t('credentialAliasesPlaceholder'), ...bind('aliases') }),
          ),
          h(
            'label',
            { key: 'secret', style: { display: 'flex', flexDirection: 'column', gap: '4px' } },
            h('span', { style: { ...T.caption, color: C.secondary } }, isUpdate ? `${t('credentialSecret')} · ${t('credentialMasked')}` : t('credentialSecret')),
            h('input', {
              style: CREDENTIAL_INPUT,
              type: 'password',
              placeholder: isUpdate ? '\u2022\u2022\u2022\u2022' : t('credentialSecretPlaceholder'),
              autoComplete: 'off',
              ...bind('secret'),
            }),
          ),
          h(
            'label',
            { key: 'username', style: { display: 'flex', flexDirection: 'column', gap: '4px' } },
            h('span', { style: { ...T.caption, color: C.secondary } }, t('credentialUsername')),
            h('input', { style: CREDENTIAL_INPUT, ...bind('username') }),
          ),
          h(
            'label',
            { key: 'url', style: { display: 'flex', flexDirection: 'column', gap: '4px' } },
            h('span', { style: { ...T.caption, color: C.secondary } }, t('credentialUrl')),
            h('input', { style: CREDENTIAL_INPUT, ...bind('url') }),
          ),
          h(
            'label',
            { key: 'note', style: { display: 'flex', flexDirection: 'column', gap: '4px' } },
            h('span', { style: { ...T.caption, color: C.secondary } }, t('credentialNote')),
            h('input', { style: CREDENTIAL_INPUT, ...bind('note') }),
          ),
          h(
            'div',
            { key: 'actions', style: { display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' } },
            h(
              'button',
              {
                type: 'submit',
                className: 'inv-btn inv-primary',
                style: { ...S.primary, ...(canSave && !busy ? {} : { opacity: 0.5, cursor: 'default' }) },
                disabled: !canSave || busy,
              },
              busy ? t('credentialSaving') : t('credentialSave'),
            ),
            h(RowButton, { label: t('credentialCancel'), onClick: onCancel }),
          ),
        ],
      )
    }

    /** Inline form for the export action: passphrase + confirmation. */
    function CredentialExportForm({ t, busy, onSubmit, onCancel }) {
      const [passphrase, setPassphrase] = React.useState('')
      const [confirmPassphrase, setConfirmPassphrase] = React.useState('')
      const mismatch = confirmPassphrase.length > 0 && passphrase !== confirmPassphrase
      const canSave = passphrase.length >= 12 && passphrase === confirmPassphrase
      return h(
        'form',
        {
          style: { display: 'flex', flexDirection: 'column', gap: '10px' },
          onSubmit: (event) => {
            event.preventDefault()
            if (canSave && !busy) onSubmit({ passphrase })
          },
        },
        [
          h('span', { key: 'caption', style: S.sectionTitle }, t('credentialExportTitle')),
          h('span', { key: 'hint', style: { ...T.caption, color: C.secondary } }, t('credentialExportHint')),
          h('input', {
            key: 'passphrase', type: 'password', style: CREDENTIAL_INPUT,
            autoComplete: 'new-password', placeholder: t('credentialPassphrasePlaceholder'),
            value: passphrase, onChange: (event) => setPassphrase(event.target.value),
          }),
          h('input', {
            key: 'confirm', type: 'password', style: CREDENTIAL_INPUT,
            autoComplete: 'new-password', placeholder: t('credentialPassphraseConfirm'),
            value: confirmPassphrase, onChange: (event) => setConfirmPassphrase(event.target.value),
          }),
          mismatch ? h('span', { key: 'mismatch', style: { ...T.caption, color: C.danger } }, t('credentialPassphraseMismatch')) : null,
          h(
            'div',
            { key: 'actions', style: { display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' } },
            h(
              'button',
              { type: 'submit', className: 'inv-btn inv-primary', style: { ...S.primary, ...(canSave && !busy ? {} : { opacity: 0.5, cursor: 'default' }) }, disabled: !canSave || busy },
              busy ? t('credentialSaving') : t('credentialExportGo'),
            ),
            h(RowButton, { label: t('credentialCancel'), onClick: onCancel }),
          ),
        ],
      )
    }

    /** Inline form for the import action: passphrase + pasted envelope + mode. */
    function CredentialImportForm({ t, busy, onSubmit, onCancel }) {
      const [passphrase, setPassphrase] = React.useState('')
      const [content, setContent] = React.useState('')
      const [overwrite, setOverwrite] = React.useState(false)
      const canSave = passphrase.length >= 12 && content.trim().length > 0
      return h(
        'form',
        {
          style: { display: 'flex', flexDirection: 'column', gap: '10px' },
          onSubmit: (event) => {
            event.preventDefault()
            if (canSave && !busy) onSubmit({ passphrase, content: content.trim(), overwrite })
          },
        },
        [
          h('span', { key: 'caption', style: S.sectionTitle }, t('credentialImportTitle')),
          h('span', { key: 'hint', style: { ...T.caption, color: C.secondary } }, t('credentialImportHint')),
          h('input', {
            key: 'passphrase', type: 'password', style: CREDENTIAL_INPUT,
            autoComplete: 'new-password', placeholder: t('credentialPassphrasePlaceholder'),
            value: passphrase, onChange: (event) => setPassphrase(event.target.value),
          }),
          h('textarea', {
            key: 'content',
            style: { ...CREDENTIAL_INPUT, minHeight: '120px', fontFamily: 'monospace', resize: 'vertical' },
            placeholder: t('credentialImportContentPlaceholder'),
            value: content,
            onChange: (event) => setContent(event.target.value),
          }),
          h(
            'label',
            { key: 'overwrite', style: { display: 'flex', alignItems: 'center', gap: '8px', ...T.caption } },
            h('input', { type: 'checkbox', checked: overwrite, onChange: (event) => setOverwrite(event.target.checked) }),
            t('credentialImportOverwrite'),
          ),
          h(
            'div',
            { key: 'actions', style: { display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' } },
            h(
              'button',
              { type: 'submit', className: 'inv-btn inv-primary', style: { ...S.primary, ...(canSave && !busy ? {} : { opacity: 0.5, cursor: 'default' }) }, disabled: !canSave || busy },
              busy ? t('credentialSaving') : t('credentialImportGo'),
            ),
            h(RowButton, { label: t('credentialCancel'), onClick: onCancel }),
          ),
        ],
      )
    }

    /**
     * Trigger a browser download for an export file. Returns false when no DOM
     * is available (tests), so callers can distinguish "saved" from "skipped".
     * Follows the same pattern as @deepseek-ai/dsh-session-log-export's
     * `downloadUrl`: Blob URL + a temporary anchor with `download`.
     */
    function defaultSaveFile({ text, filename }) {
      if (typeof document === 'undefined') return false
      try {
        const blob = new Blob([text], { type: 'application/json' })
        const url = URL.createObjectURL(blob)
        const anchor = document.createElement('a')
        anchor.href = url
        anchor.download = filename
        document.body.appendChild(anchor)
        anchor.click()
        anchor.remove()
        setTimeout(() => URL.revokeObjectURL(url), 1000)
        return true
      } catch {
        return false
      }
    }

    /**
     * Credential vault: masked list on top, detail + add/edit form + reveal audit
     * log below. No route ever returns a secret, so the panel only ever shows the
     * masked preview the host sent.
     */
    function CredentialVault(props) {
      const t = typeof props.t === 'function' ? props.t : (key) => zh[key] ?? en[key] ?? key
      const confirm = typeof window !== 'undefined' && typeof window.confirm === 'function' ? window.confirm.bind(window) : () => true
      // Download/read are injectable so tests can drive them without a DOM
      // (the node test runtime has no `document`); production uses the defaults.
      const saveFile = typeof props.saveFile === 'function' ? props.saveFile : defaultSaveFile
      const readFile = typeof props.readFile === 'function' ? props.readFile : (file) => file.text()

      const [entries, setEntries] = React.useState([])
      const [audit, setAudit] = React.useState([])
      const [selectedName, setSelectedName] = React.useState('')
      const [editing, setEditing] = React.useState(null)
      const [phase, setPhase] = React.useState('loading')
      const [failure, setFailure] = React.useState('')
      const [notice, setNotice] = React.useState('')
      const [showAudit, setShowAudit] = React.useState(false)
      const [aux, setAux] = React.useState(null) // null | 'export' | 'import'

      const reload = React.useCallback(async () => {
        setPhase((current) => (current === 'loading' ? 'loading' : 'busy'))
        setFailure('')
        try {
          const [listResult, auditResult] = await Promise.all([credentialApi(CREDENTIAL_ROUTES.list), credentialApi(CREDENTIAL_ROUTES.audit)])
          setEntries(Array.isArray(listResult.entries) ? listResult.entries : [])
          setAudit(Array.isArray(auditResult.records) ? auditResult.records : [])
          setPhase('idle')
        } catch (error) {
          setFailure(error?.message ?? String(error))
          setPhase('error')
        }
      }, [])

      React.useEffect(() => {
        let cancelled = false
        Promise.all([credentialApi(CREDENTIAL_ROUTES.list), credentialApi(CREDENTIAL_ROUTES.audit)])
          .then(([listResult, auditResult]) => {
            if (cancelled) return
            setEntries(Array.isArray(listResult.entries) ? listResult.entries : [])
            setAudit(Array.isArray(auditResult.records) ? auditResult.records : [])
            setPhase('idle')
          })
          .catch((error) => {
            if (cancelled) return
            setFailure(error?.message ?? String(error))
            setPhase('error')
          })
        return () => {
          cancelled = true
        }
      }, [])

      // A notice clears itself; the timer is dropped when the section unmounts.
      React.useEffect(() => {
        if (notice === '') return undefined
        const timer = setTimeout(() => setNotice(''), 3000)
        return () => clearTimeout(timer)
      }, [notice])

      const run = async (work) => {
        setPhase('busy')
        setFailure('')
        try {
          await work()
          await reload()
        } catch (error) {
          setFailure(error?.message ?? String(error))
          setPhase('error')
        }
      }

      const save = (form) =>
        run(async () => {
          const result = await credentialPost(CREDENTIAL_ROUTES.set, form)
          setNotice(result.updated ? t('credentialUpdated') : t('credentialCreated'))
          setEditing(null)
        })

      // The confirmation must happen BEFORE run(): run() flips the section to
      // "busy", clears the visible failure, and reloads when it returns — so a
      // cancelled action used to refresh the panel and wipe an error message the
      // user still needed to read.
      const remove = (name) => {
        if (!confirm(`${t('credentialConfirmDelete')}: ${name}?`)) return
        return run(async () => {
          await credentialPost(CREDENTIAL_ROUTES.remove, { name })
          if (selectedName === name) setSelectedName('')
          setNotice(t('credentialDeleted'))
        })
      }

      const rotate = () => {
        if (!confirm(t('credentialRotateConfirm'))) return
        return run(async () => {
          await credentialPost(CREDENTIAL_ROUTES.rotate, {})
          setNotice(t('credentialRotated'))
        })
      }

      // ---- export / import (issue #51) ----
      const [exportForm, setExportForm] = React.useState(null) // {passphrase, confirm}
      const [importForm, setImportForm] = React.useState(null) // {passphrase, content, overwrite}

      const startExport = async (form) => {
        setPhase('busy')
        setFailure('')
        try {
          const result = await credentialPost(CREDENTIAL_ROUTES.export, { passphrase: form.passphrase })
          const saved = saveFile({ text: result.content, filename: result.filename })
          setAux(null)
          setExportForm(null)
          setPhase('idle')
          setNotice(saved ? t('credentialExportDone') : t('credentialExportNoDownload'))
        } catch (error) {
          setFailure(error?.message ?? String(error))
          setPhase('error')
        }
      }

      const startImport = async (form) => {
        setPhase('busy')
        setFailure('')
        try {
          const result = await credentialPost(CREDENTIAL_ROUTES.import, {
            passphrase: form.passphrase,
            content: form.content,
            mode: form.overwrite ? 'overwrite' : 'skip',
          })
          await reload()
          setAux(null)
          setImportForm(null)
          setPhase('idle')
          setNotice(t('credentialImportSummary')
            .replace('{imported}', String(result.imported ?? 0))
            .replace('{updated}', String(result.updated ?? 0))
            .replace('{skipped}', String(result.skipped ?? 0))
            .replace('{conflicts}', String((result.conflicts ?? []).length))
            .replace('{stale}', String(result.stale ?? 0)))
        } catch (error) {
          setFailure(error?.message ?? String(error))
          setPhase('error')
        }
      }

      const selected = entries.find((entry) => entry.name === selectedName) ?? null
      const busy = phase === 'busy'

      let status = null
      if (phase === 'loading') status = h('span', { style: S.feedback }, t('credentialLoading'))
      else if (phase === 'error') status = h('span', { style: { ...S.feedback, color: C.danger } }, `${t('credentialError')}${failure ? ` (${failure})` : ''}`)
      else if (phase === 'busy') status = h('span', { style: S.feedback }, t('credentialSaving'))

      const list =
        entries.length === 0
          ? h('div', { className: 'inv-card', style: S.card }, h('div', { style: S.empty }, phase === 'loading' ? t('credentialLoading') : t('credentialNoEntries')))
          : h(
              'div',
              { className: 'inv-card', style: S.card, role: 'list' },
              ...entries.map((entry, index) =>
                h(
                  'div',
                  {
                    key: entry.name,
                    role: 'button',
                    tabIndex: 0,
                    'aria-pressed': entry.name === selectedName ? 'true' : 'false',
                    className: 'inv-row',
                    'data-interactive': 'true',
                    style: {
                      ...S.row,
                      ...(index === entries.length - 1 ? S.rowLast : {}),
                      cursor: 'pointer',
                      ...(entry.name === selectedName ? { background: C.fill } : {}),
                    },
                    onClick: () => {
                      setSelectedName(entry.name)
                      setEditing(null)
                    },
                    onKeyDown: activate(() => {
                      setSelectedName(entry.name)
                      setEditing(null)
                    }),
                  },
                  h(Icon, { name: 'lock', size: 16, style: { color: C.secondary } }),
                  h(
                    'div',
                    { style: S.rowMain },
                    h('span', { style: S.rowTitleMono }, entry.name),
                    h(
                      'span',
                      { style: S.rowSub },
                      [
                        credentialKindLabel(t, entry.kind),
                        entry.service,
                        Array.isArray(entry.aliases) && entry.aliases.length > 0 ? entry.aliases.join(', ') : null,
                      ]
                        .filter(Boolean)
                        .join(' · '),
                    ),
                  ),
                  h(Badge, { label: entry.preview || '***' }),
                  h(Icon, { name: 'chevronRight', size: 16, style: S.chevronMuted }),
                ),
              ),
            )

      const auxPanel =
        aux === 'export'
          ? h(CredentialExportForm, {
              key: 'export-form',
              t,
              busy,
              onSubmit: startExport,
              onCancel: () => setAux(null),
            })
          : aux === 'import'
            ? h(CredentialImportForm, {
                key: 'import-form',
                t,
                busy,
                onSubmit: startImport,
                onCancel: () => setAux(null),
              })
            : null

      const details =
        aux === null && editing !== null
          ? h(CredentialEditor, {
              key: `editor-${editing.name ?? 'new'}`,
              t,
              initial: editing,
              busy,
              onSave: save,
              onCancel: () => setEditing(null),
            })
          : selected !== null
            ? h(
                'div',
                { className: 'inv-card', style: { ...S.card, display: 'flex', flexDirection: 'column', gap: '10px', padding: '14px 16px' } },
                h(
                  'div',
                  { style: { display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' } },
                  h('span', { style: S.rowTitleMono }, selected.name),
                  h(Badge, { label: credentialKindLabel(t, selected.kind) }),
                  selected.hasSecret === true ? h(Badge, { label: t('credentialHasSecret'), tone: 'success', dot: true }) : null,
                ),
                CredentialField({ label: t('credentialMasked'), value: selected.preview || '***' }),
                selected.service ? CredentialField({ label: t('credentialService'), value: selected.service }) : null,
                Array.isArray(selected.aliases) && selected.aliases.length > 0
                  ? h(
                      'div',
                      { style: { display: 'flex', alignItems: 'baseline', gap: '10px', flexWrap: 'wrap' } },
                      h('span', { style: { ...T.caption, color: C.secondary, flex: '0 0 88px' } }, t('credentialAliases')),
                      h(
                        'div',
                        { style: { display: 'flex', gap: '6px', flexWrap: 'wrap' } },
                        ...selected.aliases.map((alias) => h(Badge, { key: alias, label: alias })),
                      ),
                    )
                  : null,
                selected.username ? CredentialField({ label: t('credentialUsername'), value: selected.username }) : null,
                selected.url ? CredentialField({ label: t('credentialUrl'), value: selected.url }) : null,
                selected.note ? CredentialField({ label: t('credentialNote'), value: selected.note }) : null,
                CredentialField({ label: t('credentialUpdatedAt'), value: selected.updatedAt || '—' }),
                h(
                  'div',
                  { style: { display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap', paddingTop: '2px' } },
                  h(
                    'button',
                    {
                      type: 'button',
                      className: 'inv-btn inv-chip',
                      style: S.chip,
                      onClick: () => setEditing({ ...selected, secret: '' }),
                    },
                    t('credentialEdit'),
                  ),
                  h(RowButton, { label: t('credentialDelete'), disabled: busy, onClick: () => remove(selected.name) }),
                ),
              )
            : null

      const auditPanel = showAudit
        ? h(
            'div',
            { className: 'inv-card', style: { ...S.card, padding: '6px 16px 10px' } },
            h('div', { style: { ...S.sectionHead, cursor: 'default', padding: '8px 0 6px' } }, h('span', { style: S.sectionTitle }, t('credentialAudit'))),
            audit.length === 0
              ? h('div', { style: S.empty }, t('credentialAuditEmpty'))
              : h(
                  'div',
                  { style: { display: 'flex', flexDirection: 'column' } },
                  ...audit.slice(0, 40).map((record, index) =>
                    h(
                      'div',
                      {
                        key: `audit-${index}`,
                        style: { display: 'flex', alignItems: 'baseline', gap: '10px', padding: '6px 0', borderBottom: index === audit.length - 1 ? 'none' : `1px solid ${C.hairline}`, ...T.caption, flexWrap: 'wrap' },
                      },
                      h('span', { style: { color: C.secondary, fontVariantNumeric: 'tabular-nums' } }, record.at || '—'),
                      h('span', { style: { fontWeight: 600 } }, record.name || '—'),
                      h('span', { style: { color: C.secondary } }, `${record.outcome ?? ''}${record.source ? ` · ${record.source}` : ''}`),
                    ),
                  ),
                ),
          )
        : null

      return h(
        'div',
        { style: { display: 'flex', flexDirection: 'column', gap: '10px' } },
        h(
          'div',
          { style: { display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' } },
          h('span', { style: { ...T.caption, color: C.secondary, flex: '1 1 auto', minWidth: 0 } }, t('credentialToolHint')),
          status,
          h(
            'button',
            {
              type: 'button',
              className: 'inv-btn inv-chip',
              style: S.chip,
              onClick: () => setEditing({}),
            },
            t('credentialAdd'),
          ),
          h(
            'button',
            {
              type: 'button',
              className: showAudit ? 'inv-btn inv-chip inv-chip-on' : 'inv-btn inv-chip',
              'aria-pressed': showAudit ? 'true' : 'false',
              style: { ...S.chip, ...(showAudit ? S.chipOn : {}) },
              onClick: () => setShowAudit((prev) => !prev),
            },
            t('credentialAudit'),
          ),
          h(
            'button',
            {
              type: 'button',
              className: 'inv-btn inv-chip',
              style: S.chip,
              disabled: busy,
              onClick: () => setAux((current) => (current === 'export' ? null : 'export')),
            },
            t('credentialExport'),
          ),
          h(
            'button',
            {
              type: 'button',
              className: 'inv-btn inv-chip',
              style: S.chip,
              disabled: busy,
              onClick: () => setAux((current) => (current === 'import' ? null : 'import')),
            },
            t('credentialImport'),
          ),
          h(
            'button',
            {
              type: 'button',
              className: 'inv-btn inv-chip',
              style: S.chip,
              disabled: busy,
              onClick: rotate,
            },
            t('credentialRotate'),
          ),
          h(
            'button',
            {
              type: 'button',
              className: 'inv-btn inv-chip',
              style: S.chip,
              disabled: busy,
              onClick: () => reload(),
            },
            t('credentialRefresh'),
          ),
        ),
        list,
        auxPanel,
        details,
        auditPanel,
        notice !== '' ? h('div', { style: S.notice, role: 'status' }, notice) : null,
      )
    }
