# issue-289 credential-vault 错误面加固(畸形 iv/tag 与残留 .new)

分级:standard(2 个源文件 + 2 个新测试,接口不变)

## 问题(来源 #268)
1. `openEnvelope` 对畸形 iv/tag 抛原始 `TypeError`(如 `ERR_CRYPTO_INVALID_AUTH_TAG`)。本包的设计是「单一错误、无 oracle」,TypeError 泄露了「哪个字段先坏了」,可用来区分「密码错」与「密文损坏」。
2. `rotateKey` 用 `'wx'` 独占写 `vault.json.new`;上一次轮换中途退出留下的暂存文件会让之后每次 rotate 都 `EEXIST`,且错误不说明原因。

## 修法
1. `lib/envelope.mjs`:把 key 派生、iv 解析、AAD、tag 解析、解密全部收进同一个 try;任何非 `EnvelopeError` 的异常(含 TypeError)折叠成与解密失败完全相同的 `EnvelopeError('decryption failed')`。
2. `lib/vault-store.js`:`rotateKey` 在独占写暂存文件前先 `rmSync(force)` 掉残留。安全性依据:store 创建时的 D4 恢复已经给过残留文件一次「被采纳」的机会(校验得通就换上去了),走到 rotate 还没被采纳,说明它换不上,删除不会丢有效状态。

## 验收
- `test/issue-289-envelope-oracle.test.mjs`:错密码 / 畸形 iv(过短、非 base64、缺失)/ 畸形 tag(过短、缺失)返回同一种错误;断言不再是 TypeError。
- `test/issue-289-rotate-leftover.test.mjs`:预置残留 `vault.json.new` 后 rotate 要么安全完成、要么给可读错误,且凭据不丢。
- 反向验证:还原两处实现时两个测试分别变红(已实测)。
- 包全量测试 243/243 通过。

## 变更点
无(未改动接口与文件格式)。
