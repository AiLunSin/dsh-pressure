# DSH Pressure（压力表）

> 给 DeepSeek Harness 的 agent 循环装一块压力表：先看见浪费，再决定要不要踩刹车。

**状态：v0.1.0，Host 半已实现并通过测试；Client 面板已构建但未做真实浏览器人工验收。** 尚未发布 npm。详见 [实现状态](./docs/implementation-status.md)。

| 文档 | 内容 |
|---|---|
| [需求单](./docs/requirements.zh-CN.md) | 目标、用户、场景、FR/AC、范围、指标、里程碑、风险 |
| [技术方案](./docs/technical-design.zh-CN.md) | DSH 集成点、投影、预算状态机、回执存储、只读 API、面板、测试与基准 |
| [兼容性勘察](./docs/compat-notes.md) | DSH `0.2.2-rc.3` 的实际接口、偏差 D-1…D-7、集成验证结果 |
| [实现状态](./docs/implementation-status.md) | 里程碑完成度、验证证据、已知限制、下一步 |

## 它是什么

DSH 已经能测量 token、显示统计、自动压缩上下文，也能提醒完全重复的工具调用。但这些能力是分散的、描述性的、事后的。

DSH Pressure 把它们组织成一个闭环：

1. **Gauge 仪表**：每轮/每步的 token、缓存、上下文压力、工具失败、墙钟时间。
2. **Diagnosis 诊断**：把数字翻译成有证据的浪费信号与下一步建议。
3. **Valve 阀门**：`observe` / `coach` / `enforce` 三档；默认观察，强制模式显式开启。
4. **Receipt 回执**：每轮一张不含正文、可导出的效率回执，用对照基准证明有没有用。

设计上**不注册模型工具、不调用模型、不保存正文**。插件空闲时几乎不进入模型上下文；只有 `coach` 提醒或 `enforce` 拒绝时，才追加一条短消息或拒绝理由。

## 它不是什么

- 不是压力测试/并发压测工具；“压力”指运行时的成本与上下文压力。
- 不是成本账单、模型路由、上下文摘要器。
- 不是“效率分”营销面板；v0.1 只给独立维度与可解释信号。
- 不注册模型工具、不调用模型、不保存 prompt/工具参数/工具结果正文。

## 安装

尚未发布 npm。开发期从本地目录安装：

```bash
dsh plugin add /absolute/path/to/dsh-pressure
# 或使用 Plugin Manager 选择本地目录
```

安装后确认：

- 侧边栏出现 **Pressure** 图标；
- `/squeeze status` 可用；
- 跑完一轮后出现第一张回执。

> 验证时建议使用临时 profile 与独立 `DSH_HOME`，不要直接在主力 profile 上试。

## 先看效果（不需要模型）

```bash
npm run demo
```

合成一段两轮会话：第一轮健康，第二轮连续工具失败 + 超大结果 + 一次压缩。输出两张回执的 Markdown、JSON、CSV，写到 `.tmp/demo/`。

## 命令

| 命令 | 行为 |
|---|---|
| `/squeeze` / `/squeeze status` | 当前模式、预算、已用、信号数、回执数 |
| `/squeeze report [turn]` | 最近一轮或指定轮的回执摘要 |
| `/squeeze mode observe / coach / enforce` | 切换当前会话模式（内存态，重启回配置默认） |
| `/squeeze budget session <tokens>` | 会话 token 预算；0 = 不限 |
| `/squeeze budget turn <tokens>` | 单轮 token 预算 |
| `/squeeze budget tools <n>` | 单轮工具调用上限 |
| `/squeeze flags` | 列出本轮信号与证据计数 |
| `/squeeze mute <code>` / `unmute <code>` | 静音/恢复提醒（不影响回执记录） |
| `/squeeze purge --yes` | 清空当前会话回执（显式确认） |

命令不产生模型消息；结果只在命令面板显示。

## 配置

bundle 行上的 `config`（见 [`examples/profile-patch.yml`](./examples/profile-patch.yml)）：

