# dsh-git-status

DeepSeek Harness 插件:当前工作区是 git 项目时,侧栏多一个 **Git** 面板,一屏看清仓库现状。

**只读。** 插件对仓库只执行 `git` / `gh` 的只读子命令,没有任何写路由,不改动任何文件。

## 看什么

| 卡片 | 内容 |
| --- | --- |
| 当前仓库 | 当前分支(可复制)、领先/落后、已跟踪改动 / 未跟踪 / **冲突**三个独立计数、最近提交(可复制 hash)、远程列表 |
| 改动文件 | 按 **冲突 / 已暂存 / 未暂存 / 未跟踪** 分组列出实际路径,点击展开只读 diff(最多 200 项,超出会标注总数) |
| 领先上游的提交 | `@{u}..HEAD` 里还没推上去的 commit 标题 |
| Stash | 每个 stash 的 `stash@{n}`、时间、说明(不只一个数字) |
| 分支 | 本地分支(标当前、标"上游已删除"、ahead/behind)+ 最近一次提交的「时间 · 说明」,另有远程跟踪分支 |
| 未合并 PR | 打开中的 PR(草稿/冲突标记、head→base、外链)+ 最近已合并(提示本地分支可能可清理) |
| Issue | 打开中的 issue(外链) |

### 冲突是独立状态

`git status --porcelain=v2` 里 `? ` 是**未跟踪**、`u ` 是**未解决冲突**。两者后续动作完全相反(前者不该提交,后者必须先解决),所以快照里分成 `untracked` 与 `conflicts` 两个字段;冲突数 > 0 时面板顶部给出醒目横幅。

### 可操作入口

- 分支名、commit hash、stash ref 点击即复制(`navigator.clipboard`,失败回退 `execCommand`);
- 分支 / commit / ahead commit 右侧有 GitHub 深链(`owner/repo` 由 remote URL 推出);
- 任一改动文件点开即可看只读 diff,不需要自己打开编辑器。

## PR / issue 数据从哪来

只用 **gh CLI**,认证按两路独立判断:

- `gh auth status` 成功(CLI 登录会话),**或**
- 进程环境里有 `GH_TOKEN` / `GITHUB_TOKEN`(例如 systemd 里配的 `Environment=GH_TOKEN=...`)

任一满足就查询 PR / issue。插件不读、不存任何 token,只用 `gh` 的默认凭据链。

卡片为空时会给出**具体原因**(`forgeHint`),不再笼统说"gh 查询失败":

| 原因 | 面板提示 |
| --- | --- |
| `not-installed` | 未检测到 gh CLI |
| `not-logged-in` | gh 已安装但未认证 |
| `no-remote` | 仓库没有配置 remote,没有 PR / issue 可查 |
| `not-github` | 远程不是 GitHub,不适用 GitHub 口径的查询 |

## 路由

| 路由 | 方法 | 作用 |
| --- | --- | --- |
| `/git-status/snapshot?sessionId=<id>` | GET | 全部信息一次返回;`?refresh=1` 绕过缓存 |
| `/git-status/diff?sessionId=<id>&path=<仓库相对路径>` | GET | 单个改动文件的只读 diff;路径越出工作区直接 404 |

两者都只接受 GET,跨源请求返回 403,响应 `cache-control: no-store`。

## 工作区判定

面板跟随**当前会话**:前端把会话 id 带上,后端读该会话 header 里的 `cwd`(先查活动会话,再查会话持久化),从那里往上找最近的 `.git` 祖先。

- 会话 `cwd` 不在 git 仓库里 → 显示空态,**不会**回退去读别的目录的仓库。
- 拿不到会话 id 时(直接 curl、非会话场景)才退回 `$DSH_WORKSPACE` / `$DSH_CWD` / 进程 cwd。

> 注意:web 服务进程自身的 cwd 通常是启动目录(如默认工作区),和用户正在看的仓库无关——这正是之前"识别不到当前仓库"的原因。

### 缓存键 = 会话 + 工作区

快照缓存 30 秒,键是 `会话 id + 解析出的仓库根`。只按会话 id 分键时,在同一会话里 `cd` 到另一个仓库(或新建 worktree)后会继续显示上一个仓库最长 30 秒;加上工作区后,换目录立即重建,停在同一个仓库时仍然命中缓存。

## 安装

profile 的 `package.json` 加一行:

```json
"dsh-git-status": "link:../../packages/dsh-git-status"
```

然后 `pnpm install`,重启 DSH。

## 测试

```bash
pnpm --filter dsh-git-status test
```

覆盖:porcelain v2 解析(含 rename 的原始路径、冲突、截断)、stash / 分支 tip / ahead 提交、
缓存键与换目录、diff(未暂存 / 已暂存 / 未跟踪 / 越界拒绝),以及前端面板在真实快照下的渲染
(冲突横幅、文件分组、外链 URL、复制入口)。
