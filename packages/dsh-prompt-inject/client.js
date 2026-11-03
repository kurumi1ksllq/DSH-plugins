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
    const React = require('react') // bundle contract: client halves require react

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