| 字段 | 默认 | 合法范围/说明 |
|---|---|---|
| `mode` | `observe` | `observe` / `coach` / `enforce` |
| `locale` | `auto` | `auto` / `zh` / `en`（Host 文案） |
| `budget.sessionTokens` | `0` | 0…1e9；0 = 不限 |
| `budget.turnTokens` | `0` | 0…1e9 |
| `budget.turnToolCalls` | `0` | 0…1e6 |
| `thresholds.contextPressure` | `0.8` | 0.5–0.99 |
| `thresholds.budgetPressure` | `0.8` | 0.5–0.99 |
| `thresholds.failureStreak` | `2` | 1–50 |
| `thresholds.bloatedResultTokens` | `8000` | 500–1e6（估算值，不计费） |
| `thresholds.compactionChurn` | `2` | 1–20 |
| `coach.maxPerTurn` | `3` | 1–10 |
| `storage.retentionDays` | `30` | 1–3650 |
| `storage.maxReceiptsPerSession` | `2000` | 1–100000 |
| `storage.maxTotalBytes` | `52428800` | 64 KiB–1 GiB |
| `storage.dataDir` | `null` | 覆盖默认 `$DSH_HOME/squeeze` |
| `http.enabled` | `true` | 关闭只读 HTTP API |

非法配置在加载时失败，并指出字段与合法范围；不会静默回退。Host 文案默认跟随进程 locale，中文可显式设 `locale: zh`；面板文案跟随 Client 语言设置。

## 数据与隐私

回执目录（默认 `~/.dsh/squeeze/`）：

```
receipts/<sha256(sessionId)>.jsonl   # 每轮一张，幂等
exports/                             # 导出文件（按需）
logs/actions.jsonl                   # 模式/预算/静音/清理审计
```

- 只保存数字、稳定 code、建议键；工具参数只取哈希用于重复检测，不落盘。
- 不含 prompt、工具参数原文、工具结果原文、密钥。
- POSIX 下目录 `0700`、文件 `0600`；Windows 只做 best-effort，不伪造权限结论。
- 卸载/禁用不删除回执；清理必须显式 `/squeeze purge --yes`。
- 零外部网络请求；只注册宿主同源只读 HTTP，不新开端口。

口径：

- `tokens.total = input + output + cacheRead + cacheWrite`，表示 token 体积，不是价格。
- `cacheHitRate = cacheRead / (cacheRead + input + cacheWrite)`；分母为 0 或字段缺失时为 `null`（UI 显示“未知”）。
- 上下文压力优先取 `ctx.tokenMeter.contextPressure()`；插件未采样到时标 `end-only` / `unavailable`，不猜历史峰值。

## 兼容性

- DeepSeek Harness `>=0.2.2-rc.3 <0.3.0`，Node ≥ 22。
- 零运行时依赖：不 import `@deepseek-ai/*` 包，只通过 `ctx` 提供的服务集成。
- 与官方 `token-meter`、`session-projection`、`session-stats`、`compaction-basic`、`repeat-tool-reminder`、`spill-policy` 共存，不替代。
- 缺失可选服务时降级为“不可用”，插件仍能记录回执；`tools` 是唯一硬依赖。

## 明确的限制

- **`enforce` 是工具刹车，不是零超支保证**：token 用量在响应后才可知，回执会显示超支量，最终回答仍会计费。
- 面板是 root 作用域，无法自动知道“当前会话”；默认展示最近活动会话，可在下拉框切换。
- 插件在会话中途加载时，该轮标 `partial`，token 增量与历史峰值不猜测。
- 真实浏览器渲染尚未人工验收；headless 浏览器在本机不可用。

## 开发

```bash
npm test        # node:test，48 项
npm run lint    # 语法 + 隐私/零网络/零模型策略检查
npm run check   # lint + test
npm run demo    # 离线合成会话 → 回执 → 导出
npm run bench   # fold / 写入微基准
```

## 许可证与声明

MIT。非 DeepSeek 官方项目，与 DeepSeek 官方无隶属、无背书关系。DeepSeek Harness、DSH 及相关商标归其所有者。第三方插件名称仅用于说明差异，不代表其作者对本项目的背书。
