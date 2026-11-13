# DSH 兼容性勘察记录（M0）

> 本文件记录 **实际运行环境** 中已验证的 DSH 接口事实，是 `docs/technical-design.zh-CN.md` 的实现依据与偏差说明。
> 勘察日期：2026-11-13。运行时：DeepSeek Harness `0.2.2-rc.3`（Desktop，profile `desktop`），Electron Node `v24.21.0`。

## 0. 勘察方法

- `cordis_inspect_list` / `cordis_inspect_query` 读取 Host Service、Host Event、Client Slots 的**运行时签名**。
- 用 `ELECTRON_RUN_AS_NODE=1` 读取 `app.asar` 内官方包 `src/`（`dsh-session`、`dsh-token-meter`、`dsh-session-stats`、`dsh-tools`、`dsh-commands`、`dsh-llm`、`dsh-compaction`、`dsh-repeat-tool-reminder`）。
- 与同环境已上线的社区插件 `dsh-swarm`、`dsh-cloud-memory` 的集成形态对照。

运行时确认：

| 项 | 值 |
|---|---|
| `DSH_INSTALL_DIR` | `%LOCALAPPDATA%\Programs\DeepSeek Harness\resources\app.asar\dsh\node_modules\@deepseek-ai\dsh` |
| `DSH_PROFILE` | `desktop` |
| CLI 版本 | `@deepseek-ai/dsh` `0.2.2-rc.3` |
| Node | `v24.21.0`（Electron ASAR 运行时） |

## 1. 已确认的接口

### 1.1 会话事件

`SessionEventMap`（`@deepseek-ai/dsh-session/src/types.ts:287`，外加 `dsh-compaction` 的声明合并）：

| 事件 | data | 用途 |
|---|---|---|
| `turn/start` | `{ turn }` | 轮开始 |
| `turn/end` | `{ turn, reason }` | 轮结束（回执触发点） |
| `step/start` / `step/end` | `{ turn, step }` | 步边界 |
| `tool/call` | `{ turn, step, callId, name, arguments }` | 参数是**原始 JSON 字符串** |
| `tool/result` | `{ turn, step, message, error?: {name,code,reason?}, meta? }` | `message.isError` 表示失败 |
| `assistant/message` | `{ turn, step, message, stream, usage?, interrupted? }` | `usage` 是 provider 上报值 |
| `compaction/start` | `{ compactionId, turn: number \| null }` | 压缩开始 |
| `compaction/end` | `{ compactionId, turn: number \| null, error?: string }` | 压缩结束（计数只认 end） |
| `command/run` / `command/done` | 见 `dsh-commands/src/types.ts` | 命令不进模型上下文 |

订阅方式：`ctx.on('session/event', (session, event) => …)`，**post-commit fire-and-forget**（`dsh-session/src/types.ts` 附近 `session/event` 声明）。`event.time` 为 epoch 毫秒，`event.seq` 为连续序号。

### 1.2 官方投影

`ctx.sessionProjections`（`dsh-session-projection`）：

- `snapshot(session, keys?)` **同步**返回 `{ asOfSeq, values }`；只计算被点名的 **client-visible** unit。
- `tokenUsage`（`dsh-token-meter` 注册，`key:'tokenUsage'`, `stateVersion:2`）：
  `{ uncachedInputTokens, outputTokens, cacheReadTokens, cacheWriteTokens }`（累计值，无 `total`）。
- `sessionStats`（`dsh-session-stats` 注册，`key:'sessionStats'`）：
  `{ turns, steps, llmMs, toolMs, ttftMs, ttftSteps, decodeMs, decodeTokens }`。
- `register()` 需要 **Zod** schema（`stateSchema: ZodType`），且返回 `Promise<ProjectionHandle>`。**deviation D-1**：本项目 Host-only 投影改为自建 `session/event` fold，不引入 `zod` 依赖；token/统计仍走官方 `snapshot`。

### 1.3 工具管线

`ctx.tools`（`dsh-tools`）：

- `guard(fn): () => void`，在**调用方 scope** 注册；`ToolGuard = (exec) => string | {reason, info?} | undefined`，同步、单调（`checkGuards`），返回即拒绝。
- `ToolExecution`：`{ callId, name, arguments, agent?, signal, … }`。
- `tools/post-execute`：waterfall，`(exec, result, next) => Promise<PostToolDecision>`；`PostToolDecision = { kind:'accept', content?, additionalContexts? } | { kind:'block', feedback, info?, additionalContexts? }`。
- 官方 `repeat-tool-reminder` 的成熟做法：**先 `await next()` 再合并 `additionalContexts`**，且 `createUserMessage({ content, source })` 的 `source` 自带 `kind`、`form:'notice'`、`summary`。本项目直接沿用该形态（`source.kind:'dsh-pressure'`）。
- `MessageSourceMap` 可被插件声明合并；运行时接受未知 `kind`，客户端对未知来源按不透明内容降级渲染。

