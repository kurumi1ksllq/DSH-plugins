# dsh-credential-vault

DeepSeek Harness 凭据保险库插件：把服务器登录密码、GitHub token、API key 等凭据
AES-256-GCM 加密保存在 `$DSH_HOME/credential-vault/`，AI 在需要时通过一个
`credential` 工具按名称读取并使用。

## 它做什么

- **加密存储**：首次使用自动生成 32 字节主密钥（`master.key`，0600）；每条凭据
  用 AES-256-GCM 单独加密后写入 `vault.json`（0600，原子写）。支持主密钥轮换
  （全部条目重新加密，旧密钥备份为 `master.key.bak`）。
- **AI 读取**：注册一个 `credential` 工具，三种动作：
  - `action:"list"` — 只列名称、类型、备注，不含任何密钥值；
  - `action:"get", name:"…"` — 返回掩码元数据，密钥不解封；
  - `action:"reveal", name:"…"` — 返回明文。**每一次 reveal 都写入审计日志**
    （`audit.log`，JSON lines，面板可见）。
- **提示词约定**：注入一段 system prompt，告诉模型这个工具存在、先 list 再按名
  取用、未获用户指示先询问、不得把明文写进无关文件或消息。
- **侧栏面板**：凭据列表（掩码预览）+ 新增/编辑/删除 + 主密钥轮换 + 使用日志。
  **面板的所有接口都不回传明文**——`set` 只收不吐。

## 安装

profile 的 `package.json` 里加一行：

```json
"dependencies": {
  "dsh-credential-vault": "link:../../packages/dsh-credential-vault"
}
```

然后 `pnpm install`，重启 DSH。

## HTTP 接口（面板用，非面板调用方请勿依赖）

| 路由 | 方法 | 作用 |
| --- | --- | --- |
| `/credential-vault/api/list` | GET | 掩码条目列表 |
| `/credential-vault/api/entry?name=x` | GET | 单条掩码元数据 |
| `/credential-vault/api/audit` | GET | 最近 100 条读取记录 |
| `/credential-vault/api/set` | POST | 新增/更新（明文只进不出） |
| `/credential-vault/api/delete` | POST | 删除一条 |
| `/credential-vault/api/rotate` | POST | 轮换主密钥 |

所有 POST 都做同源校验（`sec-fetch-site` / `Origin` / `Host`），跨站请求 403。

## 安全边界

- 明文只存在于进程内存和 `credential` 工具的返回值里；侧栏 HTTP API 的任何响应
  都不含密钥值（测试覆盖了这一点）。
- 审计日志只记名称、结果（ok / missing / rejected）、来源和时间，不记值。
- 凭据名不允许路径分隔符和控制字符；密钥与 vault 文件均为 0600，写入走临时文件
  + rename 的原子路径。
- 主密钥在 `$DSH_HOME` 里是唯一防线：保好那台机器的磁盘权限。要更强的威胁模型
  请接外部 KMS，本插件不假装能防 root。

## 测试

```bash
pnpm --filter dsh-credential-vault test
```

31 个测试覆盖：加解密往返与防篡改、掩码规则、文件权限、名称校验、store 全操作、
审计追加/截断、HTTP 路由/校验/同源/405/404，以及工具契约（list 无值、reveal 入
审计、明文不出现在任何响应或日志里）。
