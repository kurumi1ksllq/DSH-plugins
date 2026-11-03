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
 * NO route returns secret material. The panel that renders these strings lives
 * in dsh-inventory's Tools page; this bundle only ships the dictionary.
 */
window.__ModuleLoader__.load({
  id: 'dsh-credential-vault',
  factory(require) {
    void require('react') // bundle contract: client halves require react
    const NS = 'credential-vault'

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
      inject: ['locale'],
      apply,
    }
  },
})
