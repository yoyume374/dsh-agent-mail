# Changelog

## 0.3.8

- 邮件页签、工具返回与唤醒提示里的对象名改用**会话标题**（侧边栏可改名的那个）；取不到才退化为工作区目录名、会话 id。
- 离线会话的标题经宿主 `sessionQuery.readTitleSnapshots` 从会话日志读取，缓存 60 秒。
- `agent_mail_send` 的 `to` 继续接受会话 id、标题或 agent 名。

## 0.3.7

- 审计清理：删死代码与重复扫描，store 改为 append-mostly 并修复裁剪后索引不一致。
- `agent_mail_list` 不再返回正文；`ack` / `peers` 增加身份校验；`replyTo` 校验参与方。
- 设置项 `wakeOffline` 纳入设置页摘要；补齐 `dsh-llm` peer。

## 0.3.6

- 离线会话也能被唤醒：经 `sessionController.resolveAgent` 加载后 `followup`，返回 `resumed: true`。
- `wakeOffline` 可关闭，关掉后只投递、等对方打开。

## 0.3.5

- 取消每小时唤醒上限；防互刷只由回复深度与每分钟限流负责。

## 0.3.4

- 唤醒通知改用 `agent-message` 来源，聊天里是一行默认折叠的「收到任务消息」。
- 纯邮件轮的可见回复收敛为一行摘要（提示词约束）；被邮件阻塞的轮次照常展开。

## 0.3.3

- `read` / `wait` 的正文包来源信封，压缩历史后仍能追溯发件会话与邮件 id。
- 插件行配置入口（`plugins.row.config`）与页签设置改的是同一份设置。

## 0.3.2

- 设置页可改唤醒开关与限流等参数，改完立即生效、无需重启。

## 0.3.1

- 插件页行标题可直接点开配置页（`dsh-agent-mail#agent-mail`）。

## 0.3.0

- 线程视图：来信、回复、再回复归入同一张卡，标出方向与已读状态。

## 0.2.x

- 客户端「邮件」页签（`conversation.view`）、`/api` 的 `agentMail` 命名空间、RPC 与设置覆盖层。

## 0.1.x

- 首个可用版本：邮箱存储、6 个工具、系统提示词未读摘要、发信唤醒。
