
    return {
      name: 'dsh-inventory',
      inject: ['slots', 'locale', 'layout'],
      apply,
      // Named so the browser-half tests can mount one live section on its own
      // without re-expanding the whole panel and remounting it.
      __webSearchProviders: WebSearchProviders,
      __promptInjector: PromptInjector,
      __credentialVault: CredentialVault,
      __pluginUpdateAction: PluginUpdateAction,
      __pluginUpdateBadge: PluginUpdateBadge,
    }
  },
})
