# 实现状态（v0.1.0）

> 配套文档：[需求单](./requirements.zh-CN.md) · [技术方案](./technical-design.zh-CN.md) · [兼容性勘察](./compat-notes.md)

**一句话**：Host 半已实现并通过 48 项自动化测试与临时 profile 冒烟；Client 面板已实现并被宿主正确注入，但**真实浏览器渲染尚未人工验收**。

## 里程碑

| 阶段 | 状态 | 证据 |
|---|---|---|
| **M0 API 勘察** | ✅ 完成 | [compat-notes](./compat-notes.md) §1：事件、投影、guard、post-execute、命令、Web 路由、Client slot 均有运行时/源码依据 |
| **M1 观察闭环** | ✅ 基本完成 | 事件 fold、回执生成、JSONL 存储、只读 API、幂等/保留/导出测试；临时 profile 中 `/health`、`/sessions` 返回 200 |
| **M2 诊断与阀门** | ✅ 逻辑完成 | 6 类信号 + `budget_exhausted`、coach 限频/静音、enforce 守卫、预算状态机、`/squeeze` 全命令族、审计日志；单测覆盖 |
| **M3 面板与发布** | ⚠️ 部分 | 面板、双语文案、图标、DETAIL、CI 脚本已就绪并被打包注入；未做真实浏览器验收，未发布 npm |
| **M4 基准与稳定** | ❌ 未开始 | 现有 `npm run bench` 只是 fold/写入微基准，不是 9 任务模型对照 |

## 验证证据

```
npm test            48 pass / 0 fail
npm run lint        check-syntax ok（13 个 Host 模块 + client bundle + locale）
npm run demo        2 张回执 → Markdown/JSON/CSV，flags: context_pressure, failure_streak, bloated_result, repeat_calls
npm run bench       fold p95 0.003 ms（目标 ≤2 ms）；写入 p95 ≈1.0 ms（目标 ≤10 ms）
```

临时 profile 集成（不触碰用户 `desktop` profile）：

- `dsh --profile pressure-test --dump-config` 正确插入 bundle 行。
- 启动后 `/api/dsh-pressure/health` → 200；`/sessions` → 200；插件无激活警告。
- 首页模块表包含 `dsh-pressure/client.js`，bundle 200 且含 `__ModuleLoader__`。
- 卸载插件后重启，路由为 404，无残留。

## 偏差与已知限制

见 [compat-notes](./compat-notes.md) §2（D-1…D-7）与 §4。要点：

1. 用自建事件 fold 替代 `pressureStats` 投影（官方 API 要 Zod，零依赖原则优先）；插件重载后的那一轮标 `partial`。
2. `enforce` 是工具刹车：token 在响应后才可知，最终回答仍计费，回执显示超支量。
3. 面板是 root 作用域，默认展示最近活动会话，可用下拉框切换；无法自动绑定“当前会话”。
4. Host 文案跟随 `config.locale`（官方命令本身也是英文单语），面板文案跟随 Client locale。
5. Windows 权限只做 best-effort，不宣称 0600。

## 下一步（建议顺序）

1. 真实模型会话下手工验收：安装 → 跑一轮含工具失败的任务 → 回执 → `/squeeze status` → 导出。
2. 真实浏览器验收面板：深浅色、中英文、窄屏、键盘。
3. M4：按技术方案 §13 预注册 9 任务、四组对照，报告原始数据。
4. 发布前：npm/GitHub 名称检索、`npm pack` 清单、CI（当前 + 前一 minor）。
