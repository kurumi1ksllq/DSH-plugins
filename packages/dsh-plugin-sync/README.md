# dsh-plugin-sync

启动时对齐插件：读目标 git 仓库的清单，比对本 profile 已装的插件，缺的装、旧的就报。

## 为什么是插件而不是脚本

比对需要 profile 自己的 `package.json` 和 `node_modules` 布局。这些只有 DSH 决定要启哪个 profile 之后才存在。插件能通过 `ctx.baseUrl` 直接拿到，跑在启动流程里，还能复用同一个 web server 上报结果。

## 默认什么都不做

`repo` 默认是空字符串。**空 = 插件加载但完全静默，不碰网络。**

要启用，在 profile 的 `cordis.patch.yml` 里覆盖：

```yaml
- id: plugin-sync
  config:
    repo: https://github.com/<owner>/<repo>.git
    ref: main
    apply: true
```

## 清单格式

目标仓库根目录放一个 `dsh-plugins.json`：

```json
{
  "plugins": [
    { "name": "dsh-ctx-guard", "version": "0.1.1" },
    { "name": "dsh-inventory", "version": "0.1.0", "spec": "github:owner/DSH-plugins#v0.1.0" }
  ]
}
```

| 字段 | 必填 | 作用 |
|---|---|---|
| `name` | 是 | 包名，对应 profile `dependencies` 的键 |
| `version` | 是 | 期望版本，与本地 `node_modules/<name>/package.json` 的 `version` 比对 |
| `spec` | 否 | 缺装时用哪个 spec 安装；省略则由 `apply` 的实现决定 |
| `repo` | 否 | 该插件单独来自另一个仓库时的提示 |
| `optional` | 否 | 标记为非必需 |

## 比对结果分四类

| 状态 | 含义 | apply 模式会动它吗 |
|---|---|---|
| `current` | 版本一致 | 否 |
| `outdated` | 已装，版本不同 | **是** |
| `missing` | 清单里有，本地没有 | **是** |
| `extra` | 本地有，清单没有 | **否** —— 本地自行加的插件不是错误 |

`@deepseek-ai/*` 内置包永远不会被当成 `extra`。

## 配置项

| 键 | 默认 | 说明 |
|---|---|---|
| `repo` | `''` | 目标仓库 URL。空 = 停用 |
| `ref` | `'main'` | 分支或 tag |
| `direction` | `'remote'` | `remote` = 清单为准；`local` = 只读不写 |
| `apply` | `false` | 真正执行安装/更新。**默认只报告** |
| `gitTimeoutMs` | `30000` | git 超时，最小 1000 |
| `skipBoot` | `false` | 启动时不检查（仍可手动触发） |
| `exclude` | `['dsh-plugin-sync']` | 永不自动改动的包名 |

## 三条硬约束

1. **永不阻塞启动。** 任何失败都降级成一条 warning。断网不能让 harness 起不来。
2. **默认只报告。** `apply: true` 是显式 opt-in。
3. **永不删除。** 本地多装的插件不会被移除。

第 4 条隐含约束：**它不更新自己**。运行中的 bundle 无法替换自己的文件，所以 `dsh-plugin-sync` 默认在 `exclude` 里。

## HTTP 接口

| 路由 | 作用 |
|---|---|
| `GET /plugin-sync/state` | 最近一次比对结果。启动尚未跑完时返回 `{ idle: true }` |
| `GET /plugin-sync/check` | 立刻重跑一次（不重新克隆会复用缓存状态） |

## 安装

profile 的 `package.json`：

```json
"dependencies": {
  "dsh-plugin-sync": "link:../../packages/dsh-plugin-sync"
}
```

`dsh.profile.bundles` 里加 `"dsh-plugin-sync"`，然后 `pnpm install`。

## 测试

```bash
node --test test/*.test.mjs
```

42 个用例，全部纯数据：配置合并、清单解析、四态比对、profile 读取、单轮 reconcile。**不联网、不起 harness。**

## License

MIT
