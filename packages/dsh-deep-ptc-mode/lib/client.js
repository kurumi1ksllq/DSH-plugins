window.__ModuleLoader__.load({ id: 'dsh-deep-ptc-mode', factory: require => {
  const React = require('react');
  const h = React.createElement;
  const NS = 'deep-ptc-settings';
  const inject = ['slots', 'locale', 'configForms'];
  const dictionaries = {
    zh: {
      title: '深度 PTC', summary: '选择执行环境，应用于之后新建的深度 PTC 会话。',
      environment: '执行环境', auto: '自动（Windows：PowerShell；macOS：Zsh；Linux：Bash）',
      wsl: 'WSL Bash（Windows）', powershell: 'PowerShell（Windows）',
      'git-bash': 'Git Bash（Windows）',
      zsh: 'Zsh（macOS / Linux）', bash: '原生 Bash（macOS / Linux）',
      distribution: 'WSL 发行版', distributionHint: '留空使用 Windows 的默认发行版，例如 Ubuntu。',
      sessions: '保存后请新建一个“深度PTC模式”会话。已有会话与后台任务保留原环境。',
      wslHint: 'WSL 暂不支持 Windows 的受限沙箱；受限调用会明确失败，不会自动切换或绕过限制。',
      save: '保存', saving: '保存中…', saved: '已保存，新会话将使用所选环境。',
      failed: '未能保存，请检查环境是否适用于宿主、发行版名称及配置是否已被其他窗口修改。',
      readOnly: '当前设置为只读。', loading: '正在读取设置…',
    },
    en: {
      title: 'Deep PTC', summary: 'Choose the execution environment for new Deep PTC sessions.',
      environment: 'Execution environment', auto: 'Automatic (Windows: PowerShell; macOS: Zsh; Linux: Bash)',
      wsl: 'WSL Bash (Windows)', powershell: 'PowerShell (Windows)',
      'git-bash': 'Git Bash (Windows)',
      zsh: 'Zsh (macOS / Linux)', bash: 'Native Bash (macOS / Linux)',
      distribution: 'WSL distribution', distributionHint: 'Leave blank for the Windows default distribution, for example Ubuntu.',
      sessions: 'After saving, create a new Deep PTC session. Existing sessions and background jobs keep their environment.',
      wslHint: 'WSL does not support the confined Windows sandbox. Confined calls fail without execution or fallback.',
      save: 'Save', saving: 'Saving…', saved: 'Saved. New sessions will use this environment.',
      failed: 'Could not save. Check host compatibility, distribution name, and concurrent configuration changes.',
      readOnly: 'Settings are read-only.', loading: 'Loading settings…',
    },
  };

  function Card({ view, form, t }) {
    const subscribe = React.useCallback(listener => form.subscribe(listener), [form]);
    const read = React.useCallback(() => form.getSnapshot(), [form]);
    const state = React.useSyncExternalStore(subscribe, read, read);
    const [environment, setEnvironment] = React.useState('auto');
    const [distribution, setDistribution] = React.useState('');
    const [saving, setSaving] = React.useState(false);
    const [message, setMessage] = React.useState('');
    const [failed, setFailed] = React.useState(false);
    const draftRevision = React.useRef();
    const dirty = React.useRef(false);
    React.useEffect(() => {
      if (!state.value || dirty.current) return;
      setEnvironment(state.value.environment);
      setDistribution(state.value.wslDistribution ?? '');
      draftRevision.current = state.revision;
    }, [state.value, state.revision]);
    if (view === 'summary') return t('summary');
    if (state.status !== 'ready') return h('p', null, t('loading'));
    // T4.ptc: mirrors availableEnvironments() — keep in sync with model.mjs.
    const allowed = state.value.hostPlatform === 'win32'
      ? ['auto', 'wsl', 'powershell', 'git-bash'] : ['auto', 'zsh', 'bash'];
    const disabled = !state.writable || saving;
    const changed = () => {
      if (!dirty.current) draftRevision.current = state.revision;
      dirty.current = true;
      setMessage('');
    };
    async function save(event) {
      event.preventDefault();
      setSaving(true); setMessage(''); setFailed(false);
      try {
        const ok = await form.mutate([
          { op: 'set', path: ['environment'], value: environment },
          { op: 'set', path: ['wslDistribution'], value: distribution.trim() },
        ], draftRevision.current);
        if (!ok) throw new Error('Configuration was rejected');
        dirty.current = false;
        const latest = form.getSnapshot();
        draftRevision.current = latest.revision;
        setEnvironment(latest.value?.environment ?? environment);
        setDistribution(latest.value?.wslDistribution ?? distribution.trim());
        setMessage(t('saved'));
      } catch {
        draftRevision.current = form.getSnapshot().revision;
        setFailed(true); setMessage(t('failed'));
      } finally { setSaving(false); }
    }
    const control = { width: '100%', padding: '8px 10px', borderRadius: '6px',
      color: 'inherit', background: 'var(--dsw-alias-bg-base)', border: '1px solid var(--dsw-alias-border-l1)' };
    return h('form', { onSubmit: save, style: { display: 'grid', gap: '12px', maxWidth: '600px' } },
      h('label', { htmlFor: 'deep-ptc-environment' }, t('environment')),
      h('select', { id: 'deep-ptc-environment', value: environment, disabled, style: control,
        onChange: event => { changed(); setEnvironment(event.target.value); } },
      ...['auto', 'wsl', 'powershell', 'git-bash', 'zsh', 'bash'].map(value =>
        h('option', { key: value, value, disabled: !allowed.includes(value) }, t(value)))),
      environment === 'wsl' ? h(React.Fragment, null,
        h('label', { htmlFor: 'deep-ptc-distribution' }, t('distribution')),
        h('input', { id: 'deep-ptc-distribution', value: distribution, disabled, style: control,
          onChange: event => { changed(); setDistribution(event.target.value); } }),
        h('p', null, t('distributionHint')), h('p', null, t('wslHint'))) : null,
      h('p', null, t('sessions')),
      !state.writable ? h('p', { role: 'status' }, t('readOnly')) : null,
      message ? h('p', { role: failed ? 'alert' : 'status' }, message) : null,
      h('button', { type: 'submit', disabled, style: { justifySelf: 'start', padding: '7px 16px' } }, t(saving ? 'saving' : 'save')),
    );
  }

  function ToolStateControls({ useProjection, reset, t }) {
    const preset = useProjection('agentPreset');
    const state = useProjection('deepPtcTools');
    const [busy, setBusy] = React.useState(false);
    const [message, setMessage] = React.useState('');
    const generation = React.useRef(0);
    React.useEffect(() => { generation.current++; setBusy(false); setMessage(''); return () => { generation.current++; }; }, [reset]);
    if (preset !== 'deep-ptc' || !state) return null;
    const failed = state?.report?.tools ?? [];
    async function reload() {
      const current = generation.current;
      setBusy(true); setMessage('');
      try {
        const outcome = await reset();
        if (current !== generation.current) return;
        if (outcome?.ok === false) throw new Error(outcome.error?.message || t('toolResetFailed'));
        const reply = outcome?.ok === true ? outcome.value : outcome;
        const result = reply?.result ?? reply;
        if (result?.kind !== 'success') throw new Error(result?.text || t('toolResetFailed'));
        setMessage(t('toolResetDone'));
      } catch (error) { if (current === generation.current) setMessage(t('toolResetFailed') + ': ' + String(error?.message ?? error).slice(0,220)); }
      finally { if (current === generation.current) setBusy(false); }
    }
    return h('div', { style: { display: 'grid', gap: '4px', padding: '4px 0', fontSize: '12px' } },
      failed.length ? h('details', { role: 'status' },
        h('summary', null, `${t('toolFailures')} (${failed.length})`),
        h('p', null, t('toolFailureHint')),
        h('ul', null, ...failed.map(row => h('li', { key: row.name }, `${row.name} — ${row.provider}`)))) : null,
      h('button', { type: 'button', onClick: reload, disabled: busy, title: t('toolResetHint'),
        style: { justifySelf: 'start', font: 'inherit', color: 'inherit', cursor: busy ? 'wait' : 'pointer' } }, busy ? t('toolResetBusy') : t('toolReset')),
      message ? h('span', { role: 'status' }, message) : null);
  }
  Object.assign(dictionaries.zh, {
    toolReset: '重载所有工具状态', toolResetBusy: '正在重载…', toolResetDone: '本对话工具状态已重载。',
    toolResetFailed: '重载失败，请确认当前连接及操作权限。', toolResetHint: '清除本对话的故障标记和按需加载选择；正在运行的任务继续执行。',
    toolFailures: '工具适配提醒', toolFailureHint: '以下外部工具调用失败，可能存在适配问题，已在本对话中禁用。任务会优先使用其他可用工具；未进一步排查故障原因。',
  });
  Object.assign(dictionaries.en, {
    toolReset: 'Reload all tool states', toolResetBusy: 'Reloading…', toolResetDone: 'Tool states reloaded for this conversation.',
    toolResetFailed: 'Reload failed. Check the connection and access permissions.', toolResetHint: 'Clear quarantine and on-demand selections in this conversation. Running jobs continue.',
    toolFailures: 'Tool compatibility notice', toolFailureHint: 'These external tools failed and may have compatibility issues. They are disabled in this conversation. Continue with working alternatives; no root-cause investigation was performed.',
  });
  function apply(ctx) {
    const t = ctx.locale.bind('deep-ptc');
    ctx.effect(() => ctx.locale.register('deep-ptc', dictionaries));
    const form = ctx.configForms.get(NS);
    ctx.effect(() => ctx.configForms.whileServed([NS], () =>
      ctx.slots.inject('plugins.item', () => ctx.slots.register({
        name: 'plugins.item', id: 'deep-ptc', order: 41,
        label: () => t('title'), locale: 'deep-ptc',
      }, props => h(Card, { ...props, form, t })))));
    ctx.inject?.(['remote', 'remote.commands'], child => child.slots.inject('conversation.composer.dock', () => child.slots.register({
      name: 'conversation.composer.dock', id: 'deep-ptc-tool-states', order: 90,
      inject: sessionId => ({ reset: () => child.remote.commands.execute(sessionId, '/deep-ptc-reset-tools', []) }),
    }, props => h(ToolStateControls, { ...props, t }))));
  }
  return { apply, inject };
} });
// ---- 吸收自 dsh-stall-governor 的客户端半区(#112):「失速治理」设置页签 ----
// 单文件双 ModuleLoader.load:宿主把每个 dsh.client 文件原样拼接执行,
// 本文件先后注册 dsh-deep-ptc-mode 与 dsh-stall-governor 两个模块(各带自己的壳)。
// 壳内必须保持 { id, factory } 完整形态,不可顶层 return。
window.__ModuleLoader__.load({
  id: 'dsh-stall-governor',
  factory: function (require) {
    var module = { exports: {} }
    var exports = module.exports
    var React = require('react')
    var h = React.createElement

    var THEME = {
      surface: 'var(--dsw-alias-bg-layer-1, #23262e)',
      surfaceRaised: 'var(--dsw-alias-bg-layer-2, #2b2f38)',
      border: 'var(--dsw-alias-border-l1, #3a3f4b)',
      borderStrong: 'var(--dsw-alias-border-l2, #4a5160)',
      text: 'var(--dsw-alias-label-primary, #e6e8ee)',
      textSecondary: 'var(--dsw-alias-label-secondary, #a8adba)',
      textTertiary: 'var(--dsw-alias-label-tertiary, #7d8391)',
      accent: 'var(--dsw-alias-brand-primary, #4a9eff)',
      accentInverted: 'var(--dsw-alias-brand-primary-invert, #ffffff)',
      danger: 'var(--dsw-alias-state-error-primary, #e0524a)',
      success: 'var(--dsw-alias-state-success-primary, #3f9d5a)'
    }

    var SETTINGS_API = '/plugins/stall-governor/settings'

    function numberInputStyle() {
      return {
        width: 110,
        padding: '4px 8px',
        background: THEME.surfaceRaised,
        color: THEME.text,
        border: '1px solid ' + THEME.borderStrong,
        borderRadius: 4
      }
    }

    function textInputStyle() {
      return {
        width: '100%',
        maxWidth: 380,
        padding: '4px 8px',
        background: THEME.surfaceRaised,
        color: THEME.text,
        border: '1px solid ' + THEME.borderStrong,
        borderRadius: 4
      }
    }

    function selectStyle() {
      return {
        padding: '4px 8px',
        background: THEME.surfaceRaised,
        color: THEME.text,
        border: '1px solid ' + THEME.borderStrong,
        borderRadius: 4
      }
    }

    function primaryButtonStyle() {
      return {
        padding: '6px 16px',
        background: THEME.accent,
        color: THEME.accentInverted,
        border: 'none',
        borderRadius: 4,
        cursor: 'pointer'
      }
    }

    function secondaryButtonStyle() {
      return {
        padding: '6px 16px',
        background: THEME.surfaceRaised,
        color: THEME.text,
        border: '1px solid ' + THEME.borderStrong,
        borderRadius: 4,
        cursor: 'pointer'
      }
    }

    function checkboxStyle() {
      return { width: 16, height: 16, cursor: 'pointer', accentColor: THEME.accent }
    }

    /** 多选项取值归一为数组（notifyChannels 等）。 */
    function asArray(value) {
      return Array.isArray(value) ? value.slice() : []
    }

    /** 单个 schema 项的控件（boolean/number/text/select/multi-select）。 */
    function Control(props) {
      var spec = props.spec
      var value = props.value
      var onChange = props.onChange
      var type = spec.type || 'text'

      if (type === 'boolean') {
        return h('input', {
          type: 'checkbox',
          checked: value === true,
          style: checkboxStyle(),
          onChange: function (e) { onChange(e.target.checked) }
        })
      }

      if (type === 'number') {
        return h('input', {
          type: 'number',
          value: value === undefined || value === null ? '' : String(value),
          min: spec.min,
          max: spec.max,
          style: numberInputStyle(),
          onChange: function (e) {
            var raw = e.target.value
            onChange(raw === '' ? '' : Number(raw))
          }
        })
      }

      if (type === 'select') {
        var options = spec.options || []
        var expOpts = spec.experimentalOptions || []
        var isExperimental = expOpts.indexOf(value) >= 0
        var expWarn = null
        if (isExperimental) {
          expWarn = h('div', {
            style: {
              margin: '4px 0 0',
              fontSize: 12,
              color: THEME.danger,
              border: '1px solid ' + THEME.danger,
              borderRadius: 4,
              padding: '4px 8px',
              background: 'var(--dsw-alias-state-error-bg, rgba(224,82,74,0.12))'
            }
          }, (spec.experimentalNote || '') + ' 当前为实验性强制档，未经影子期零误杀验证，请勿用于生产拦截。')
        }
        return h(
          'div',
          { style: { display: 'flex', flexDirection: 'column' } },
          [
            h(
              'select',
              {
                value: value === undefined || value === null ? '' : String(value),
                style: isExperimental ? Object.assign(selectStyle(), { borderColor: THEME.danger }) : selectStyle(),
                onChange: function (e) { onChange(e.target.value) }
              },
              options.map(function (opt) {
                var val = opt && typeof opt === 'object' ? opt.value : opt
                var lab = opt && typeof opt === 'object' && opt.label ? opt.label : opt
                return h('option', { key: val, value: val }, lab)
              })
            ),
            expWarn
          ]
        )
      }

      if (type === 'multi-select') {
        var options2 = spec.options || []
        var selected = asArray(value)
        return h(
          'div',
          { style: { display: 'flex', flexWrap: 'wrap', gap: 12 } },
          options2.map(function (opt) {
            var val = opt && typeof opt === 'object' ? opt.value : opt
            var lab = opt && typeof opt === 'object' && opt.label ? opt.label : opt
            return h(
              'label',
              {
                key: val,
                style: {
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 6,
                  color: THEME.text,
                  cursor: 'pointer'
                }
              },
              [
                h('input', {
                  key: 'c',
                  type: 'checkbox',
                  checked: selected.indexOf(val) >= 0,
                  style: checkboxStyle(),
                  onChange: function (e) {
                    var next = asArray(value)
                    var idx = next.indexOf(val)
                    if (e.target.checked) {
                      if (idx < 0) next.push(val)
                    } else if (idx >= 0) {
                      next.splice(idx, 1)
                    }
                    onChange(next)
                  }
                }),
                h('span', { key: 't' }, lab)
              ]
            )
          })
        )
      }

      return h('input', {
        type: 'text',
        value: value === undefined || value === null ? '' : String(value),
        style: textInputStyle(),
        onChange: function (e) { onChange(e.target.value) }
      })
    }

    /** 按 group 归并 schema（保持首次出现顺序）。 */
    function collectGroups(schema) {
      var groups = []
      var index = {}
      for (var i = 0; i < schema.length; i++) {
        var spec = schema[i]
        var name = spec.group || '其他'
        if (!index[name]) {
          index[name] = { name: name, items: [] }
          groups.push(index[name])
        }
        index[name].items.push(spec)
      }
      return groups
    }

    function StallGovernorPanel() {
      var payloadState = React.useState(null)
      var payload = payloadState[0]
      var setPayload = payloadState[1]

      var draftState = React.useState({})
      var draft = draftState[0]
      var setDraft = draftState[1]

      var loadingState = React.useState(true)
      var loading = loadingState[0]
      var setLoading = loadingState[1]

      var savingState = React.useState(false)
      var saving = savingState[0]
      var setSaving = savingState[1]

      var noticeState = React.useState('')
      var notice = noticeState[0]
      var setNotice = noticeState[1]

      var errorState = React.useState('')
      var errorMessage = errorState[0]
      var setErrorMessage = errorState[1]

      function load() {
        fetch(SETTINGS_API)
          .then(function (res) { return res.json() })
          .then(function (body) {
            if (!body || body.ok !== true) {
              setErrorMessage('读取设置失败：' + ((body && body.error) || '未知错误'))
            } else {
              setPayload(body)
              setDraft(Object.assign({}, body.settings))
              setErrorMessage('')
            }
            setLoading(false)
          })
          .catch(function (err) {
            setErrorMessage('读取设置失败：' + (err && err.message ? err.message : String(err)))
            setLoading(false)
          })
      }

      React.useEffect(load, [])

      function persist() {
        setSaving(true)
        setNotice('')
        fetch(SETTINGS_API, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ settings: draft })
        })
          .then(function (res) { return res.json() })
          .then(function (body) {
            if (!body || body.ok !== true) {
              setErrorMessage('保存失败：' + ((body && body.error) || '未知错误'))
              return
            }
            setErrorMessage('')
            setDraft(Object.assign({}, body.settings))
            setPayload(function (prev) {
              return Object.assign({}, prev, { settings: body.settings })
            })
            setNotice(
              body.saved === false ? '已生效，但写入配置文件失败（重启后会恢复）' : '已保存并即时生效'
            )
          })
          .catch(function (err) {
            setErrorMessage('保存失败：' + (err && err.message ? err.message : String(err)))
          })
          .then(function () { setSaving(false) })
      }

      if (loading) {
        return h('div', { style: { padding: 16, color: THEME.textSecondary } }, '正在读取设置…')
      }
      if (!payload) {
        return h('div', { style: { padding: 16, color: THEME.danger } }, errorMessage || '设置不可用')
      }

      var schema = payload.schema || []
      var groups = collectGroups(schema)
      var dirty = JSON.stringify(draft) !== JSON.stringify(payload.settings || {})

      function renderRow(spec) {
        return h(
          'div',
          {
            key: spec.key,
            style: { display: 'flex', alignItems: 'flex-start', gap: 12, padding: '6px 0' }
          },
          [
            h('div', { key: 'l', style: { width: 220, flexShrink: 0 } }, [
              h('div', { key: 'n', style: { fontSize: 13, color: THEME.text } }, spec.label || spec.key),
              h(
                'div',
                {
                  key: 'sk',
                  style: {
                    fontSize: 10,
                    color: THEME.textTertiary,
                    marginTop: 1,
                    fontFamily: 'monospace'
                  }
                },
                '源码键：' + spec.key
              ),
              spec.hint
                ? h(
                    'div',
                    {
                      key: 'h',
                      style: {
                        fontSize: 11,
                        color: THEME.textTertiary,
                        marginTop: 2,
                        lineHeight: 1.6
                      }
                    },
                    spec.hint
                  )
                : null
            ]),
            h(
              'div',
              { key: 'c', style: { flex: 1, paddingTop: 2 } },
              h(Control, {
                spec: spec,
                value: draft[spec.key],
                onChange: function (v) {
                  setDraft(function (prev) {
                    var next = Object.assign({}, prev)
                    next[spec.key] = v
                    return next
                  })
                  setNotice('')
                }
              })
            )
          ]
        )
      }

      function renderGroupBody(group) {
        var normal = []
        var advanced = []
        group.items.forEach(function (spec) {
          if (spec.advanced === true) advanced.push(spec)
          else normal.push(spec)
        })
        var out = normal.map(renderRow)
        if (advanced.length) {
          out.push(
            h(
              'details',
              { key: group.name + '-adv', style: { padding: '4px 0' } },
              h(
                'summary',
                {
                  style: {
                    fontSize: 12,
                    color: THEME.textSecondary,
                    cursor: 'pointer',
                    userSelect: 'none',
                    padding: '4px 0'
                  }
                },
                '高级参数（' + advanced.length + ' 项）'
              ),
              h('div', { style: { borderTop: '1px solid ' + THEME.border, marginTop: 4 } }, advanced.map(renderRow))
            )
          )
        }
        return out
      }

      var children = []

      // 能力横幅 —— 把「当前内核是否有掐断能力」直接摆在设置页顶部(源自 cot-anchor 客户端)。
      // 三态如实上报:present / absent / unknown;absent 不伪造生效(0.1.5-rc.3 静默失效事故)。
      function renderCapabilityBanner() {
        var capabilities = payload.capabilities || {}
        var state = capabilities.softCut
        if (!state) return null
        var config
        if (state === 'present') {
          config = {
            color: THEME.success,
            title: '生成中途截停：可用',
            body: '当前内核支持在模型输出到一半时叫停，因此「打断判定」里的每一项都能真正生效。'
          }
        } else if (state === 'absent') {
          config = {
            color: THEME.danger,
            title: '生成中途截停：当前内核不具备',
            body: '当前内核没法在输出到一半时叫停模型，所以「打断判定」区的选项这次都不会生效：' +
              '模型打转、或把工具调用直接写成文本时，都不会被自动拦下，只能由你手动中断。' +
              '「工具参数错误恢复指引」与「命令执行纪律段」不依赖这个能力，照常工作。'
          }
        } else {
          config = {
            color: THEME.textSecondary,
            title: '生成中途截停：暂时无法确认',
            body: '没能读到内核信息来判断中途叫停是否可用。如果它确实不可用，「打断判定」区的选项会' +
              '悄悄不起作用；请以实际表现是否被打断为准。'
          }
        }
        return h(
          'div',
          {
            style: {
              border: '1px solid ' + config.color,
              borderRadius: 6,
              padding: '8px 12px',
              marginBottom: 12,
              fontSize: 12,
              lineHeight: 1.6
            }
          },
          h('div', { style: { color: config.color, fontWeight: 600, marginBottom: 2 } }, config.title),
          h('div', { style: { color: THEME.textSecondary } }, config.body)
        )
      }


      children.push(renderCapabilityBanner())


      children.push(
        h('div', { key: 'head', style: { marginBottom: 14 } }, [
          h('div', { key: 't', style: { fontSize: 14, fontWeight: 600 } }, '失速治理'),
          h(
            'div',
            {
              key: 'd',
              style: { fontSize: 12, color: THEME.textTertiary, marginTop: 4, lineHeight: 1.7 }
            },
            '单包双引擎：「跨步骤」引擎盯 AI 整回合无产出(连续空转/结论重推)与某次工具调用反复失败;' +
              '「单流内」引擎盯模型生成中的打转、伪工具调用与数字流退化,并附带命令执行纪律段与' +
              '工具参数错误恢复指引。默认「仅观测不拦截」，先只记录不打扰，确认不会误伤后再逐步加码。'
          )
        ])
      )

      groups.forEach(function (group, gi) {
        children.push(
          h('div', { key: 'g' + gi, style: { marginBottom: 14 } }, [
            h(
              'div',
              {
                key: 'h',
                style: {
                  fontSize: 12,
                  fontWeight: 600,
                  color: THEME.textSecondary,
                  marginBottom: 6,
                  paddingBottom: 4,
                  borderBottom: '1px solid ' + THEME.border
                }
              },
              group.name
            ),
            h(
              'div',
              { key: 'b' },
              renderGroupBody(group)
            )
          ])
        )
      })

      children.push(
        h(
          'div',
          {
            key: 'foot',
            style: {
              display: 'flex',
              alignItems: 'center',
              flexWrap: 'wrap',
              gap: 12,
              marginTop: 8,
              paddingTop: 12,
              borderTop: '1px solid ' + THEME.border
            }
          },
          [
            h(
              'button',
              {
                key: 's',
                style: primaryButtonStyle(),
                disabled: saving,
                onClick: persist
              },
              saving ? '保存中…' : '保存并即时生效'
            ),
            h(
              'button',
              {
                key: 'r',
                style: secondaryButtonStyle(),
                onClick: function () {
                  load()
                  setNotice('')
                }
              },
              '重新读取'
            ),
            dirty
              ? h(
                  'span',
                  { key: 'd', style: { fontSize: 12, color: THEME.textTertiary } },
                  '有未保存的改动'
                )
              : null,
            notice
              ? h('span', { key: 'n', style: { fontSize: 12, color: THEME.success } }, notice)
              : null,
            errorMessage
              ? h('span', { key: 'e', style: { fontSize: 12, color: THEME.danger } }, errorMessage)
              : null,
            payload.persisted === false
              ? h(
                  'span',
                  { key: 'p', style: { fontSize: 12, color: THEME.textTertiary } },
                  '（配置文件缺失或损坏，当前用默认值 + env 启动）'
                )
              : null
          ]
        )
      )

      return h('div', { style: { color: THEME.text } }, children)
    }

    function apply(ctx) {
      var slots = ctx.slots

      slots.inject('settings.section', function () {
        slots.register(
          { name: 'settings.section', id: 'stall-governor', label: '失速治理', order: 997 },
          StallGovernorPanel
        )
      })
    }

    exports.inject = ['slots']
    exports.apply = apply
    return module.exports
  }
})
