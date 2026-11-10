# ecc-agent-presets

收纳 133 个 ECC 工程 agent preset(从主 profile patch 原样迁出,spec issue-151 功能二)。

## 用法

- **不装本 bundle**(默认):这些 preset 不注册 → 4 个 UI 显示面(Settings 卡片组 / 新会话 picker / 会话头标签 / Plugins 清单页切换器)都不显示;委派引用其 id 会报 `agent-preset/not-found`。
- **安装本 bundle**:133 行整体回归名册;`plugin_manager set_bundle ecc-agent-presets enabled:false` 可随时收起(免重启)。
- **白名单 5 件套**(planner / architect / code-reviewer / security-reviewer / build-error-resolver)保留在主 profile,与本 bundle 无关;`dsh-deep-ptc-mode` 的委派白名单只引用这 5 个 id。

## 结构

`cordis.patch.yml` 是一个 `- insert:` 块,133 行 `@deepseek-ai/dsh-agent-preset` 行原样迁自 `~/.dsh/profiles/web/cordis.patch.yml`(YAML round-trip,文本未改动)。
