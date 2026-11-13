# 发布清单（由维护者手动执行）

> 名称检索（2026-11-13）：`dsh-pressure` 在 npm 返回 404（可用）；`dsh-loop-pressure` 也可用；`dsh-throttle` 已被占用。
> 发布需要 npm 账号与 2FA；本仓库不保存任何 token。

## 1. 发布前检查

```powershell
cd <你的 dsh-pressure 仓库目录>
npm run check          # lint + 65 tests
npm run e2e            # 需要已安装 DSH；离线真实回合
npm pack --dry-run     # 确认文件清单：src/client/docs/scripts/bench，无 test/e2e/.tmp
npm view dsh-pressure version   # 应仍为 404
```

确认：

- `package.json` 的 `version`（当前 `0.1.0`）、`engines.dsh`（`>=0.2.2-rc.3 <0.3.0`）、`files` 正确。
- `client.js` 的 `id` 与包名一致，`dsh.client.platform = web`。
- `locale/*.json` 的 `meta.title/description/detail` 完整，图标为原创。
- README 含安装、配置、默认阈值、数据目录、隐私、卸载、已知限制。

## 2. 发布到 npm

```powershell
npm login                 # 浏览器/OTP
npm whoami                # 确认账号
npm publish --access public
```

发布后：

```powershell
npm view dsh-pressure version
npm pack dsh-pressure@0.1.0   # 可选：从 registry 拉回核对
```

## 3. 打 tag 与 GitHub Release

仓库目前没有 remote；先创建远端再执行：

```powershell
git tag -a v0.1.0 -m "dsh-pressure 0.1.0"
git push origin master --tags
```

GitHub Release 附件建议：`dsh-pressure-0.1.0.tgz`、`SHA256SUMS`、`CHANGELOG.md`。
生成校验和：

```powershell
Get-FileHash dsh-pressure-0.1.0.tgz -Algorithm SHA256 | Format-List
```

## 4. 发布后冒烟

```powershell
dsh plugin add dsh-pressure
dsh plugin add dsh-pressure@0.1.0   # 固定版本
```

在一个新会话中确认：侧边栏 **Pressure**、`/squeeze status`、跑一轮后出现回执、导出 Markdown、禁用后守卫立即失效。

## 5. 回滚

```powershell
npm unpublish dsh-pressure@0.1.0 --force   # 仅在发布小时内且无依赖时
# 更推荐：npm deprecate dsh-pressure@0.1.0 "reason"
dsh plugin remove dsh-pressure
```
