# Fork 改动清单 / Fork Modifications

本仓库基于 [anomalyco/opencode](https://github.com/anomalyco/opencode) 二次开发。本文件登记所有与上游不同的改动，方便 review 与上游合并。

This repository is a fork of [anomalyco/opencode](https://github.com/anomalyco/opencode). This file tracks every divergence from upstream for review and upstream-merge purposes.

## 改动列表 / Modifications

| # | 改动 / Change | 分支引入 / Introduced | 说明 |
|---|---|---|---|
| 1 | 非 UTF-8 文件编码支持（file_encoding 配置、BOM/UTF-16/GBK 等检测与往返）| `feat(tool): support non-utf8 file encodings` | V1 工具 + 公开 schema；对应上游 PR #49881（issue #45924） |
| 2 | V2 core 引擎同步支持编码 + 默认拒绝损坏非 UTF-8 文件 | `feat: full file-encoding support across v1 tools, v2 core tools, and tool descriptions` | core 工具接入 Encoding 模块 |
| 3 | 桌面端支持本地构建 CLI（`OPENCODE_LOCAL_CLI=1` 跳过下载官方二进制）| `chore(desktop): allow local CLI build via OPENCODE_LOCAL_CLI=1` | 开发用，便于桌面端验证本地改动 |
| 4 | README 二改声明、FORK.md、LICENSE 追加 fork 版权 | `docs: mark repository as modified fork` | MIT 合规，保留原版权 |
| 5 | 项目头像/通知图标改用本地资源 + Avatar 加载失败回退 | `fix(app): use bundled icons and add avatar error fallback` | opencode.ai 在部分网络环境不可达导致图标空白 |
| 6 | 桌面端侧边栏重设计（新建任务/搜索菜单 + 项目/时间分组标签页）| `feat(app): redesign sidebar with task menu and project/group tabs` | 参考自用工具布局 |
| 7 | 侧边栏全窗口宽度常驻（断点 xl→lg，窄窗口不再隐藏）、默认展开、☰ 改为主侧边栏开关 | `feat(app): show sidebar from lg breakpoint instead of xl` / `fix(app): keep sidebar rail with redesigned fork panel` | 窄窗口体验 |
| 8 | 移除会话页顶部重复的会话标题栏（与标题标签页重复）| `feat(app): remove duplicate session header bar` | 界面简化 |
| 9 | 固定使用经典布局（含侧边栏），禁用上游默认的无侧边栏标签页布局 | 本文件所在提交 | 新版布局没有侧边栏，与二改方向冲突；Ctrl+B 恢复为侧边栏开关 |

## 与上游合并 / Upstream merge workflow

```bash
# dev 分支保持为纯净上游镜像（tracking upstream/dev，不放任何 fork 提交）
git checkout dev && git pull upstream dev

# 合入二改主线
git checkout fork
git merge upstream/dev
```

- 二改尽量用新文件 + 集中接线点，减少冲突面。
- 冲突高发区：`README.md`（上游频繁变更，声明块独立成段）、`packages/opencode/src/tool/*`（若上游也改编码逻辑）。

## 新增依赖 / Added dependencies

- `iconv-lite`（packages/opencode、packages/core）— 非 UTF-8 编解码，懒加载
