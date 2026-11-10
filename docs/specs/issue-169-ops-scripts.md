# issue-169 · 把 skill-surface 的接线/回滚脚本收进 scripts/

> 分级 standard（新增两个可执行脚本 + 一条仓库守卫 + 文档同步）。

## 目标

1. 两个脚本入库、参数化（不写死 `/root` 与 profile 名）。
2. **默认不重启**；只有显式 `--restart` 才动服务。
3. 文档运维段改指向仓库内路径。
4. 部署宿主上的旧脚本改为转发，避免两份实现漂移。

## 边界

不改 profile、不重启、不改插件代码。

## 设计要点（来自双轴 review 的收敛）

- 共享 `scripts/lib/dsh-profile.sh`：profile 解析顺序 `--profile > $DSH_PROFILE_DIR > ${DSH_HOME:-$HOME/.dsh}/profiles/${DSH_PROFILE_NAME:-web}`；unit 名 `$DSH_SERVICE` 可换。
- `--dry-run` 与写路径**共用同一套判断**，不再出现"dry-run 说要追加、实际已接线"。
- 拒绝在"已接线但没有基线"时快照（否则会把已装状态存成回滚基线），除非 `--accept-current-as-baseline`。
- 拒绝把非 manifest 的 JSON 当 `--baseline` / `--profile`。
- rollback 覆盖前先备份当前 profile（`package.json.pre-rollback.<UTC>`），并打印将被丢弃的 deps/bundles 差集；非 `--yes` 只打印计划。
- `--restart` 后轮询 `systemctl is-active`（≤10s）核验，失败 exit 1 并给 `journalctl` 提示；不再 `sleep + || true`。
- 从 linked git worktree 运行时，非 dry-run 直接拒绝（`--force` 才放行）。

## 验收

| # | 验收 | 判定 |
| --- | --- | --- |
| C1 | dry-run 不改任何文件，且输出与真实动作一致（已接线时不再说"将追加"） | `test/skill-surface-scripts.test.mjs` |
| C2 | 未传 `--restart` 时绝不调用 `systemctl` | 同上（假 `systemctl` 落盘探针） |
| C3 | 非 manifest 的 `--baseline` 被拒（exit 1） | 同上 |
| C4 | 已接线的 profile 不会被误存成基线 | 同上 |
| C5 | 所有 `docs/specs/.flow/*.json` 合法且枚举不越界 | `test/flow-state.test.mjs` |
| C6 | 旧脚本（部署宿主）转发到仓库脚本 | 人工（不在仓库内） |

## 裁剪

无裁剪。
