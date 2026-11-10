
    /** Prompt injection: the text every agent system prompt carries, edited live. */
    function PromptInjector(props) {
      const t = typeof props.t === 'function' ? props.t : (key) => zh[key] ?? en[key] ?? key
      const [text, setText] = React.useState('')
      const [status, setStatus] = React.useState('loading')
      const [detail, setDetail] = React.useState('')

      React.useEffect(() => {
        let cancelled = false
        fetch(PROMPT_ROUTE, { method: 'GET', headers: { accept: 'application/json' }, cache: 'no-store' })
          .then((response) => {
            if (!response.ok) throw new Error(`http-${response.status}`)
            return response.json()
          })
          .then((data) => {
            if (cancelled) return
            setText(data && typeof data.text === 'string' ? data.text : '')
            setStatus('idle')
          })
          .catch(() => {
            if (!cancelled) setStatus('load-error')
          })
        return () => {
          cancelled = true
        }
      }, [])

      const disabled = status === 'loading' || status === 'saving'

      const onSave = () => {
        if (disabled) return
        const value = text
        if (value.trim().length === 0) {
          setStatus('empty')
          setDetail('')
          return
        }
        setStatus('saving')
        setDetail('')
        fetch(PROMPT_ROUTE, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ text: value }),
        })
          .then(async (response) => {
            const data = await response.json().catch(() => ({}))
            if (!response.ok) throw new Error(data && data.error ? data.error : `http-${response.status}`)
            setStatus('saved')
          })
          .catch((error) => {
            setDetail(error?.message ?? 'unknown')
            setStatus('error')
          })
      }

      let hint = null
      if (status === 'loading') hint = h('span', { style: S.feedback }, t('promptLoading'))
      else if (status === 'saving') hint = h('span', { style: S.feedback }, t('promptSaving'))
      else if (status === 'saved') hint = h('span', { style: { ...S.feedback, color: C.success } }, t('promptSaved'))
      else if (status === 'empty') hint = h('span', { style: { ...S.feedback, color: C.danger } }, t('promptErrorEmpty'))
      else if (status === 'load-error') hint = h('span', { style: { ...S.feedback, color: C.danger } }, t('promptErrorLoad'))
      else if (status === 'error') hint = h('span', { style: { ...S.feedback, color: C.danger } }, `${t('promptErrorSave')}${detail ? ` (${detail})` : ''}`)

      return h(
        'div',
        { style: { display: 'flex', flexDirection: 'column', gap: '10px' } },
        h('span', { style: { ...T.caption, color: C.secondary } }, t('promptDescription')),
        h(
          'div',
          { className: 'inv-card', style: { ...S.card, padding: '10px 12px', background: C.fill, border: 'none' } },
          h('textarea', {
            className: 'inv-textarea',
            style: {
              boxSizing: 'border-box',
              width: '100%',
              minHeight: '180px',
              resize: 'vertical',
              margin: 0,
              padding: '10px 12px',
              color: C.text,
              background: C.base,
              border: `1px solid ${C.hairline}`,
              borderRadius: '10px',
              outline: 'none',
              fontFamily: FONT_MONO,
              fontSize: '12.5px',
              lineHeight: 1.6,
            },
            value: text,
            placeholder: t('promptPlaceholder'),
            disabled,
            spellCheck: false,
            'aria-label': t('promptSection'),
            onChange: (event) => {
              setText(event.target.value)
              if (status !== 'saving') {
                setStatus('idle')
                setDetail('')
              }
            },
          }),
        ),
        h(
          'div',
          { style: { display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' } },
          h(
            'button',
            {
              type: 'button',
              className: 'inv-btn inv-primary',
              style: { ...S.primary, ...(disabled ? { opacity: 0.5, cursor: 'default' } : {}) },
              disabled,
              onClick: onSave,
            },
            status === 'saving' ? t('promptSaving') : t('promptConfirm'),
          ),
          hint,
        ),
      )
    }
