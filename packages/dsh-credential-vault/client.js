/**
 * dsh-credential-vault — browser half of the DSH bundle.
 *
 * The credential manager is a section of dsh-inventory's Tools page (next to
 * the `credential` tool it backs), not a sidebar panel: a masked entry list,
 * details, an add/edit form, delete, master-key rotation and the reveal audit
 * log. The host half owns the routes below; this factory owns only the
 * dictionary and the component the Tools page renders.
 *
 * Host half contract, base `/credential-vault/api`:
 *   GET  ${base}/list            -> { ok, entries:[{name, kind, preview, ...}] }
 *   GET  ${base}/entry?name=x    -> { ok, entry }          (masked)
 *   GET  ${base}/audit           -> { ok, records:[…] }
 *   POST ${base}/set             -> { ok, name, updated }  (sends secret in)
 *   POST ${base}/delete          -> { ok, deleted }
 *   POST ${base}/rotate          -> { ok, resealed }
 *
 * NO route returns secret material; the panel works on masked previews only.
 * React.createElement only, inline styles with --dsw-alias-* tokens.
 */
window.__ModuleLoader__.load({
  id: 'dsh-credential-vault',
  factory(require) {
    const React = require('react')

    const NS = 'credential-vault'
    const SIDEBAR_SLOT = 'sidebar.panellist'
    const MAIN_SLOT = 'main'
    const SIDEBAR_ORDER = 31

    const ROUTES = {
      list: '/credential-vault/api/list',
      audit: '/credential-vault/api/audit',
      set: '/credential-vault/api/set',
      remove: '/credential-vault/api/delete',
      rotate: '/credential-vault/api/rotate',
    }

    const KINDS = ['password', 'token', 'api-key', 'ssh-key', 'other']

    const KIND_LABELS = {
      password: '密码',
      token: 'Token',
      'api-key': 'API Key',
      'ssh-key': 'SSH 密钥',
      other: '其他',
    }

    /* ------------------------------ plumbing ------------------------------ */

    async function api(path, options) {
      const response = await fetch(path, options)
      const payload = await response.json().catch(() => ({}))
      if (!response.ok || payload.ok === false) {
        throw new Error(payload.message || payload.error || `HTTP ${response.status}`)
      }
      return payload
    }

    function post(path, body) {
      return api(path, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      })
    }

    /* -------------------------------- styles ------------------------------- */

    const PRIMARY_BUTTON = {
      border: 'none',
      borderRadius: 'var(--dsw-radius-sm, 6px)',
      padding: '7px 16px',
      fontSize: '13px',
      fontWeight: 600,
      cursor: 'pointer',
      color: 'var(--dsw-alias-label-primary-foreground, #ffffff)',
      background: 'var(--dsw-alias-brand-primary)',
    }

    const GHOST_BUTTON = {
      border: '1px solid var(--dsw-alias-border-l1)',
      borderRadius: 'var(--dsw-radius-sm, 6px)',
      padding: '7px 14px',
      fontSize: '13px',
      cursor: 'pointer',
      background: 'transparent',
      color: 'var(--dsw-alias-label-secondary)',
    }

    const DANGER_BUTTON = Object.assign({}, GHOST_BUTTON, {
      color: 'var(--dsw-alias-state-error-primary, #d14343)',
      borderColor: 'var(--dsw-alias-state-error-primary, #d14343)',
    })

    const INPUT = {
      boxSizing: 'border-box',
      width: '100%',
      padding: '7px 10px',
      fontSize: '13px',
      borderRadius: 'var(--dsw-radius-sm, 6px)',
      border: '1px solid var(--dsw-alias-border-l1)',
      background: 'var(--dsw-alias-bg-layer-1, transparent)',
      color: 'var(--dsw-alias-label-primary)',
      font: 'inherit',
    }

    const STYLE = {
      page: {
        boxSizing: 'border-box', display: 'flex', flexDirection: 'column', height: '100%',
        minHeight: 0, background: 'var(--dsw-alias-bg-base)', color: 'var(--dsw-alias-label-primary)', font: 'inherit',
      },
      header: {
        boxSizing: 'border-box', display: 'flex', flexDirection: 'column', gap: '4px', flex: '0 0 auto',
        padding: '20px 24px 12px', borderBottom: '1px solid var(--dsw-alias-border-l1)',
      },
      headerTop: { display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' },
      headerTitle: { margin: 0, fontSize: '18px', lineHeight: '26px', fontWeight: 600, color: 'var(--dsw-alias-label-primary)' },
      headerActions: { marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' },
      line: { margin: 0, fontSize: '12px', lineHeight: '18px', color: 'var(--dsw-alias-label-secondary)' },
      body: {
        boxSizing: 'border-box', display: 'flex', alignItems: 'stretch', gap: '16px', flex: '1 1 auto',
        minHeight: 0, padding: '16px 24px 20px', flexWrap: 'wrap',
      },
      listPane: {
        boxSizing: 'border-box', display: 'flex', flexDirection: 'column', gap: '8px', flex: '0 0 300px',
        width: '300px', minWidth: 0, minHeight: 0, overflowY: 'auto', paddingRight: '2px',
      },
      listEmpty: { margin: 0, padding: '10px 2px', fontSize: '12px', lineHeight: '18px', color: 'var(--dsw-alias-label-secondary)' },
      row: {
        boxSizing: 'border-box', display: 'flex', alignItems: 'center', gap: '8px', padding: '8px 10px',
        borderRadius: 'var(--dsw-radius-md, 8px)', border: '1px solid var(--dsw-alias-border-l1)',
        background: 'var(--dsw-alias-bg-layer-1, transparent)', cursor: 'pointer', userSelect: 'none', outline: 'none',
      },
      rowActive: {
        borderColor: 'var(--dsw-alias-brand-primary)',
        background: 'var(--dsw-alias-bg-layer-2, rgba(127,127,127,0.10))',
        boxShadow: '0 0 0 1px var(--dsw-alias-brand-primary) inset',
      },
      rowMain: { display: 'flex', flexDirection: 'column', gap: '2px', flex: '1 1 auto', minWidth: 0 },
      rowName: { fontSize: '13px', fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
      rowSub: { fontSize: '11px', color: 'var(--dsw-alias-label-secondary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
      kindBadge: {
        flex: '0 0 auto', padding: '2px 8px', borderRadius: '999px', fontSize: '11px',
        background: 'var(--dsw-alias-bg-layer-2, rgba(127,127,127,0.16))', color: 'var(--dsw-alias-label-secondary)',
      },
      detailPane: {
        boxSizing: 'border-box', display: 'flex', flexDirection: 'column', gap: '10px', flex: '1 1 380px',
        minWidth: 0, minHeight: 0, overflowY: 'auto', padding: '4px 2px',
      },
      caption: { fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--dsw-alias-label-tertiary, #9aa0a6)' },
      detailTitle: { margin: 0, fontSize: '16px', fontWeight: 600 },
      field: { display: 'flex', flexDirection: 'column', gap: '4px' },
      fieldLabel: { fontSize: '12px', color: 'var(--dsw-alias-label-secondary)' },
      fieldValue: { fontSize: '13px', color: 'var(--dsw-alias-label-primary)', wordBreak: 'break-all' },
      actions: { display: 'flex', gap: '10px', flexWrap: 'wrap', marginTop: '4px' },
      form: { display: 'flex', flexDirection: 'column', gap: '10px', maxWidth: '520px' },
      auditRow: {
        display: 'flex', gap: '10px', alignItems: 'baseline', fontSize: '12px',
        padding: '6px 0', borderBottom: '1px solid var(--dsw-alias-border-l1)',
      },
      auditAt: { flex: '0 0 auto', color: 'var(--dsw-alias-label-secondary)', fontVariantNumeric: 'tabular-nums' },
      auditName: { flex: '0 0 auto', fontWeight: 600 },
      auditOutcome: { color: 'var(--dsw-alias-label-secondary)' },
      feedback: { fontSize: '12px', color: 'var(--dsw-alias-label-secondary)' },
      feedbackError: { fontSize: '12px', color: 'var(--dsw-alias-state-error-primary, #d14343)' },
    }

    function Icon() {
      return React.createElement(
        'span',
        { style: { display: 'inline-flex', width: '16px', height: '16px' } },
        React.createElement('svg', {
          viewBox: '0 0 24 24', width: '16', height: '16', fill: 'none', stroke: 'currentColor',
          strokeWidth: '1.8', strokeLinecap: 'round', strokeLinejoin: 'round',
        },
          React.createElement('rect', { x: '4', y: '10', width: '16', height: '10', rx: '2' }),
          React.createElement('path', { d: 'M8 10V7a4 4 0 0 1 8 0v3' }),
          React.createElement('circle', { cx: '12', cy: '15', r: '1.6', fill: 'currentColor', stroke: 'none' })),
      )
    }

    /* -------------------------------- page --------------------------------- */

    function Page({ t, back }) {
      const [entries, setEntries] = React.useState([])
      const [audit, setAudit] = React.useState([])
      const [selectedName, setSelectedName] = React.useState(null)
      const [editing, setEditing] = React.useState(null) // null | form initial; truthy opens the editor
      const [phase, setPhase] = React.useState('loading') // loading | idle | busy | error
      const [failure, setFailure] = React.useState(null)
      const [notice, setNotice] = React.useState(null)
      const [showAudit, setShowAudit] = React.useState(false)

      const reload = React.useCallback(async function () {
        setPhase((current) => (current === 'loading' ? 'loading' : 'busy'))
        try {
          const [listResult, auditResult] = await Promise.all([api(ROUTES.list), api(ROUTES.audit)])
          setEntries(listResult.entries || [])
          setAudit(auditResult.records || [])
          setPhase('idle')
          setFailure(null)
        } catch (error) {
          setPhase('error')
          setFailure(error instanceof Error ? error.message : String(error))
        }
      }, [])

      React.useEffect(function () { reload() }, [reload])

      function flash(message) {
        setNotice(message)
        window.setTimeout(() => setNotice(null), 3000)
      }

      async function save(form) {
        setPhase('busy')
        try {
          const result = await post(ROUTES.set, form)
          flash(result.updated ? t('updated') : t('created'))
          setEditing(null)
          await reload()
        } catch (error) {
          setPhase('error')
          setFailure(error instanceof Error ? error.message : String(error))
        }
      }

      async function remove(name) {
        if (!window.confirm(`${t('confirmDelete')}: ${name}?`)) return
        setPhase('busy')
        try {
          await post(ROUTES.remove, { name })
          if (selectedName === name) setSelectedName(null)
          flash(t('deleted'))
          await reload()
        } catch (error) {
          setPhase('error')
          setFailure(error instanceof Error ? error.message : String(error))
        }
      }

      async function rotate() {
        if (!window.confirm(t('rotateConfirm'))) return
        setPhase('busy')
        try {
          await post(ROUTES.rotate, {})
          flash(t('rotated'))
          await reload()
        } catch (error) {
          setPhase('error')
          setFailure(error instanceof Error ? error.message : String(error))
        }
      }

      const selected = entries.find((entry) => entry.name === selectedName) || null

      let feedback = null
      if (notice) feedback = React.createElement('span', { style: STYLE.feedback }, notice)
      else if (phase === 'loading') feedback = React.createElement('span', { style: STYLE.feedback }, t('loading'))
      else if (phase === 'error') {
        feedback = React.createElement('span', { style: STYLE.feedbackError }, `${t('error')}${failure ? ` (${failure})` : ''}`)
      }

      return React.createElement(
        'div', { style: STYLE.page },
        React.createElement(
          'div', { style: STYLE.header },
          React.createElement(
            'div', { style: STYLE.headerTop },
            React.createElement('h2', { style: STYLE.headerTitle }, t('title')),
            React.createElement(
              'div', { style: STYLE.headerActions },
              feedback,
              React.createElement('button', { type: 'button', style: PRIMARY_BUTTON, onClick: () => setEditing({}) }, t('add')),
              React.createElement('button', { type: 'button', style: GHOST_BUTTON, onClick: () => setShowAudit((v) => !v) }, t('audit')),
              React.createElement('button', { type: 'button', style: DANGER_BUTTON, onClick: rotate }, t('rotate')),
              React.createElement('button', { type: 'button', style: GHOST_BUTTON, onClick: reload }, t('refresh')),
              React.createElement('button', { type: 'button', style: GHOST_BUTTON, onClick: back }, t('back')),
            ),
          ),
          React.createElement('p', { style: STYLE.line }, t('hint')),
          React.createElement('p', { style: STYLE.line }, t('toolHint')),
        ),
        React.createElement(
          'div', { style: STYLE.body },
          React.createElement(
            'div', { style: STYLE.listPane },
            entries.length === 0
              ? React.createElement('p', { style: STYLE.listEmpty }, phase === 'loading' ? t('loading') : t('noEntries'))
              : entries.map((entry) => row(entry, entry.name === selectedName, () => {
                  setSelectedName(entry.name)
                  setEditing(null)
                })),
          ),
          React.createElement(
            'div', { style: STYLE.detailPane },
            editing !== null
              ? React.createElement(Editor, { t, initial: editing, busy: phase === 'busy', onSave: save, onCancel: () => setEditing(null) })
              : selected !== null
                ? React.createElement(Details, { t, entry: selected, onEdit: () => setEditing({ ...selected, secret: '' }), onDelete: () => remove(selected.name) })
                : null,
            showAudit ? React.createElement(AuditList, { t, records: audit }) : null,
          ),
        ),
      )
    }

    function row(entry, active, onClick) {
      return React.createElement(
        'div',
        {
          key: entry.name, style: active ? Object.assign({}, STYLE.row, STYLE.rowActive) : STYLE.row,
          role: 'button', tabIndex: 0, onClick,
          onKeyDown: (event) => { if (event.key === 'Enter' || event.key === ' ') onClick() },
        },
        React.createElement(
          'div', { style: STYLE.rowMain },
          React.createElement('span', { style: STYLE.rowName }, entry.name),
          React.createElement('span', { style: STYLE.rowSub }, KIND_LABELS[entry.kind] || entry.kind),
        ),
        React.createElement('span', { style: STYLE.kindBadge }, entry.preview || '***'),
      )
    }

    function Details({ t, entry, onEdit, onDelete }) {
      return React.createElement(
        React.Fragment, null,
        React.createElement('span', { style: STYLE.caption }, t('entries')),
        React.createElement('h3', { style: STYLE.detailTitle }, entry.name),
        React.createElement('span', { style: { ...STYLE.kindBadge, alignSelf: 'flex-start' } }, KIND_LABELS[entry.kind] || entry.kind),
        field('preview', t('masked'), entry.preview || '***'),
        entry.username ? field('username', t('username'), entry.username) : null,
        entry.url ? field('url', t('url'), entry.url) : null,
        entry.note ? field('note', t('note'), entry.note) : null,
        field('updatedAt', t('updatedAt'), entry.updatedAt || '—'),
        React.createElement(
          'div', { style: STYLE.actions },
          React.createElement('button', { type: 'button', style: PRIMARY_BUTTON, onClick: onEdit }, t('edit')),
          React.createElement('button', { type: 'button', style: DANGER_BUTTON, onClick: onDelete }, t('delete')),
        ),
      )
    }

    function field(key, label, value) {
      return React.createElement(
        'div', { key, style: STYLE.field },
        React.createElement('span', { style: STYLE.fieldLabel }, label),
        React.createElement('span', { style: STYLE.fieldValue }, value),
      )
    }

    function Editor({ t, initial, busy, onSave, onCancel }) {
      // Editing an existing entry keeps its stored secret when the field is empty.
      const isUpdate = Boolean(initial && initial.name && initial.updatedAt)
      const [form, setForm] = React.useState({
        name: initial.name || '',
        kind: KINDS.includes(initial.kind) ? initial.kind : 'other',
        secret: '',
        username: initial.username || '',
        url: initial.url || '',
        note: initial.note || '',
      })
      function bind(key) {
        return {
          value: form[key],
          onChange: (event) => setForm((current) => ({ ...current, [key]: event.target.value })),
        }
      }
      const canSave = form.name.trim().length > 0 && (form.secret.length > 0 || isUpdate)
      return React.createElement(
        'form', {
          style: STYLE.form,
          onSubmit: (event) => {
            event.preventDefault()
            if (canSave) onSave({ ...form, name: form.name.trim() })
          },
        },
        React.createElement('span', { style: STYLE.caption }, isUpdate ? t('edit') : t('add')),
        React.createElement('label', { style: STYLE.field },
          React.createElement('span', { style: STYLE.fieldLabel }, t('name')),
          React.createElement('input', { style: INPUT, placeholder: t('namePlaceholder'), autoFocus: true, ...bind('name') })),
        React.createElement('label', { style: STYLE.field },
          React.createElement('span', { style: STYLE.fieldLabel }, t('kind')),
          React.createElement('select', { style: INPUT, ...bind('kind') },
            KINDS.map((kind) => React.createElement('option', { key: kind, value: kind }, KIND_LABELS[kind] || kind)))),
        React.createElement('label', { style: STYLE.field },
          React.createElement('span', { style: STYLE.fieldLabel }, isUpdate ? `${t('secret')} · ${t('masked')}` : t('secret')),
          React.createElement('input', { style: INPUT, type: 'password', placeholder: isUpdate ? '\u2022\u2022\u2022\u2022' : t('secretPlaceholder'), autoComplete: 'off', ...bind('secret') })),
        React.createElement('label', { style: STYLE.field },
          React.createElement('span', { style: STYLE.fieldLabel }, t('username')),
          React.createElement('input', { style: INPUT, ...bind('username') })),
        React.createElement('label', { style: STYLE.field },
          React.createElement('span', { style: STYLE.fieldLabel }, t('url')),
          React.createElement('input', { style: INPUT, ...bind('url') })),
        React.createElement('label', { style: STYLE.field },
          React.createElement('span', { style: STYLE.fieldLabel }, t('note')),
          React.createElement('input', { style: INPUT, ...bind('note') })),
        React.createElement(
          'div', { style: STYLE.actions },
          React.createElement('button', { type: 'submit', style: canSave && !busy ? PRIMARY_BUTTON : GHOST_BUTTON, disabled: !canSave || busy }, t('save')),
          React.createElement('button', { type: 'button', style: GHOST_BUTTON, onClick: onCancel }, t('cancel')),
        ),
      )
    }

    function AuditList({ t, records }) {
      return React.createElement(
        'div', { style: { display: 'flex', flexDirection: 'column', marginTop: '8px' } },
        React.createElement('span', { style: STYLE.caption }, t('audit')),
        records.length === 0
          ? React.createElement('p', { style: STYLE.listEmpty }, t('auditEmpty'))
          : records.map((record, index) =>
              React.createElement(
                'div', { key: index, style: STYLE.auditRow },
                React.createElement('span', { style: STYLE.auditAt }, record.at || '\u2014'),
                React.createElement('span', { style: STYLE.auditName }, record.name || '\u2014'),
                React.createElement('span', { style: STYLE.auditOutcome }, `${record.outcome} \u00b7 ${record.source || ''}`),
              )),
      )
    }

    /* -------------------------------- locale ------------------------------- */

    const zh = {
      panel: '凭据保险库',
      title: '凭据保险库',
      hint: '凭据以 AES-256-GCM 加密保存在 $DSH_HOME/credential-vault/，面板只显示掩码预览，永不回传明文。',
      toolHint: 'AI 通过 credential 工具按名称读取凭据；每一次读取明文都会记入使用日志。',
      loading: '正在读取凭据…',
      saving: '正在保存…',
      error: '操作失败',
      refresh: '刷新',
      back: '返回对话',
      noEntries: '还没有保存的凭据。点击「新增凭据」添加第一条。',
      add: '新增凭据',
      name: '名称',
      namePlaceholder: '例如 github-token、prod-server',
      kind: '类型',
      secret: '凭据值',
      secretPlaceholder: '密码 / token / API key',
      username: '用户名（可选）',
      url: '地址（可选）',
      note: '备注（可选）',
      save: '保存',
      cancel: '取消',
      edit: '编辑',
      delete: '删除',
      confirmDelete: '确认删除凭据',
      rotate: '轮换主密钥',
      rotateConfirm: '确认轮换主密钥？所有凭据将重新加密，旧密钥备份为 master.key.bak。',
      rotated: '已轮换主密钥，重新加密',
      entries: '凭据',
      audit: '使用日志',
      auditEmpty: '还没有读取记录。',
      updatedAt: '更新于',
      updated: '已更新',
      created: '已创建',
      deleted: '已删除',
      masked: '掩码',
      'kinds.password': '服务器密码',
      'kinds.token': 'Token',
      'kinds.api-key': 'API Key',
      'kinds.ssh-key': 'SSH 密钥',
      'kinds.other': '其他',
    }

    const en = {
      panel: 'Credential vault',
      title: 'Credential vault',
      hint: 'Credentials are stored AES-256-GCM encrypted under $DSH_HOME/credential-vault/. The panel shows masked previews only and never returns plaintext.',
      toolHint: 'The model reads credentials by name through the `credential` tool; every plaintext reveal is written to the audit log.',
      loading: 'Loading credentials…',
      saving: 'Saving…',
      error: 'Operation failed',
      refresh: 'Refresh',
      back: 'Back to chat',
      noEntries: 'No credentials yet. Click "Add credential" to create the first one.',
      add: 'Add credential',
      name: 'Name',
      namePlaceholder: 'e.g. github-token, prod-server',
      kind: 'Kind',
      secret: 'Secret',
      secretPlaceholder: 'password / token / API key',
      username: 'Username (optional)',
      url: 'URL (optional)',
      note: 'Note (optional)',
      save: 'Save',
      cancel: 'Cancel',
      edit: 'Edit',
      delete: 'Delete',
      confirmDelete: 'Delete credential',
      rotate: 'Rotate master key',
      rotateConfirm: 'Rotate the master key? Every entry is re-encrypted; the old key is kept as master.key.bak.',
      rotated: 'Master key rotated, entries re-encrypted',
      entries: 'Credentials',
      audit: 'Audit log',
      auditEmpty: 'No reads recorded yet.',
      updatedAt: 'Updated',
      updated: 'Updated',
      created: 'Created',
      deleted: 'Deleted',
      masked: 'masked',
      'kinds.password': 'Server password',
      'kinds.token': 'Token',
      'kinds.api-key': 'API key',
      'kinds.ssh-key': 'SSH key',
      'kinds.other': 'Other',
    }

    /* ------------------------------- wiring ------------------------------- */

    /**
     * No sidebar row and no main panel any more: the vault is a section of
     * dsh-inventory's Tools page — the `credential` tool is in the tool list, so
     * the entries it reads are managed right there. This factory keeps only the
     * shared strings for that section (`credential-vault` namespace).
     */
    function apply(ctx) {
      ctx.effect(function () {
        return ctx.locale.register(NS, { zh, en })
      })
    }

    return {
      name: 'dsh-credential-vault',
      inject: ['slots', 'locale', 'layout'],
      apply,
    }
  },
})
