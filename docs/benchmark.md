# 基准预注册（M4）

> 状态：**已预注册，已跑一次 1 元预算冒烟**（[结果](./smoke-2026-11-13.md)：108 次、105 通过、约 ¥0.59）。预注册的完整结论仍未完成：D 组因单轮任务无法轮内结算 token 而改用工具调用上限，coach 在本次任务集上完全没有触发。
> 预注册时间：2026-11-13。任务、分组、指标与停止条件在跑第一次之前固定；任何后改都必须在报告里注明。

## 研究问题

- **RQ1 中性**：`observe` 相对基线，token、工具调用、墙钟的变化是否可忽略（|Δ| ≤ 3%）？
- **RQ2 收益**：`coach` / `enforce` 在循环密集型任务上能否减少工具调用与 token，而不降低成功率？
- **RQ3 可读**：用户能否在 10 秒内从回执说出“哪里浪费、下一步做什么”？（v0.1 不做问卷，仅记录回执是否生成与可导出。）

## 任务集（9 个，合成、可自动验收）

任务定义在 [`bench/tasks.mjs`](../bench/tasks.mjs)，每个任务生成一个极小仓库，验收统一为 `node check.mjs` 退出码 0。

| ID | 类别 | 内容 | 验收要点 |
|---|---|---|---|
| `bugfix-offbyone` | 单文件修复 | `sum()` 漏掉最后一个元素 | `sum([1,2,3]) === 6` |
| `bugfix-null` | 单文件修复 | `displayName(null)` 崩溃 | 返回 `anonymous` |
| `bugfix-import` | 单文件修复 | 相对导入路径写错 | `main.js` 可加载 |
| `feature-slug` | 多文件功能 | 实现 `slugify()` | 三种输入 |
| `feature-csv` | 多文件功能 | 实现带引号转义的 `toCsv()` | 固定输出字符串 |
| `feature-retry` | 多文件功能 | 实现 `retry(fn,{attempts})` | 成功与最终失败 |
| `investigate-constant` | 调查型 | 10 个模块中 1 个常量不一致 | 全部等于 config |
| `investigate-duplicate` | 调查型 | 12 份重复 `normalize()` 收敛到共享实现 | 共享模块 + 全部导出 |
| `investigate-perf` | 调查型 | 把 O(n²) 去重改成线性 | 50k 输入 < 300 ms |

每个任务在**未修改**时必须失败；`test/bench.test.js` 会为 9 个任务逐一断言这一点，防止“自带答案”。

## 分组

| 组 | Profile | 插件 | 配置 |
|---|---|---|---|
| A 基线 | 自带 `headless` | 无 | 官方插件默认 |
| B 观察 | `pressure-b` | 有 | `mode: observe` |
| C 教练 | `pressure-c` | 有 | `mode: coach`，默认阈值 |
| D 强制 | `pressure-d` | 有 | `mode: enforce`，`budget.sessionTokens = A 组中位数 × 0.8` |

固定：同一模型/路由、同一 prompt、同一任务生成结果、同一 Node/DSH 版本、同一机器；不启用额外工具或 MCP。
每组每任务 **3 次**；运行顺序用固定种子打乱；失败与超时保留，不重试替换。

## 指标

主指标（全部来自官方 Session 日志，见 [`bench/metrics.mjs`](../bench/metrics.mjs)）：

1. 成功率：验收通过 / 总运行数。
2. `tokens.total`：`assistant/message.usage` 的 input + output + cacheRead + cacheWrite 之和。
3. 工具调用数：`tool/call` 事件数。
4. 墙钟：首次 `turn/start` 到最后一个事件。

次指标：工具失败数、压缩次数、缓存命中率；B/C/D 另取回执中的信号 code 与 `denied` 数（只做交叉核对）。
报告：中位数 + 全距；不报单次最优；成功率的下降与 token 的节省分开列。

## 执行

```bash
# 1) 预览计划，生成 9 个工作区（不会调用模型）
node bench/plan.mjs --materialize bench/runs/plan

# 2) 准备 profile（见 plan 输出；D 组预算在跑完 A 后按中位数 ×0.8 设置）
# 3) 干跑，确认矩阵
node bench/run.mjs --profiles A=headless,B=pressure-b,C=pressure-c,D=pressure-d \
  --dsh-home ~/.dsh --out bench/runs/2026-11-13

# 4) 真正执行（会消耗模型额度）
node bench/run.mjs --profiles A=headless,B=pressure-b,C=pressure-c,D=pressure-d \
  --dsh-home ~/.dsh --out bench/runs/2026-11-13 --execute

# 4b) 预算冒烟：限制总 token，达到后停止并保留已跑行
node bench/run.mjs --profiles A=pressure-smoke-a,B=pressure-smoke-b,C=pressure-smoke-c,D=pressure-smoke-d \
  --dsh-home ~/.dsh --out bench/runs/smoke --execute \
  --tasks bugfix-offbyone,feature-slug,investigate-constant --groups A,B,C,D --reps 1 --max-tokens 300000

# 5) 生成报告
node bench/report.mjs --results bench/runs/2026-11-13/results.jsonl
```

## 停止条件与诚实报告

- 只允许因**安全/预算**停止：单次运行超时 10 分钟、总运行次数达到上限、或显式预算耗尽。不得因为“结果不好看”提前停止。
- 缺失行（超时、无 Session 日志）保留在 `results.jsonl`，报告标 `—` 并列入 Warnings；不用其他组的值填补。
- 若 D 组成功率相对 A 下降超过 10 个百分点，报告必须写“**不推荐默认开启 enforce**”。
- 若 B 组相对 A 的开销 > 3%，先优化再发布，不把开销当噪声。
- 原始数据只含数字、稳定 code 与验收输出；**不发布** prompt 文本、工具参数/结果、Session 日志原文。

## 执行中的预算与偏差

- `bench/run.mjs` 支持 `--max-tokens` 与 `--max-cny` 硬上限：每跑完一行检查已用 token 与按 DeepSeek Flash 官方价估算的 CNY，达到上限即停止，报告会标记缺失行。
- 单轮 headless 任务里，**会话/单轮 token 预算要到轮末才结算**，因此 `enforce` 无法在当轮按 token 刹停；唯一能在轮内生效的是 `turnToolCalls`。预算冒烟中 D 组因此使用 `turnToolCalls: 6`，这与预注册的“会话 token = 基线中位数 ×0.8”不同，报告必须注明。
- 真实模型回合会写入真实 `$DSH_HOME/sessions` 与回执；基准只保存数字、稳定 code 与验收输出，不保存 prompt/工具正文。

## 已知限制

- 9 个极小合成任务、每组 n=3，统计功效弱；结论只适用于“本机本模型本任务集”。
- 任务验收是单文件/小仓库，不能外推到大型代码库。
- 模型与路由变化会改变绝对值；跨版本比较只看同批次。
- 基线与处理组无法完全双盲（插件信号本身是干预）。
