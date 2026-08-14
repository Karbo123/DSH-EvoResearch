# @evoscientist/dsh-plugin

EvoScientist 的 deepseek-harness 插件（Host + Client 双面）。

- **Host**（`./host`）：科研项目工作区、EvoMemory v2/v3、定时任务、通道、AutoSkills、
  专家团队、斜杠命令、Typert Remote API（`evosci.*`）；
- **Client**（`./client`）：WebUI 侧栏「科研」入口、科研面板（项目/记忆/定时任务/通道/技能提案）、
  会话记忆提示条。

## 挂载（作为 profile bundle）

```jsonc
// <DSH profile>/package.json
{
  "dependencies": { "@evoscientist/dsh-plugin": "file:path/to/packages/evoscientist-plugin" },
  "dsh": { "profile": { "bundles": [
    "@deepseek-ai/dsh-base",
    "@deepseek-ai/dsh-web-app",
    "@evoscientist/dsh-plugin"
  ] } }
}
```

`cordis.patch.yml` 自动插入 `evosci-host` 与 `evosci-client` 两行。

## 配置（settings.yaml）

```yaml
evosci:
  dataRoot: D:\evoscientist
  memoryTokenBudget: 6000
  auxiliaryModel: { provider: deepseek-official, model: deepseek-v4-flash }
  autoStartChannels: false
```

## 构建与测试

```bash
npm run build       # tsup → lib/（host + client ESM + d.ts）
npm run typecheck   # tsc 严格检查（双 tsconfig）
npm test            # node:test（43 个用例）
```
