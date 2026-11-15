# 参与开发

## 环境

- Node.js 22+（测试只用 Node 内置模块，无第三方依赖）
- DSH desktop（宿主/客户端接口按 DSH 0.2.2-rc.3 实现，其他版本可能不兼容）

## 跑测试

```
node --test test/store.test.mjs test/schema.test.mjs test/service.test.mjs test/settings.test.mjs
```

宿主侧联调需要 DSH 的桩环境（`ctx.tools` / `ctx.systemPrompt` / `sessionController` 等），不在本仓库内；没有桩时至少保证单测全过、`node --check lib/*.js` 通过。

## 改完怎么验证

1. 单测全过。
2. `remove` + `add` 把改动装进 profile（`file:` 是拷贝快照，只 `add` 不会更新）。
3. **重启 DSH**（宿主插件与客户端 bundle 都在启动时装配），然后实际发一封邮件走完「投递 → 唤醒 → 已读 → 回信」。
4. 对比 `~/.dsh/profiles/<profile>/node_modules/dsh-agent-mail/lib/client.js` 的 md5，确认跑的是新代码。

## 提交约定

- 一个提交做一件事；消息用 `feat: / fix: / docs: / chore:` 前缀。
- 改行为要同时改测试；改设置项要同时改 README 的默认值表与 `lib/settings.js` 的 `EDITABLE`。
- 不要提交 `~/.dsh` 下的邮箱数据、设置文件或任何密钥。
