## 改了什么

<!-- 一段话说清行为变化，不是文件清单 -->

## 验证

- [ ] 单测全过（`node --test test/store.test.mjs test/schema.test.mjs test/service.test.mjs test/settings.test.mjs`）
- [ ] `node --check lib/*.js`
- [ ] 已 remove + add 并重启 DSH，实际走通「投递 → 唤醒 → 已读 → 回信」
- [ ] 改设置项时同步了 README 默认值表与 `lib/settings.js`

## 备注

<!-- 兼容性影响、已知边界 -->
