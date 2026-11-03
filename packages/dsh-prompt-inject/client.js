/**
 * @local/dsh-prompt-inject — browser half.
 *
 * The prompt editor is no longer a sidebar panel of its own: dsh-inventory's
 * Tools page hosts it next to the web-search providers and edits the injected
 * system-prompt text through `GET/POST /prompt-inject/state`. This module only
 * registers the shared strings, so the host half keeps exactly one owner of the
 * route and the UI keeps one place to edit it.
 */
window.__ModuleLoader__.load({
  id: '@local/dsh-prompt-inject',
  factory(require) {
    const React = require('react')

    const NS = 'prompt-inject'
    const STATE_ROUTE = '/prompt-inject/state'

    const zh = {
      panel: '提示词注入',
      title: '提示词注入',
      description: '编辑注入到所有 Agent 系统提示词中的本地演示段落。保存后，新的模型请求会使用更新后的文本。',
      placeholder: '在此输入要注入系统提示词的内容…',
      confirm: '确定',
      saving: '保存中…',
      saved: '已保存，新的模型请求将使用更新后的提示词。',
      loading: '正在读取当前注入文本…',
      back: '返回对话',
      // Flat keys on purpose: ctx.locale looks entries up by exact key.
      'error.load': '读取当前注入文本失败，请稍后重试。',
      'error.save': '保存失败，请稍后重试。',
      'error.empty': '注入文本不能为空，未提交。',
    }

    const en = {
      panel: 'Prompt injection',
      title: 'Prompt injection',
      description: 'Edit the local demo section injected into every agent system prompt. After saving, new model requests use the updated text.',
      placeholder: 'Enter the text to inject into the system prompt…',
      confirm: 'Save',
      saving: 'Saving…',
      saved: 'Saved. New model requests will use the updated prompt.',
      loading: 'Loading the current injected text…',
      back: 'Back to chat',
      // Flat keys on purpose: ctx.locale looks entries up by exact key.
      'error.load': 'Could not load the current injected text. Please retry.',
      'error.save': 'Could not save. Please retry.',
      'error.empty': 'The injected text must not be empty; nothing was submitted.',
    }

    const PRIMARY_BUTTON = {
      border: 'none',
      borderRadius: 'var(--dsw-radius-sm, 6px)',
      padding: '7px 18px',
      fontSize: '13px',
      fontWeight: 600,
      cursor: 'pointer',
      color: 'var(--dsw-alias-label-primary-foreground, #ffffff)',
      background: 'var(--dsw-alias-brand-primary)',
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
        display: 'flex',
        flexDirection: 'column',
        gap: '6px',
        padding: '20px 24px 10px',
      },
      title: {
        margin: 0,
        fontSize: '18px',
        lineHeight: '26px',
        fontWeight: 600,
        color: 'var(--dsw-alias-label-primary)',
      },
      description: {
        margin: 0,
        fontSize: '13px',
        lineHeight: '20px',
        color: 'var(--dsw-alias-label-secondary)',
      },
      body: {
        boxSizing: 'border-box',
        display: 'flex',
        flex: '1 1 auto',
        minHeight: 0,
        padding: '0 24px',
        flexDirection: 'column',
      },
      textarea: {
        boxSizing: 'border-box',
        flex: '1 1 auto',
        minHeight: '160px',
        width: '100%',
        resize: 'none',
        margin: 0,
        padding: '10px 12px',
        color: 'var(--dsw-alias-label-primary)',
        background: 'var(--dsw-alias-bg-layer-1)',
        border: '1px solid var(--dsw-alias-border-l1)',
        borderRadius: 'var(--dsw-radius-sm, 6px)',
        outline: 'none',
        fontFamily: 'var(--dsh-font-family-code, ui-monospace, SFMono-Regular, Menlo, monospace)',
        fontSize: '12px',
        lineHeight: 1.6,
      },
      footer: {
        display: 'flex',
        alignItems: 'center',
        gap: '10px',
        flexWrap: 'wrap',
        padding: '12px 24px 20px',
        marginTop: '12px',
        borderTop: '1px solid var(--dsw-alias-border-l1)',
      },
      primary: PRIMARY_BUTTON,
      primaryDisabled: {
        ...PRIMARY_BUTTON,
        cursor: 'not-allowed',
        opacity: 0.6,
      },
      ghost: {
        border: '1px solid var(--dsw-alias-border-l1)',
        borderRadius: 'var(--dsw-radius-sm, 6px)',
        padding: '7px 14px',
        fontSize: '13px',
        cursor: 'pointer',
        background: 'transparent',
        color: 'var(--dsw-alias-label-secondary)',
      },
      hint: {
        fontSize: '12px',
        color: 'var(--dsw-alias-label-secondary)',
      },
      ok: {
        fontSize: '12px',
        color: 'var(--dsw-alias-state-success-primary)',
      },
      err: {
        fontSize: '12px',
        color: 'var(--dsw-alias-state-error-primary)',
      },
    }

    /** Sidebar glyph: a prompt sheet with a plus, drawn in currentColor. */
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
        React.createElement('path', {
          d: 'M4 5.5h16M4 12h10M4 18.5h7',
          stroke: 'currentColor',
          strokeWidth: 1.7,
          strokeLinecap: 'round',
        }),
        React.createElement('path', {
          d: 'M17.5 14.5v6M14.5 17.5h6',
          stroke: 'currentColor',
          strokeWidth: 1.7,
          strokeLinecap: 'round',
        }),
      )
    }

    /** Main panel: load the current text, edit it, save, or go back to chat. */
    function Page(props) {
      const t = props.t
      const back = props.back

      const [text, setText] = React.useState('')
      const [status, setStatus] = React.useState('loading')
      const [detail, setDetail] = React.useState('')

      React.useEffect(function () {
        let cancelled = false

        fetch(STATE_ROUTE, { method: 'GET', headers: { accept: 'application/json' }, cache: 'no-store' })
          .then(function (response) {
            if (!response.ok) throw new Error('http-' + response.status)
            return response.json()
          })
          .then(function (data) {
            if (cancelled) return
            setText(data && typeof data.text === 'string' ? data.text : '')
            setStatus('idle')
          })
          .catch(function () {
            if (!cancelled) setStatus('load-error')
          })

        return function () {
          cancelled = true
        }
      }, [])

      const disabled = status === 'loading' || status === 'saving'

      function onChange(event) {
        setText(event.target.value)
        if (status !== 'saving') {
          setStatus('idle')
          setDetail('')
        }
      }

      function onSave() {
        if (disabled) return

        const value = text
        if (value.trim().length === 0) {
          setStatus('empty')
          setDetail('')
          return
        }

        setStatus('saving')
        setDetail('')

        fetch(STATE_ROUTE, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ text: value }),
        })
          .then(function (response) {
            return response
              .json()
              .catch(function () {
                return {}
              })
              .then(function (data) {
                return { ok: response.ok, status: response.status, data: data }
              })
          })
          .then(function (result) {
            if (!result.ok) {
              const code = result.data && result.data.error ? result.data.error : 'http-' + result.status
              throw new Error(code)
            }
            setStatus('saved')
          })
          .catch(function (error) {
            setDetail(error && error.message ? error.message : 'unknown')
            setStatus('error')
          })
      }

      function onBack() {
        if (typeof back === 'function') back()
      }

      let hint = null
      if (status === 'loading') hint = React.createElement('span', { style: STYLE.hint }, t('loading'))
      else if (status === 'saving') hint = React.createElement('span', { style: STYLE.hint }, t('saving'))
      else if (status === 'saved') hint = React.createElement('span', { style: STYLE.ok }, t('saved'))
      else if (status === 'empty') hint = React.createElement('span', { style: STYLE.err }, t('error.empty'))
      else if (status === 'load-error') hint = React.createElement('span', { style: STYLE.err }, t('error.load'))
      else if (status === 'error') {
        hint = React.createElement('span', { style: STYLE.err }, t('error.save') + (detail ? ' (' + detail + ')' : ''))
      }

      return React.createElement(
        'div',
        { style: STYLE.page },
        React.createElement(
          'div',
          { style: STYLE.header },
          React.createElement('h2', { style: STYLE.title }, t('title')),
          React.createElement('p', { style: STYLE.description }, t('description')),
        ),
        React.createElement(
          'div',
          { style: STYLE.body },
          React.createElement('textarea', {
            style: STYLE.textarea,
            value: text,
            placeholder: t('placeholder'),
            disabled: disabled,
            spellCheck: false,
            'aria-label': t('title'),
            onChange: onChange,
          }),
        ),
        React.createElement(
          'div',
          { style: STYLE.footer },
          React.createElement(
            'button',
            {
              type: 'button',
              style: disabled ? STYLE.primaryDisabled : STYLE.primary,
              disabled: disabled,
              onClick: onSave,
            },
            status === 'saving' ? t('saving') : t('confirm'),
          ),
          hint,
          React.createElement('button', { type: 'button', style: STYLE.ghost, onClick: onBack }, t('back')),
        ),
      )
    }

    /**
     * No sidebar row and no main panel of its own any more: the editor lives on
     * the Tools page (dsh-inventory) next to the web-search providers, so this
     * factory only registers its dictionary — the panel's `t` reads it through
     * the `prompt-inject` namespace, and the keys here are the ones the editor
     * renders.
     */
    function apply(ctx) {
      ctx.effect(function () {
        return ctx.locale.register(NS, { zh: zh, en: en })
      })
    }

    return {
      name: '@local/dsh-prompt-inject',
      inject: ['locale'],
      apply: apply,
    }
  },
})
