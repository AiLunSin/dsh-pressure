# DSH Pressure · Plugin detail

> 非 DeepSeek 官方项目。

## 它做什么

DSH Pressure 在每一轮结束后写一张**不含正文**的效率回执，并在会话进行时显示 token、上下文、工具与时间的压力读数。它把读数翻译成五类有证据的浪费信号，并提供一个默认关闭、可随时松开的阀门：`observe` 只看，`coach` 追加短提醒，`enforce` 在观测到预算超限后暂停新的工具调用。

## 它不做什么

- 不注册模型工具，不调用模型，不新增系统提示。
- 不压缩上下文、不换模型、不改写提示。
- 不保存 prompt 正文、工具参数、工具结果或密钥。
- 不做账户账单或跨机器同步。

## 配置

在 bundle 行上覆盖 `config`（见 `examples/profile-patch.yml`）：

| 字段 | 默认 | 说明 |
|---|---|---|
| `mode` | `observe` | `observe` / `coach` / `enforce` |
| `budget.sessionTokens` | `0` | 会话 token 上限；0 = 不限 |
| `budget.turnTokens` | `0` | 单轮 token 上限；0 = 不限 |
| `budget.turnToolCalls` | `0` | 单轮工具调用上限；0 = 不限 |
| `thresholds.contextPressure` | `0.8` | 上下文占用提醒阈值 |
| `thresholds.budgetPressure` | `0.8` | 预算使用提醒阈值 |
| `thresholds.failureStreak` | `2` | 连续工具失败阈值 |
| `thresholds.bloatedResultTokens` | `8000` | 单次工具结果过大阈值（估算） |
| `thresholds.compactionChurn` | `2` | 单轮压缩次数阈值 |
| `coach.maxPerTurn` | `3` | 每轮最多提醒条数 |
| `storage.retentionDays` | `30` | 回执保留天数 |
| `storage.maxReceiptsPerSession` | `2000` | 每会话回执上限 |
| `storage.maxTotalBytes` | `52428800` | 回执总字节上限（50 MB） |
| `locale` | `auto` | Host 文案语言：`auto` / `zh` / `en` |

命令：`/squeeze status|report|mode|budget|flags|mute|unmute|purge`。

## 数据与隐私

回执存于 `$DSH_HOME/squeeze/`（默认 `~/.dsh/squeeze`）：`receipts/*.jsonl`、`exports/`、`logs/actions.jsonl`。只保存数字、稳定 code、不可逆哈希；参数只用于重复检测的哈希，不落盘。POSIX 下目录 `0700`、文件 `0600`；Windows 仅 best-effort，不做权限结论。

## 已知限制

- 强制模式是**工具刹车**，不是零超支保证：token 用量在响应后才可知，最终回答仍会计费。
- 面板是 root 作用域，无法直接知道“当前会话”；默认展示最近活动的会话，可在下拉框切换。
- 插件在会话中途加载时，该轮标记 `partial`，token 增量与历史峰值不猜测。