### 1.4 Agent

`agent/created` payload：`{ agent, source, signal? }`；`agent` 上有 `id`、`session`、`ctx`（agent scope）、`cancel(cause)`、`inject(message)`。`agent/created` 是 **serial** 事件。插件加载前已存在的 agent 用 `ctx.agents.list()` 补绑。

### 1.5 命令

`ctx.commands.register(definition)`：

```js
{
  name: 'squeeze',              // 小写、无斜杠
  description: '…',              // 非空
  handler: async ({ agent, rawInput, signal, commandId }) => ({ kind:'success'|'error', text })
}
```

返回 disposer。命令文本由 Host 生成，**官方 `/compact` 也是英文单语**；本项目的命令文案跟随 Host 侧 locale 配置（见 deviation D-2）。

### 1.6 Web 路由

`ctx.get('webServer')?.register({ kind:'prefix', path:'/api/dsh-pressure', handler })`：

- `handler(req: IncomingMessage, res: ServerResponse)`，继承宿主认证/同源策略，不新开端口。
- 同一 `(kind,path)` 重复注册会抛错；返回 disposer。
- 也可用 `{ kind, path, resource(request, peer) }` 返回 `Response`。本项目沿用两个参考插件已验证的 Node handler 形态。

### 1.7 Client

- `dsh.client = { platform:'web', immediately:true }`；`client.js` 用 `window.__ModuleLoader__.load({ id:<包名>, factory(require){…} })`。
- `require('react')` 来自浏览器模块表。
- `sidebar.panellist`（list，root scope）注册 `{ id, order, label }` + 图标组件；点击后打开同 id 的 `main` keyed slot。
- `main`（keyed，root scope）注册 `{ key }` + 页面组件；`key` 不能与 `conversation` 冲突。
- 主题 token：`--dsw-alias-bg-base|bg-layer-1|bg-layer-2|bg-overlay|border-l1|l2|brand-primary|label-primary|label-secondary|state-{success,warn,error,idle}-primary`；每个 token 明暗两套，组件只引用变量。
- locale：`ctx.locale.register(NS, { zh:{…}, en:{…} })`、`ctx.locale.bind(NS)`；字体/数字用 `Intl`。
- `styles.insert(css)`（builtin）也可用；dsh-memory 用组件内 `<style>`，本项沿用。

## 2. 与 v0.1 技术方案的偏差

| 编号 | 方案原文 | 实际 | 处理 |
|---|---|---|---|
| D-1 | `pressureStats` 用 `ctx.sessionProjections.register`（纯 JSON schema） | 该 API 要求 **Zod** `stateSchema`，且 Host-only 单元需要额外依赖 | 改为自建 `session/event` fold（`src/stats.js`），内存态、有界；token/统计仍读官方投影。不新增依赖，符合零依赖原则。代价：插件重载后本轮计数从 0 起，回执标 `partial:true`（与 FR-G-05/D-08 一致）。 |
| D-2 | 面板与命令都走 locale | Host 侧没有可供插件读取的“当前 UI locale”服务；官方命令本身也是英文 | 面板完整 zh/en；Host 生成的命令/提醒文案由配置 `locale`（`auto|zh|en`，默认 `auto`）选择，`auto` 取 `$DSH_LOCALE`/系统 locale。README 写明差异。 |
| D-3 | `inject = ['tools','sessionProjections','tokenMeter']`，三件套缺失即不激活 | `tokenMeter` 缺失时需求 AC-G-02 要求“不崩溃、字段不可用” | `inject = ['tools']`；`sessionProjections`/`tokenMeter`/`sessionStats`/`commands`/`webServer` 全部可选，缺失降级并在面板显示“不可用”。 |
| D-4 | 回执目录 `$DSH_HOME/squeeze` | 与 dsh-swarm 的 `$DSH_HOME/...` 约定一致 | 保留；支持 `storage.dataDir` 覆盖；Windows 权限 best-effort 并在 About 标注。 |
| D-5 | `createUserMessage` 来自宿主 peer `@deepseek-ai/dsh-llm` | 第三方插件从 profile 侧无法解析 app.asar 内的 `@deepseek-ai/*` 包 | 不 import 宿主包，直接构造结构等价的 `UserMessage`（`role/id/content/source`，freeze）；`source.kind='dsh-pressure'`、`form:'notice'`、`summary` 与官方 reminder 一致。 |
| D-6 | guard 在 `agent.ctx` 注册 | `agent.ctx.tools.guard` 的运行期绑定未单独验证；全局 `ctx.tools.guard` 已由 Service 签名确认 | 在插件 ctx 注册**全局 guard**，按 `exec.agent.id` 过滤绑定；仍是同步、单调、随插件 fiber 清理。多 agent 场景下语义等价。 |
| D-7 | locale 文件包含全部 UI 文案 | Client 字典在 `client.js` 的模块工厂内注册（与 dsh-cloud-memory 相同的已验证形态）；`locale/*.json` 供 Plugin Manager 读 `meta` | `client.js` 内字典为 UI 唯一来源，`locale/*.json` 只放 `meta.title/description/detail`；测试断言 en/zh 键集一致。 |

