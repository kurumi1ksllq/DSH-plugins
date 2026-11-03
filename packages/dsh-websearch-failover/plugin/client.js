/**
 * dsh-websearch-failover — browser half of the DSH bundle.
 *
 * Loaded by the Harness web app through `window.__ModuleLoader__`. The provider
 * manager is no longer a sidebar panel of its own: dsh-inventory's Tools page
 * lists the registered providers in call priority order, shows each one's
 * remaining balance and reorders them. The top provider is consumed first; the
 * host engine falls over to the next one when quota runs out.
 *
 * What stays here the shared strings for that section (`websearch-failover`
 * locale namespace) and the host half contract below.
 *
 * Host half contract (already fixed), base `/websearch-failover/api`:
 *   GET  ${base}/state                       -> {ok, generatedAt, providers:[...]}
 *   POST ${base}/order    {order:[id,...]}   -> same state payload
 *   POST ${base}/refresh  {ids?:[id,...]}    -> same state payload
 *   POST ${base}/enable   {id, enabled}      -> same state payload
 *
 * Only `react` is required from the module loader; every other capability
 * (`slots`, `locale`, `layout`) arrives through the injected Cordis context.
 * No JSX, no build step, no external stylesheet: `React.createElement` only,
 * inline styles with `var(--dsw-alias-*)` tokens so light/dark themes both work.
 */
