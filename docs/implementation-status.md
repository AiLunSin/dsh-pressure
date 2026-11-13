# 实现状态（v0.1.0）

> 配套文档：[需求单](./requirements.zh-CN.md) · [技术方案](./technical-design.zh-CN.md) · [兼容性勘察](./compat-notes.md)

**一句话**：Host 半已实现并通过 66 项自动化测试与临时 profile 冒烟；Client 面板已在真实浏览器（headless Edge + CDP）完成面板、抽屉与 Esc 的渲染验收，覆盖中文浅色/深色、英文浅色与 520px 窄屏；离线脚本化 provider 跑通了真实 DSH 回合；并用真实账号跑了 108 次、约 ¥0.59 的预算冒烟（105/108 通过）。结论是**没有证据支持 coach 收益，enforce 会伤害工具密集任务**，默认保持 observe。

## 里程碑

| 阶段 | 状态 | 证据 |
|---|---|---|
| **M0 API 勘察** | ✅ 完成 | [compat-notes](./compat-notes.md) §1：事件、投影、guard、post-execute、命令、Web 路由、Client slot 均有运行时/源码依据 |
| **M1 观察闭环** | ✅ 完成 | 事件 fold、回执生成、JSONL 存储、只读 API、幂等/保留/导出测试；临时 profile 中 `/health`、`/sessions` 返回 200；离线 e2e 真实回合写出回执 |
| **M2 诊断与阀门** | ✅ 完成 | 6 类信号 + `budget_exhausted`、coach 限频/静音、enforce 守卫、预算状态机、`/squeeze` 全命令族、审计日志；离线 e2e 验证 coach 提醒与 enforce 拒绝 |
| **M3 面板与发布** | ✅ 面板完成 | 面板、双语文案、图标、DETAIL、CI 脚本已就绪；真实浏览器验收通过；**未发布 npm** |
| **M4 基准与稳定** | ⚠️ 预算冒烟完成 | 108 次真实模型运行、105 通过、约 ¥0.59（[结果](./smoke-2026-11-13.md)）；D 组因单轮 token 预算无法轮内生效而改用 6 次工具上限，属于偏差；预注册的完整结论仍未完成 |

## 验证证据

```
npm test            66 pass / 0 fail
npm run lint        check-syntax ok（13 个 Host 模块 + 5 个 bench 模块 + client bundle + locale + fixtures）
npm run demo        2 张回执 → Markdown/JSON/CSV，flags: context_pressure, failure_streak, bloated_result, repeat_calls
npm run bench       fold p95 0.003 ms（目标 ≤2 ms）；写入 p95 ≈1.0 ms（目标 ≤10 ms）
npm run bench:plan  9 任务 × 4 组 × 3 次；9 个任务原始状态均验收失败（防自带答案）
npm run e2e         离线真实 DSH 回合：coach 回执 + 1 条提醒；enforce 第 3 次调用被拒、回执 denied=1
npm run bench smoke 108 次真实运行：105/108 通过，4,283,828 tokens，约 ¥0.59（见 smoke-2026-11-13.md）
```

临时 profile 集成（不触碰用户 `desktop` profile）：

- `dsh --profile pressure-test --dump-config` 正确插入 bundle 行。
- 启动后 `/api/dsh-pressure/health` → 200；`/sessions` → 200；插件无激活警告。
- 首页模块表包含 `dsh-pressure/client.js`，bundle 200 且含 `__ModuleLoader__`。
- 卸载插件后重启，路由为 404，无残留。

真实浏览器（headless Edge + CDP，临时 profile，合成回执）：

| 检查 | 结果 |
|---|---|
| 侧边栏入口 | 中文“压力表”、英文“Pressure”均出现并可点击 |
| 主面板 | KPI（5,940 tok / 32.9% 缓存 / 86% 上下文 / 3-of-5 失败 / 70 ms / coach）、信号列表、轮次表、About 全部渲染 |
| 主题 | 中文浅色、中文深色两套 token 均正常 |
| 语言 | 中文、英文完整切换；无硬编码残留 |
| 回执抽屉 | 点击轮次行打开；Esc 关闭；导出/复制按钮可见 |
| 默认选中 | 优先有回执的会话；新开空会话不再把 KPI 覆盖成 0 |
| 窄屏 | 520px 无横向页面溢出；表格在卡片内滚动 |
| 键盘 | Tab 可达会话选择、刷新、导出链接与轮次行；抽屉无焦点陷阱 |

截图（不随仓库提交，避免个人路径）：`.tmp/panel5.png`、`.tmp/drawer3.png`、`.tmp/panel-dark.png`、`.tmp/panel-en.png`、`.tmp/panel-narrow.png`。

离线真实回合（`npm run e2e`，脚本化 provider，不消耗额度）：

| 检查 | 结果 |
|---|---|
| coach 回合 | 3 次工具调用 / 3 次失败；1 条 `source.kind=dsh-pressure` 的 notice；回执 `mode=coach`、`failure_streak:3`、`advice.inspectLastError` |
| enforce 回合 | 第 3 次工具调用被 guard 拒绝（`code=budget_exhausted`, `name=pressure`）；回执 `denied=1`、`budget_exhausted`、`advice.toolsStopped` |
| 隐私 | 回执 JSON 不含工具参数 `missing-`；日志只读元数据 |

## 偏差与已知限制

见 [compat-notes](./compat-notes.md) §2（D-1…D-7）与 §4。要点：

1. 用自建事件 fold 替代 `pressureStats` 投影（官方 API 要 Zod，零依赖原则优先）；插件重载后的那一轮标 `partial`。
2. `enforce` 是工具刹车：token 在响应后才可知，最终回答仍计费，回执显示超支量。
3. 面板是 root 作用域，默认展示最近活动会话，可用下拉框切换；无法自动绑定“当前会话”。
4. Host 文案跟随 `config.locale`（官方命令本身也是英文单语），面板文案跟随 Client locale。
5. Windows 权限只做 best-effort，不宣称 0600。
6. 键盘验收：Tab 可达会话选择、刷新、导出链接与轮次行，Esc 关闭抽屉；抽屉没有焦点陷阱（Tab 可移出对话框）。窄屏 520px 无横向页面溢出，表格在容器内滚动。

## 下一步（建议顺序）

1. 真实模型下验证 coach：构造会触发 `failure_streak` / `context_pressure` 的任务或多轮会话；本次冒烟中 coach 一次都没有触发。
2. 重新设计 D：单轮任务下 token 预算无法轮内生效；需要多轮任务，或把“工具刹车”与“token 预算”拆成两个独立实验。
3. 窄屏（≤560px）与 Tab 键盘全流程逐项验收（目前覆盖 520px 与主要控件）。
4. 发布前：npm/GitHub 名称检索已完成（`dsh-pressure` 可用）、`npm pack` 清单、CI（当前 + 前一 minor）。