## 3. 集成验证结果（临时 profile）

环境：`DSH_HOME=%WORKSPACE%\.tmp\dsh-home`，profile `pressure-test`（`@deepseek-ai/dsh-base` + `@deepseek-ai/dsh-web-app` + `dsh-pressure`），不触碰用户 `desktop` profile。

| 检查 | 结果 |
|---|---|
| `dsh --profile pressure-test --dump-config` | bundle 行 `dsh-pressure` 与其 config 正确插入 |
| 启动 `dsh --profile pressure-test --port 0 --no-open` | 启动成功；无 “entry did not activate” 警告 |
| `GET /api/dsh-pressure/health`（同源 + token cookie） | `200`，`dataDir` 指向临时 `$DSH_HOME/squeeze`，`tokenMeter/sessionProjections` 均为 `true` |
| `GET /api/dsh-pressure/sessions` | `200 {"sessions":[]}` |
| 首页 HTML 的 Client 模块表 | 含 `{"id":"dsh-pressure","url":"plugins/??dsh-pressure/client.js&rev=…","immediately":true}` |
| 拉取 Client bundle | `200`，35 KB，含 `__ModuleLoader__` 与包 id |
| 卸载插件后重启 | `/api/dsh-pressure/health` 返回 `404`，无残留路由/日志 |
| 真实浏览器渲染面板 | **已验证**：headless Edge + CDP，中文浅色/深色与英文浅色；侧边栏入口、KPI、信号、轮次表、About、回执抽屉、Esc 关闭均正常 |
| 离线真实 DSH 回合（`npm run e2e`） | **已验证**：脚本化 provider 触发 3 次失败工具调用；coach 追加 1 条 notice 并写回执；enforce 第 3 次调用被 `budget_exhausted` 拒绝，回执 `denied=1` |

## 4. 未验证 / 留到后续

- 真实模型质量/收益：脚本化 provider 已跑通真实 DSH 管线（见 §3），但真实模型的回执数值与 M4 基准尚未执行。
- `/squeeze` 命令在真实命令面板中的渲染：注册形态与官方 `/compact` 一致，命令解析与行为有单测；未在真实 GUI 手工执行。
- `agent.ctx.tools.guard` 的 agent 级绑定（已改用全局 guard，见 D-6）。
- 键盘：Tab 可达会话选择、刷新、导出链接与轮次行，Esc 关闭抽屉；抽屉未做焦点陷阱，未做屏幕阅读器测试。窄屏 520px 无横向页面溢出，表格在自身容器内滚动。
- Windows 文件权限：只做 best-effort，不宣称 0600 已生效。
- `turn/end` 重复投递：`ReceiptStore` 幂等由测试覆盖，不依赖宿主行为。

## 5. 官方包版本锚点

| 包 | 版本 | 用到的符号 |
|---|---|---|
| `@deepseek-ai/dsh` | 0.2.2-rc.3 | `engines.dsh` 上界 |
| `@deepseek-ai/dsh-session` | 0.2.2-rc.3 | `SessionEventMap`、`session/event` |
| `@deepseek-ai/dsh-session-projection` | 0.2.2-rc.3 | `snapshot()` |
| `@deepseek-ai/dsh-token-meter` | 0.2.2-rc.3 | `tokenUsage`、`contextPressure` |
| `@deepseek-ai/dsh-session-stats` | 0.2.2-rc.3 | `sessionStats` |
| `@deepseek-ai/dsh-tools` | 0.2.2-rc.3 | `guard`、`tools/post-execute` |
| `@deepseek-ai/dsh-commands` | 0.2.2-rc.3 | `register` |
| `@deepseek-ai/dsh-llm` | 0.2.2-rc.3 | `createUserMessage` |
| `@deepseek-ai/dsh-compaction` | 0.2.2-rc.3 | `compaction/*` 事件 |