window.__ModuleLoader__.load({
  id: 'dsh-websearch-failover',
  factory(require) {
    const React = require('react')

    const NS = 'websearch-failover'
    const SIDEBAR_SLOT = 'sidebar.panellist'
    const MAIN_SLOT = 'main'
    const SIDEBAR_ORDER = 30

    const ROUTES = {
      state: '/websearch-failover/api/state',
      order: '/websearch-failover/api/order',
      refresh: '/websearch-failover/api/refresh',
      enable: '/websearch-failover/api/enable',
    }

    const zh = {
      panel: 'Web 搜索提供方',
      title: 'Web 搜索提供方',
      hint: '余额按各家接口返回的比例显示，接口没有余额字段时给出中性提示。',
      priorityHint: '顺序即调用优先级：排在最上面的提供方最先被调用，额度耗尽或报错时自动切到下一家。',
      rank: '优先级',
      refresh: '刷新余额',
      refreshing: '正在刷新余额…',
      loading: '正在读取提供方状态…',
      saving: '正在保存顺序…',
      error: '操作失败',
      back: '返回对话',
      unknownBalance: '未提供余额接口',
      enable: '启用',
      disable: '停用',
      calls: '调用次数',
      successes: '成功',
      failures: '失败',
      lastUsed: '最近调用',
      cooldown: '冷却中',
      key: '密钥',
      keyPresent: '已配置密钥',
      keyMissing: '未配置密钥',
      selected: '提供方详情',
      noProviders: '还没有可用的提供方，请检查 providers.json 配置。',
      moveUp: '上移，提高优先级',
      moveDown: '下移，降低优先级',
      dragHint: '也可以拖动条目调整顺序',
      status: '状态',
      balance: '余额',
      stats: '本地统计',
      kind: '类型',
      neverUsed: '从未调用',
      refreshOne: '只刷新这一家',
      reset: '重置',
      resetMonthlyFirst: '每月 1 日重置',
      resetMonthlyAllowance: '每月免费额度恢复（付费额度不重置）',
      resetNone: '不按月重置',
      resetNext: '下次',
      resetUnknown: '未知，先刷新余额',
      resetInDays: '天',
      resetInHours: '小时',
      resetInMinutes: '分钟',
      // Flat dotted keys on purpose: ctx.locale looks entries up by exact key.
      'unit.credits': '额度',
      'unit.usd': '美元',
      'unit.requests': '次',
      'unit.tokens': 'tokens',
      'unit.percent': '%',
      'unit.unknown': '单位未知',
      'status.ok': '正常',
      'status.cooldown': '冷却',
      'status.unknown': '未知',
    }

    const en = {
      panel: 'Web search providers',
      title: 'Web search providers',
      hint: 'Balances are drawn proportionally from each provider API; when an API reports no balance, a neutral hint is shown.',
      priorityHint: 'Order is call priority: the provider at the top is called first, and exhausted quota or errors fail over to the next one.',
      rank: 'Priority',
      refresh: 'Refresh balances',
      refreshing: 'Refreshing balances…',
      loading: 'Loading provider state…',
      saving: 'Saving order…',
      error: 'Operation failed',
      back: 'Back to chat',
      unknownBalance: 'No balance API',
      enable: 'Enable',
      disable: 'Disable',
      calls: 'Calls',
      successes: 'Successes',
      failures: 'Failures',
      lastUsed: 'Last used',
      cooldown: 'Cooling down',
      key: 'API key',
      keyPresent: 'Key configured',
      keyMissing: 'No key configured',
      selected: 'Provider detail',
      noProviders: 'No providers available. Check the providers.json config.',
      moveUp: 'Move up (higher priority)',
      moveDown: 'Move down (lower priority)',
      dragHint: 'You can also drag rows to reorder',
      status: 'Status',
      balance: 'Balance',
      stats: 'Local stats',
      kind: 'Kind',
      neverUsed: 'Never called',
      refreshOne: 'Refresh this provider only',
      reset: 'Reset',
      resetMonthlyFirst: 'Resets on the 1st of each month',
      resetMonthlyAllowance: 'Monthly free allowance renews (paid credits do not)',
      resetNone: 'Does not reset monthly',
      resetNext: 'next',
      resetUnknown: 'Unknown — refresh the balance first',
      resetInDays: 'd',
      resetInHours: 'h',
      resetInMinutes: 'm',
      // Flat dotted keys on purpose: ctx.locale looks entries up by exact key.
      'unit.credits': 'credits',
      'unit.usd': 'USD',
      'unit.requests': 'requests',
      'unit.tokens': 'tokens',
      'unit.percent': '%',
      'unit.unknown': 'unknown unit',
      'status.ok': 'OK',
      'status.cooldown': 'Cooling down',
      'status.unknown': 'Unknown',
    }

    const UNIT_KEYS = {
      credits: 'unit.credits',
      usd: 'unit.usd',
      requests: 'unit.requests',
      tokens: 'unit.tokens',
      percent: 'unit.percent',
    }

    /**
     * Documented reset rules per provider kind. Only used when the host bundle
     * is older than this one and sends no `resetKind`; an explicit host value
     * always wins, so policy lives in lib/balance.mjs, not here.
     */
    const FALLBACK_RESET = {
      tavily: 'monthly-first',
      parallel: 'monthly-allowance',
      firecrawl: 'period-end',
    }

    const TONE_COLOR = {
      ok: 'var(--dsw-alias-state-success-primary, #23945a)',
      cooldown: 'var(--dsw-alias-state-warning-primary, #d9880f)',
      unknown: 'var(--dsw-alias-label-tertiary, #9aa0a6)',
    }

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

    const STYLE = {
      page: {
        boxSizing: 'border-box',
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        minHeight: 0,
        background: 'var(--dsw-alias-bg-base)',
        color: 'var(--dsw-alias-label-primary)',
        font: 'inherit',
      },
      header: {
        boxSizing: 'border-box',
        display: 'flex',
        flexDirection: 'column',
        gap: '4px',
        flex: '0 0 auto',
        padding: '20px 24px 12px',
        borderBottom: '1px solid var(--dsw-alias-border-l1)',
      },
      headerTop: {
        display: 'flex',
        alignItems: 'center',
        gap: '12px',
        flexWrap: 'wrap',
      },
      headerTitle: {
        margin: 0,
        fontSize: '18px',
        lineHeight: '26px',
        fontWeight: 600,
        color: 'var(--dsw-alias-label-primary)',
      },
      headerActions: {
        marginLeft: 'auto',
        display: 'flex',
        alignItems: 'center',
        gap: '10px',
        flexWrap: 'wrap',
      },
      line: {
        margin: 0,
        fontSize: '12px',
        lineHeight: '18px',
        color: 'var(--dsw-alias-label-secondary)',
      },
      hintNote: {
        margin: 0,
        fontSize: '12px',
        lineHeight: '18px',
        color: 'var(--dsw-alias-label-secondary)',
      },
      feedback: {
        fontSize: '12px',
        color: 'var(--dsw-alias-label-secondary)',
      },
      feedbackError: {
        fontSize: '12px',
        color: 'var(--dsw-alias-state-error-primary, #d14343)',
      },
      body: {
        boxSizing: 'border-box',
        display: 'flex',
        alignItems: 'stretch',
        gap: '16px',
        flex: '1 1 auto',
        minHeight: 0,
        padding: '16px 24px 20px',
        flexWrap: 'wrap',
      },
      listPane: {
        boxSizing: 'border-box',
        display: 'flex',
        flexDirection: 'column',
        gap: '8px',
        flex: '0 0 300px',
        width: '300px',
        minWidth: 0,
        minHeight: 0,
        overflowY: 'auto',
        paddingRight: '2px',
      },
      listEmpty: {
        margin: 0,
        padding: '10px 2px',
        fontSize: '12px',
        lineHeight: '18px',
        color: 'var(--dsw-alias-label-secondary)',
      },
      row: {
        boxSizing: 'border-box',
        display: 'flex',
        alignItems: 'center',
        gap: '8px',
        padding: '8px 10px',
        borderRadius: 'var(--dsw-radius-md, 8px)',
        border: '1px solid var(--dsw-alias-border-l1)',
        background: 'var(--dsw-alias-bg-layer-1, transparent)',
        cursor: 'pointer',
        userSelect: 'none',
        outline: 'none',
      },
      rowActive: {
        borderColor: 'var(--dsw-alias-brand-primary)',
        background: 'var(--dsw-alias-bg-layer-2, rgba(127, 127, 127, 0.10))',
        boxShadow: '0 0 0 1px var(--dsw-alias-brand-primary) inset',
      },
      rowDimmed: {
        opacity: 0.55,
      },
      rowDragging: {
        opacity: 0.45,
      },
      rowDrop: {
        borderColor: 'var(--dsw-alias-brand-primary)',
        borderStyle: 'dashed',
      },
      rankBadge: {
        boxSizing: 'border-box',
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        flex: '0 0 auto',
        minWidth: '20px',
        height: '20px',
        padding: '0 5px',
        borderRadius: '999px',
        background: 'var(--dsw-alias-bg-layer-2, rgba(127, 127, 127, 0.16))',
        color: 'var(--dsw-alias-label-secondary)',
        fontSize: '11px',
        fontVariantNumeric: 'tabular-nums',
      },
      rowMain: {
        display: 'flex',
        flexDirection: 'column',
        gap: '2px',
        flex: '1 1 auto',
        minWidth: 0,
      },
      rowTop: {
        display: 'flex',
        alignItems: 'center',
        gap: '6px',
        minWidth: 0,
      },
      rowLabel: {
        fontSize: '13px',
        fontWeight: 600,
        color: 'var(--dsw-alias-label-primary)',
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        whiteSpace: 'nowrap',
      },
      rowAmount: {
        marginLeft: 'auto',
        flex: '0 1 auto',
        maxWidth: '58%',
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        fontSize: '11px',
        color: 'var(--dsw-alias-label-secondary)',
        whiteSpace: 'nowrap',
        fontVariantNumeric: 'tabular-nums',
      },
      rowActions: {
        display: 'flex',
        flexDirection: 'column',
        gap: '2px',
        flex: '0 0 auto',
      },
      iconButton: {
        boxSizing: 'border-box',
        width: '18px',
        height: '16px',
        lineHeight: '14px',
        padding: 0,
        border: '1px solid var(--dsw-alias-border-l1)',
        borderRadius: 'var(--dsw-radius-sm, 4px)',
        background: 'transparent',
        color: 'var(--dsw-alias-label-secondary)',
        fontSize: '10px',
        cursor: 'pointer',
      },
      iconButtonDisabled: {
        boxSizing: 'border-box',
        width: '18px',
        height: '16px',
        lineHeight: '14px',
        padding: 0,
        border: '1px solid var(--dsw-alias-border-l1)',
        borderRadius: 'var(--dsw-radius-sm, 4px)',
        background: 'transparent',
        color: 'var(--dsw-alias-label-tertiary, #9aa0a6)',
        fontSize: '10px',
        cursor: 'not-allowed',
        opacity: 0.4,
      },
      dot: {
        display: 'inline-block',
        flex: '0 0 auto',
        width: '8px',
        height: '8px',
        borderRadius: '999px',
      },
      dotSpaced: {
        display: 'inline-block',
        flex: '0 0 auto',
        width: '8px',
        height: '8px',
        marginRight: '6px',
        borderRadius: '999px',
      },
      track: {
        boxSizing: 'border-box',
        width: '100%',
        height: '4px',
        marginTop: '2px',
        overflow: 'hidden',
        borderRadius: '999px',
        background: 'var(--dsw-alias-bg-layer-2, rgba(127, 127, 127, 0.18))',
      },
      trackTall: {
        boxSizing: 'border-box',
        width: '100%',
        height: '8px',
        overflow: 'hidden',
        borderRadius: '999px',
        background: 'var(--dsw-alias-bg-layer-2, rgba(127, 127, 127, 0.18))',
      },
      fill: {
        height: '100%',
        borderRadius: '999px',
        transition: 'width 180ms ease',
      },
      detailPane: {
        boxSizing: 'border-box',
        display: 'flex',
        flexDirection: 'column',
        gap: '12px',
        flex: '1 1 320px',
        minWidth: 0,
        minHeight: 0,
        overflowY: 'auto',
        padding: '16px',
        border: '1px solid var(--dsw-alias-border-l1)',
        borderRadius: 'var(--dsw-radius-md, 8px)',
        background: 'var(--dsw-alias-bg-layer-1, transparent)',
      },
      caption: {
        fontSize: '11px',
        letterSpacing: '0.04em',
        textTransform: 'uppercase',
        color: 'var(--dsw-alias-label-secondary)',
      },
      detailHead: {
        display: 'flex',
        alignItems: 'center',
        gap: '10px',
        flexWrap: 'wrap',
      },
      detailTitle: {
        margin: 0,
        fontSize: '16px',
        lineHeight: '22px',
        fontWeight: 600,
        color: 'var(--dsw-alias-label-primary)',
      },
      kindBadge: {
        boxSizing: 'border-box',
        padding: '2px 8px',
        borderRadius: '999px',
        border: '1px solid var(--dsw-alias-border-l1)',
        background: 'var(--dsw-alias-bg-layer-2, rgba(127, 127, 127, 0.10))',
        color: 'var(--dsw-alias-label-secondary)',
        fontSize: '11px',
      },
      field: {
        display: 'flex',
        alignItems: 'baseline',
        gap: '10px',
        minWidth: 0,
        paddingBottom: '6px',
        borderBottom: '1px solid var(--dsw-alias-border-l1)',
        fontSize: '12px',
      },
      fieldLabel: {
        flex: '0 0 92px',
        color: 'var(--dsw-alias-label-secondary)',
      },
      fieldValue: {
        flex: '1 1 auto',
        minWidth: 0,
        color: 'var(--dsw-alias-label-primary)',
        wordBreak: 'break-word',
        fontVariantNumeric: 'tabular-nums',
      },
      statsGrid: {
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(90px, 1fr))',
        gap: '8px',
      },
      statCell: {
        boxSizing: 'border-box',
        padding: '8px 10px',
        borderRadius: 'var(--dsw-radius-sm, 6px)',
        border: '1px solid var(--dsw-alias-border-l1)',
        background: 'var(--dsw-alias-bg-base)',
      },
      statValue: {
        display: 'block',
        fontSize: '15px',
        lineHeight: '20px',
        fontWeight: 600,
        color: 'var(--dsw-alias-label-primary)',
        fontVariantNumeric: 'tabular-nums',
      },
      statLabel: {
        display: 'block',
        fontSize: '11px',
        lineHeight: '16px',
        color: 'var(--dsw-alias-label-secondary)',
      },
      detailActions: {
        display: 'flex',
        alignItems: 'center',
        gap: '10px',
        flexWrap: 'wrap',
        marginTop: 'auto',
        paddingTop: '4px',
      },
      primary: PRIMARY_BUTTON,
      primaryDisabled: Object.assign({}, PRIMARY_BUTTON, { cursor: 'not-allowed', opacity: 0.6 }),
      ghost: GHOST_BUTTON,
      ghostDisabled: Object.assign({}, GHOST_BUTTON, { cursor: 'not-allowed', opacity: 0.6 }),
    }

    /* ---------------------------- pure helpers ---------------------------- */

    function clampRatio(value) {
      return Math.max(0, Math.min(1, value))
    }

    function toFiniteNumber(value) {
      return typeof value === 'number' && isFinite(value) ? value : null
    }

    function formatAmount(value) {
      const number = toFiniteNumber(value)
      if (number === null) return ''
      if (Number.isInteger(number)) return String(number)
      return number.toFixed(2).replace(/\.?0+$/, '')
    }

    function unitLabel(t, unit) {
      const key = UNIT_KEYS[unit]
      return key ? t(key) : t('unit.unknown')
    }

    /** Human balance text for any billing unit; never renders NaN. */
    function balanceText(t, balance) {
      if (!balance) return t('unknownBalance')
      const amount = formatAmount(balance.remaining)
      if (amount === '') return t('unknownBalance')
      let text = amount + ' ' + unitLabel(t, balance.unit)
      const total = toFiniteNumber(balance.total)
      if (total !== null && total > 0) text += ' / ' + formatAmount(total)
      return text
    }

    /** Largest numeric `remaining` across providers, used to normalise bars. */
    function maxRemainingOf(providers) {
      let max = 0
      providers.forEach(function (provider) {
        const remaining = provider && provider.balance ? toFiniteNumber(provider.balance.remaining) : null
        if (remaining !== null && remaining > max) max = remaining
      })
      return max
    }

    /** Bar width 0..1 when the host gave a ratio, else a normalised remaining, else null. */
    function balanceRatio(provider, maxRemaining) {
      if (!provider || !provider.balance) return null
      const ratio = toFiniteNumber(provider.balance.ratio)
      if (ratio !== null) return clampRatio(ratio)
      const remaining = toFiniteNumber(provider.balance.remaining)
      if (remaining !== null) {
        if (maxRemaining > 0) return clampRatio(remaining / maxRemaining)
        return 0
      }
      return null
    }

    function statusTone(provider) {
      if (!provider) return 'unknown'
      if (provider.cooldown && provider.cooldown.active === true) return 'cooldown'
      const balance = provider.balance
      if (balance && balance.status === 'ok') return 'ok'
      if (balance && balance.status === 'error') return 'cooldown'
      return 'unknown'
    }

    /** `YYYY-MM-DD HH:mm` in the browser's local zone. */
    function formatStamp(ms) {
      const date = new Date(ms)
      function pad2(value) {
        return value < 10 ? '0' + value : String(value)
      }
      return (
        date.getFullYear() +
        '-' +
        pad2(date.getMonth() + 1) +
        '-' +
        pad2(date.getDate()) +
        ' ' +
        pad2(date.getHours()) +
        ':' +
        pad2(date.getMinutes())
      )
    }

    /** Coarse remaining duration for a reset: `24天 3小时` to `12分钟`. */
    function resetCountdown(t, remainingMs) {
      const minutes = Math.floor(Math.max(0, remainingMs) / 60000)
      const days = Math.floor(minutes / 1440)
      const hours = Math.floor((minutes % 1440) / 60)
      const rest = minutes % 60
      if (days > 0) return days + t('resetInDays') + ' ' + hours + t('resetInHours')
      if (hours > 0) return hours + t('resetInHours') + ' ' + rest + t('resetInMinutes')
      return rest + t('resetInMinutes')
    }

    /**
     * Reset line for any provider: exact timestamp + countdown when the upstream
     * reports a billing period, a documented monthly rule otherwise.
     */
    function resetText(t, balance, provider, nowMs) {
      const explicit = balance && typeof balance.resetKind === 'string' ? balance.resetKind : undefined
      const kind = explicit !== undefined ? explicit : FALLBACK_RESET[provider && provider.kind]
      const resetsAt = balance ? toFiniteNumber(balance.resetsAt) : null
      if (kind === 'monthly-first') {
        return resetsAt === null
          ? t('resetMonthlyFirst')
          : t('resetMonthlyFirst') + ' · ' + t('resetNext') + ' ' + formatStamp(resetsAt)
      }
      if (kind === 'monthly-allowance') {
        return resetsAt === null
          ? t('resetMonthlyAllowance')
          : t('resetMonthlyAllowance') + ' · ' + t('resetNext') + ' ' + formatStamp(resetsAt)
      }
      if (kind === 'period-end') {
        if (resetsAt === null) return t('resetUnknown')
        return formatStamp(resetsAt) + ' · ' + resetCountdown(t, resetsAt - nowMs)
      }
      return t('resetNone')
    }

    /** Remaining cooldown as `12s · reason`; empty when not cooling down. */
    function cooldownText(cooldown, nowMs) {      if (!cooldown || cooldown.active !== true) return ''
      const until = toFiniteNumber(cooldown.until)
      const remainingMs = until === null ? 0 : Math.max(0, until - nowMs)
      const seconds = Math.ceil(remainingMs / 1000)
      const minutes = Math.floor(seconds / 60)
      const rest = seconds % 60
      const clock = minutes > 0 ? minutes + 'm ' + (rest < 10 ? '0' + rest : String(rest)) + 's' : seconds + 's'
      if (typeof cooldown.message === 'string' && cooldown.message) return clock + ' · ' + cooldown.message
      if (typeof cooldown.reason === 'string' && cooldown.reason) return clock + ' · ' + cooldown.reason
      return clock
    }

    function normalizePayload(payload) {
      if (!payload || payload.ok !== true || !Array.isArray(payload.providers)) {
        throw new Error('bad-payload')
      }
      const providers = payload.providers
        .filter(function (provider) {
          return provider && typeof provider.id === 'string' && provider.id.length > 0
        })
        .sort(function (left, right) {
          const leftRank = toFiniteNumber(left.rank)
          const rightRank = toFiniteNumber(right.rank)
          return (leftRank === null ? Number.MAX_SAFE_INTEGER : leftRank) - (rightRank === null ? Number.MAX_SAFE_INTEGER : rightRank)
        })
      return {
        generatedAt: toFiniteNumber(payload.generatedAt) === null ? Date.now() : payload.generatedAt,
        providers: providers,
      }
    }

    /** Rebuild the provider list in the given id order (optimistic reorder). */
    function orderProviders(providers, orderIds) {
      const byId = {}
      providers.forEach(function (provider) {
        byId[provider.id] = provider
      })
      const next = []
      orderIds.forEach(function (id) {
        if (Object.prototype.hasOwnProperty.call(byId, id)) {
          next.push(byId[id])
          delete byId[id]
        }
      })
      providers.forEach(function (provider) {
        if (Object.prototype.hasOwnProperty.call(byId, provider.id)) {
          next.push(provider)
          delete byId[provider.id]
        }
      })
      return next.map(function (provider, index) {
        const copy = Object.assign({}, provider)
        copy.rank = index + 1
        return copy
      })
    }

    function withEnabled(snapshot, id, enabled) {
      return {
        generatedAt: snapshot.generatedAt,
        providers: snapshot.providers.map(function (provider) {
          return provider.id === id ? Object.assign({}, provider, { enabled: enabled }) : provider
        }),
      }
    }

    function pickProvider(providers, id) {
      for (let index = 0; index < providers.length; index += 1) {
        if (providers[index].id === id) return providers[index]
      }
      return null
    }

    function errorCode(error) {
      if (!error) return 'unknown'
      const message = error.message ? String(error.message) : String(error)
      return message.length > 0 ? message : 'unknown'
    }

    function fetchJson(url, init) {
      return fetch(url, init || {}).then(function (response) {
        return response
          .json()
          .catch(function () {
            return null
          })
          .then(function (data) {
            if (!response.ok || !data || data.ok !== true) {
              const code = data && typeof data.error === 'string' ? data.error : 'http-' + response.status
              throw new Error(code)
            }
            return data
          })
      })
    }

    function postJson(url, body) {
      return fetchJson(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify(body || {}),
        cache: 'no-store',
      })
    }

    /** Proportional bar; an unknown ratio renders an empty track, never NaN%. */
    function Bar(props) {
      const known = typeof props.ratio === 'number' && isFinite(props.ratio)
      const ratio = known ? clampRatio(props.ratio) : 0
      const fill = Object.assign({}, STYLE.fill, {
        width: (ratio * 100).toFixed(2) + '%',
        background: TONE_COLOR[props.tone] || TONE_COLOR.unknown,
      })
      return React.createElement(
        'div',
        { style: props.tall ? STYLE.trackTall : STYLE.track, role: 'presentation' },
        known ? React.createElement('div', { style: fill }) : null,
      )
    }

    /** Sidebar glyph: magnifier over a short list, drawn in currentColor. */
    function Icon(props) {
      const size = typeof props.size === 'number' && props.size > 0 ? props.size : 18
      return React.createElement(
        'svg',
        {
          width: size,
          height: size,
          viewBox: '0 0 24 24',
          fill: 'none',
          xmlns: 'http://www.w3.org/2000/svg',
          'aria-hidden': 'true',
          focusable: 'false',
        },
        React.createElement('circle', {
          cx: 10,
          cy: 10,
          r: 6.25,
          stroke: 'currentColor',
          strokeWidth: 1.7,
        }),
        React.createElement('path', {
          d: 'M14.6 14.6 20 20',
          stroke: 'currentColor',
          strokeWidth: 1.7,
          strokeLinecap: 'round',
        }),
        React.createElement('path', {
          d: 'M7.4 8.6h5.2M7.4 11.6h3.4',
          stroke: 'currentColor',
          strokeWidth: 1.7,
          strokeLinecap: 'round',
        }),
      )
    }

    /* -------------------------------- panel ------------------------------- */

    function Page(props) {
      const t = props.t
      const back = props.back

      const [snapshot, setSnapshot] = React.useState(null)
      const [selectedId, setSelectedId] = React.useState('')
      const [phase, setPhase] = React.useState('loading')
      const [failure, setFailure] = React.useState('')
      const [dragId, setDragId] = React.useState('')
      const [overId, setOverId] = React.useState('')
      const [now, setNow] = React.useState(function () {
        return Date.now()
      })

      const providers = snapshot && Array.isArray(snapshot.providers) ? snapshot.providers : []
      const busy = phase === 'loading' || phase === 'saving' || phase === 'refreshing'

      // Auto-load once on mount. Balances are not polled: provider APIs are
      // billed per call, so only the explicit refresh button hits /refresh.
      React.useEffect(function () {
        let cancelled = false
        fetchJson(ROUTES.state, {
          method: 'GET',
          headers: { accept: 'application/json' },
          cache: 'no-store',
        })
          .then(function (payload) {
            if (cancelled) return
            setSnapshot(normalizePayload(payload))
            setPhase('ready')
          })
          .catch(function (error) {
            if (cancelled) return
            setFailure(errorCode(error))
            setPhase('error')
          })
        return function () {
          cancelled = true
        }
      }, [])

      // One-second tick only while something is cooling down (countdown text).
      const ticking = providers.some(function (provider) {
        return provider && provider.cooldown && provider.cooldown.active === true
      })
      React.useEffect(
        function () {
          if (!ticking) return undefined
          const timer = setInterval(function () {
            setNow(Date.now())
          }, 1000)
          return function () {
            clearInterval(timer)
          }
        },
        [ticking],
      )

      // Keep a valid selection whenever the payload changes.
      React.useEffect(
        function () {
          if (!snapshot) return
          const stillThere = pickProvider(snapshot.providers, selectedId) !== null
          if (stillThere) return
          setSelectedId(snapshot.providers.length > 0 ? snapshot.providers[0].id : '')
        },
        [snapshot, selectedId],
      )

      function fail(error) {
        setFailure(errorCode(error))
        setPhase('error')
      }

      function accept(payload) {
        setSnapshot(normalizePayload(payload))
        setFailure('')
        setPhase('ready')
      }

      /** POST the full id array, after applying the new order optimistically. */
      function commitOrder(nextIds) {
        if (!snapshot || phase === 'saving') return
        const previous = snapshot
        setSnapshot({
          generatedAt: previous.generatedAt,
          providers: orderProviders(previous.providers, nextIds),
        })
        setFailure('')
        setPhase('saving')
        postJson(ROUTES.order, { order: nextIds })
          .then(accept)
          .catch(function (error) {
            setSnapshot(previous)
            fail(error)
          })
      }

      function moveBy(id, delta) {
        const ids = providers.map(function (provider) {
          return provider.id
        })
        const from = ids.indexOf(id)
        const to = from + delta
        if (from < 0 || to < 0 || to >= ids.length) return
        ids.splice(from, 1)
        ids.splice(to, 0, id)
        commitOrder(ids)
      }

      function refresh(ids) {
        if (phase === 'loading' || phase === 'saving' || phase === 'refreshing') return
        setFailure('')
        setPhase('refreshing')
        postJson(ROUTES.refresh, ids ? { ids: ids } : {})
          .then(accept)
          .catch(fail)
      }

      function toggleEnabled(provider) {
        if (!snapshot || !provider || phase === 'saving') return
        const previous = snapshot
        const enabled = provider.enabled !== true
        setSnapshot(withEnabled(previous, provider.id, enabled))
        setFailure('')
        setPhase('saving')
        postJson(ROUTES.enable, { id: provider.id, enabled: enabled })
          .then(accept)
          .catch(function (error) {
            setSnapshot(previous)
            fail(error)
          })
      }

      function onDragStart(event, id) {
        setDragId(id)
        setOverId('')
        try {
          event.dataTransfer.effectAllowed = 'move'
          event.dataTransfer.setData('text/plain', id)
        } catch {
          /* older engines may refuse dataTransfer writes */
        }
      }

      function onDragOverRow(event, id) {
        event.preventDefault()
        try {
          event.dataTransfer.dropEffect = 'move'
        } catch {
          /* ignore */
        }
        if (overId !== id) setOverId(id)
      }

      function onDragLeaveRow(id) {
        setOverId(function (current) {
          return current === id ? '' : current
        })
      }

      function onDropRow(event, id) {
        event.preventDefault()
        let source = dragId
        if (!source) {
          try {
            source = event.dataTransfer.getData('text/plain')
          } catch {
            source = ''
          }
        }
        setDragId('')
        setOverId('')
        if (!source || source === id) return
        const ids = providers
          .map(function (provider) {
            return provider.id
          })
          .filter(function (candidate) {
            return candidate !== source
          })
        const target = ids.indexOf(id)
        if (target < 0) return
        ids.splice(target, 0, source)
        commitOrder(ids)
      }

      function onDragEnd() {
        setDragId('')
        setOverId('')
      }

      function onBack() {
        if (typeof back === 'function') back()
      }

      function rowAt(provider, index) {
        const tone = statusTone(provider)
        const ratio = balanceRatio(provider, maxRemaining)
        const active = provider.id === selectedId
        const isDragging = dragId === provider.id
        const isOver = overId === provider.id && dragId !== '' && dragId !== provider.id
        const rowStyle = Object.assign(
          {},
          STYLE.row,
          active ? STYLE.rowActive : {},
          provider.enabled === false ? STYLE.rowDimmed : {},
          isDragging ? STYLE.rowDragging : {},
          isOver ? STYLE.rowDrop : {},
        )
        const upDisabled = index === 0 || phase === 'saving'
        const downDisabled = index === providers.length - 1 || phase === 'saving'

        return React.createElement(
          'div',
          {
            key: provider.id,
            draggable: true,
            style: rowStyle,
            role: 'button',
            tabIndex: 0,
            title: t('dragHint'),
            'aria-label': (provider.label || provider.id) + ' · ' + t('rank') + ' ' + String(index + 1),
            onDragStart: function (event) {
              onDragStart(event, provider.id)
            },
            onDragOver: function (event) {
              onDragOverRow(event, provider.id)
            },
            onDragLeave: function () {
              onDragLeaveRow(provider.id)
            },
            onDrop: function (event) {
              onDropRow(event, provider.id)
            },
            onDragEnd: onDragEnd,
            onClick: function () {
              setSelectedId(provider.id)
            },
            onKeyDown: function (event) {
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault()
                setSelectedId(provider.id)
              }
            },
          },
          React.createElement('span', { style: STYLE.rankBadge }, String(index + 1)),
          React.createElement(
            'div',
            { style: STYLE.rowMain },
            React.createElement(
              'div',
              { style: STYLE.rowTop },
              React.createElement('span', {
                style: Object.assign({}, STYLE.dot, { background: TONE_COLOR[tone] }),
                title: t('status.' + tone),
              }),
              React.createElement('span', { style: STYLE.rowLabel }, provider.label || provider.id),
              React.createElement('span', { style: STYLE.rowAmount }, balanceText(t, provider.balance)),
            ),
            React.createElement(Bar, { ratio: ratio, tone: tone }),
          ),
          React.createElement(
            'div',
            { style: STYLE.rowActions },
            React.createElement(
              'button',
              {
                type: 'button',
                style: upDisabled ? STYLE.iconButtonDisabled : STYLE.iconButton,
                disabled: upDisabled,
                title: t('moveUp'),
                'aria-label': t('moveUp'),
                onClick: function (event) {
                  event.stopPropagation()
                  moveBy(provider.id, -1)
                },
              },
              '↑',
            ),
            React.createElement(
              'button',
              {
                type: 'button',
                style: downDisabled ? STYLE.iconButtonDisabled : STYLE.iconButton,
                disabled: downDisabled,
                title: t('moveDown'),
                'aria-label': t('moveDown'),
                onClick: function (event) {
                  event.stopPropagation()
                  moveBy(provider.id, 1)
                },
              },
              '↓',
            ),
          ),
        )
      }

      function field(key, label, value) {
        return React.createElement(
          'div',
          { key: key, style: STYLE.field },
          React.createElement('span', { style: STYLE.fieldLabel }, label),
          React.createElement('span', { style: STYLE.fieldValue }, value),
        )
      }

      function statCell(key, label, value) {
        return React.createElement(
          'div',
          { key: key, style: STYLE.statCell },
          React.createElement('span', { style: STYLE.statValue }, value),
          React.createElement('span', { style: STYLE.statLabel }, label),
        )
      }

      function details() {
        const selected = pickProvider(providers, selectedId)
        if (!selected) return null
        const tone = statusTone(selected)
        const ratio = balanceRatio(selected, maxRemaining)
        const balance = selected.balance || {}
        const stats = selected.stats || {}
        const cooldown = selected.cooldown || { active: false }
        const rank = toFiniteNumber(selected.rank)
        const balanceLabel = balanceText(t, selected.balance)
        const ratioText = typeof ratio === 'number' ? Math.round(ratio * 100) + '%' : ''
        const cooldownLabel = cooldownText(cooldown, now)
        const keyLabel = selected.keyPresent === true ? t('keyPresent') : t('keyMissing')
        const lastUsed =
          typeof stats.lastUsedAt === 'string' && stats.lastUsedAt.length > 0 ? stats.lastUsedAt : t('neverUsed')
        const calls = toFiniteNumber(stats.calls)
        const successes = toFiniteNumber(stats.successes)
        const failures = toFiniteNumber(stats.failures)

        return React.createElement(
          'div',
          { style: STYLE.detailPane },
          React.createElement('span', { style: STYLE.caption }, t('selected')),
          React.createElement(
            'div',
            { style: STYLE.detailHead },
            React.createElement('h3', { style: STYLE.detailTitle }, selected.label || selected.id),
            React.createElement('span', { style: STYLE.kindBadge }, selected.kind || 'unknown'),
          ),
          field('rank', t('rank'), rank === null ? '—' : '#' + String(rank)),
          field('kind', t('kind'), selected.kind || 'unknown'),
          React.createElement(
            'div',
            { style: STYLE.field },
            React.createElement('span', { style: STYLE.fieldLabel }, t('status')),
            React.createElement(
              'span',
              { style: STYLE.fieldValue },
              React.createElement('span', { style: Object.assign({}, STYLE.dotSpaced, { background: TONE_COLOR[tone] }) }),
              t('status.' + tone),
            ),
          ),
          React.createElement(
            'div',
            { style: STYLE.field },
            React.createElement('span', { style: STYLE.fieldLabel }, t('balance')),
            React.createElement('span', { style: STYLE.fieldValue }, ratioText ? balanceLabel + ' · ' + ratioText : balanceLabel),
          ),
          React.createElement(Bar, { ratio: ratio, tone: tone, tall: true }),
          field('reset', t('reset'), resetText(t, selected.balance, selected, now)),
          field('cooldown', t('cooldown'), cooldown.active === true ? cooldownLabel : '—'),
          field('key', t('key'), keyLabel),
          React.createElement('span', { style: STYLE.caption }, t('stats')),
          React.createElement(
            'div',
            { style: STYLE.statsGrid },
            statCell('calls', t('calls'), String(calls === null ? 0 : calls)),
            statCell('successes', t('successes'), String(successes === null ? 0 : successes)),
            statCell('failures', t('failures'), String(failures === null ? 0 : failures)),
            statCell('lastUsed', t('lastUsed'), lastUsed),
          ),
          React.createElement(
            'div',
            { style: STYLE.detailActions },
            React.createElement(
              'button',
              {
                type: 'button',
                style: selected.enabled === false ? (busy ? STYLE.primaryDisabled : STYLE.primary) : busy ? STYLE.ghostDisabled : STYLE.ghost,
                disabled: busy,
                onClick: function () {
                  toggleEnabled(selected)
                },
              },
              selected.enabled === false ? t('enable') : t('disable'),
            ),
            React.createElement(
              'button',
              {
                type: 'button',
                style: busy ? STYLE.ghostDisabled : STYLE.ghost,
                disabled: busy,
                onClick: function () {
                  refresh([selected.id])
                },
              },
              t('refreshOne'),
            ),
          ),
        )
      }

      const maxRemaining = maxRemainingOf(providers)

      let feedback = null
      if (phase === 'loading') feedback = React.createElement('span', { style: STYLE.feedback }, t('loading'))
      else if (phase === 'refreshing') feedback = React.createElement('span', { style: STYLE.feedback }, t('refreshing'))
      else if (phase === 'saving') feedback = React.createElement('span', { style: STYLE.feedback }, t('saving'))
      else if (phase === 'error') {
        feedback = React.createElement(
          'span',
          { style: STYLE.feedbackError },
          t('error') + (failure ? ' (' + failure + ')' : ''),
        )
      }

      return React.createElement(
        'div',
        { style: STYLE.page },
        React.createElement(
          'div',
          { style: STYLE.header },
          React.createElement(
            'div',
            { style: STYLE.headerTop },
            React.createElement('h2', { style: STYLE.headerTitle }, t('title')),
            React.createElement(
              'div',
              { style: STYLE.headerActions },
              feedback,
              React.createElement(
                'button',
                {
                  type: 'button',
                  style: busy ? STYLE.primaryDisabled : STYLE.primary,
                  disabled: busy,
                  onClick: function () {
                    refresh()
                  },
                },
                phase === 'refreshing' ? t('refreshing') : t('refresh'),
              ),
              React.createElement('button', { type: 'button', style: STYLE.ghost, onClick: onBack }, t('back')),
            ),
          ),
          React.createElement('p', { style: STYLE.line }, t('priorityHint')),
          React.createElement('p', { style: STYLE.hintNote }, t('hint') + ' · ' + t('dragHint')),
        ),
        React.createElement(
          'div',
          { style: STYLE.body },
          React.createElement(
            'div',
            { style: STYLE.listPane },
            providers.length === 0
              ? React.createElement('p', { style: STYLE.listEmpty }, phase === 'loading' ? t('loading') : t('noProviders'))
              : providers.map(rowAt),
          ),
          details(),
        ),
      )
    }

    /* ------------------------------- wiring ------------------------------- */

    /**
     * No sidebar row and no main panel any more: the provider manager is a
     * section of dsh-inventory's Tools page, next to the tool list it actually
     * controls. This factory keeps only the dictionary — the Tools page renders
     * the same keys through the `websearch-failover` namespace — so the bundle
     * still owns its host API without claiming a shell slot.
     */
    function apply(ctx) {
      ctx.effect(function () {
        return ctx.locale.register(NS, { zh: zh, en: en })
      })
    }

    return {
      name: 'dsh-websearch-failover',
      inject: ['locale'],
      apply: apply,
      // The provider manager section, mounted by dsh-inventory's Tools page and
      // by the render smoke test. Same props contract as before: `t` + `back`.
      __providersPage: Page,
    }
  },
})
