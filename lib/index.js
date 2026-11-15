/**
 * dsh-agent-mail: agent-to-agent mail between DSH sessions.
 *
 * Delivery is prompt-level: each agent gets a per-turn system-prompt section
 * listing its unread mail, so nothing is appended to the visible chat history.
 * The client page (conversation.view tab) lives in lib/client.js.
 *
 * @module dsh-agent-mail
 */
import z from "@deepseek-ai/schemastery";
import { defineTool } from "@deepseek-ai/dsh-tools";
import { homedir } from "node:os";
import { join } from "node:path";
import { createUserMessage } from "@deepseek-ai/dsh-llm";
import { createLimiter, depthVerdict } from "./limits.js";
import { ACK_SCHEMA, IDS_PARAM, MAIL_SCHEMA, PEER_SCHEMA, SEND_SCHEMA, WAIT_SCHEMA } from "./schemas.js";
import { Remote, TypertRemoteService } from "@deepseek-ai/dsh-typert-protocol";
import { createMailApi } from "./service.js";
import { applyOverrides, describeSettings, mergePatch, readOverrides, writeOverrides } from "./settings.js";
import { Mailbox, defaultDataDir, newMail } from "./store.js";

const name = "dsh-agent-mail";
const inject = ["tools", "agents", "systemPrompt"];

/**
 * Shared handle the Service methods read. Rebuilt by apply() on every refresh
 * so the browser page always talks to the current mailbox and peer list.
 */
const runtime = { api: undefined };

function currentApi() {
  if (!runtime.api) throw new Error("agent mail is not ready yet; retry in a moment");
  return runtime.api;
}

/**
 * Host half of the browser page: the "/api" namespace "agentMail".
 * Every method takes one "request" object, matching the single named wire
 * argument the page sends.
 */
class AgentMailService extends TypertRemoteService {
  constructor(ctx) {
    super(ctx, "agentMail");
    for (const initializer of REMOTE_INITIALIZERS) initializer.call(this);
  }

  list(request) {
    return currentApi().list(request);
  }

  threads(request) {
    return currentApi().threads(request);
  }

  peek(request) {
    return currentApi().peek(request);
  }

  peers(request) {
    return currentApi().peers(request);
  }

  settings(request) {
    return currentApi().settings(request);
  }

  updateSettings(request) {
    return currentApi().updateSettings(request);
  }
}

const REMOTE_METHODS = ["list", "threads", "peek", "peers", "settings", "updateSettings"];

/**
 * Plain JavaScript cannot use decorator syntax, so apply @Remote by hand: the
 * decorator only records an initializer that marks the method on the prototype.
 */
function markRemoteMethods(type, methods) {
  const initializers = [];
  for (const method of methods) {
    const context = {
      kind: "method",
      name: method,
      static: false,
      private: false,
      addInitializer(initializer) {
        initializers.push(initializer);
      },
    };
    Remote(method)(type.prototype[method], context);
  }
  return initializers;
}

const REMOTE_INITIALIZERS = markRemoteMethods(AgentMailService, REMOTE_METHODS);

const schema = z.object({
  dataDir: z
    .string()
    .default("")
    .description("Mailbox directory; empty means <DSH home>/agent-mail"),
  ratePerMinute: z
    .number()
    .default(6)
    .description("Max messages one session may send to the same target session per minute"),
  ratePerSessionMinute: z
    .number()
    .default(20)
    .description("Max messages any senders may deliver to one session per minute"),
  maxDepth: z
    .number()
    .default(5)
    .description("Deepest automatic reply chain; a deeper reply must be approved by the user"),
  maxMailbox: z
    .number()
    .default(500)
    .description("Kept messages per receiving session; oldest read mail is dropped first"),
  promptPreview: z
    .number()
    .default(5)
    .description("Unread messages named in the per-turn system-prompt summary"),
  bodyLimit: z
    .number()
    .default(8000)
    .description("Maximum characters of one message body"),
  wakeOnSend: z
    .boolean()
    .default(true)
    .description("默认唤醒收件方会话；关掉后只投递不唤醒，调用时仍可用 wake:true 单独开启"),
  wakeOffline: z
    .boolean()
    .default(true)
    .description("收件方会话没打开（没有活动 agent）时，先让宿主加载该会话再唤醒；关掉后离线会话只投递"),
});

const Config = "volatile" in schema && typeof schema.volatile === "function" ? schema.volatile() : schema;

/** Coerce a numeric option into 1..max; a non-finite value falls back. */
function clampLimit(value, fallback, max) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 1) return fallback;
  return Math.min(Math.floor(number), max);
}

function textOf(value) {
  return [{ type: "text", text: value }];
}

function sessionIdOf(agent) {
  const session = agent && agent.session;
  if (!session) return "";
  if (session.id === undefined || session.id === null) return "";
  return String(session.id);
}

function nameOf(agent) {
  if (!agent) return "";
  const candidate = agent.name || (agent.session && agent.session.name);
  return typeof candidate === "string" ? candidate : "";
}

/** Latest user-visible Session title: the log's last `session/title` event. */
function titleOfEvents(events) {
  if (!Array.isArray(events)) return "";
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index];
    const data = event && event.type === "session/title" ? event.data : undefined;
    if (data && typeof data.title === "string" && data.title.trim() !== "") return data.title.trim();
  }
  return "";
}

/**
 * The name a session shows in the GUI: its user-owned (or generated) title.
 * Falls back to the log fold when the title service is not mounted.
 */
function sessionTitleOf(session, service) {
  if (!session) return "";
  try {
    const snapshot = service && typeof service.get === "function" ? service.get(session) : undefined;
    if (snapshot && typeof snapshot.title === "string" && snapshot.title.trim() !== "") return snapshot.title.trim();
  } catch {}
  try {
    return titleOfEvents(typeof session.snapshotEvents === "function" ? session.snapshotEvents() : undefined);
  } catch {
    return "";
  }
}

function cwdOf(agent) {
  const header = agent && agent.session && agent.session.header;
  return header && typeof header.cwd === "string" ? header.cwd : "";
}

/**
 * 最近一次活动时间：取会话 surface 最后一个节点的事件时间，退化为 header.createdAt。
 * 只对在线会话有意义；取不到时返回空串（不猜）。
 */
function lastActivityOf(agent) {
  try {
    const session = agent && agent.session;
    if (!session) return "";
    const nodes = session.surface && session.surface.nodes;
    const last = nodes && nodes.length > 0 ? nodes[nodes.length - 1] : undefined;
    const event = last !== undefined && typeof session.eventAt === "function" ? session.eventAt(last) : undefined;
    const header = session.header;
    const raw =
      event && typeof event.time === "number"
        ? event.time
        : header && typeof header.createdAt === "number"
          ? header.createdAt
          : undefined;
    if (typeof raw !== "number" || !Number.isFinite(raw)) return "";
    return new Date(raw).toISOString();
  } catch {
    return "";
  }
}

async function apply(ctx, source) {
  const live = "get" in source;
  let dispose = undefined;
  let generation = 0;

  const refresh = async () => {
    const request = ++generation;
    if (dispose) dispose();
    dispose = undefined;

    const baseConfig = live ? source.get() : source;
    const dshHome = process.env.DSH_HOME || join(homedir(), ".dsh");
    const customDir = typeof baseConfig.dataDir === "string" ? baseConfig.dataDir.trim() : "";
    const dir = customDir !== "" ? customDir : defaultDataDir(dshHome);
    // Page overrides win over the profile config and apply without a restart.
    let overrides = readOverrides(dir);
    let settings = applyOverrides(baseConfig, overrides);
    const box = new Mailbox({ file: join(dir, "mailbox.jsonl"), maxPerSession: settings.maxMailbox });
    let limiter = createLimiter({
      perPairPerMinute: settings.ratePerMinute,
      perSessionPerMinute: settings.ratePerSessionMinute,
    });
    if (request !== generation) return;

    const sessionTitles = () => {
      try {
        return typeof ctx.get === "function" ? ctx.get("sessionTitle") : undefined;
      } catch {
        return undefined;
      }
    };
    // Titles are log-backed; cache them briefly so a tab refresh does not re-read every session.
    const titleCache = new Map();
    const TITLE_TTL_MS = 60 * 1000;
    const cachedTitle = (sessionId) => {
      const entry = titleCache.get(sessionId);
      return entry !== undefined && Date.now() - entry.at < TITLE_TTL_MS ? entry.title : "";
    };
    const needsTitle = (sessionId) => {
      const entry = titleCache.get(sessionId);
      return entry === undefined || Date.now() - entry.at >= TITLE_TTL_MS;
    };
    const displayName = (agent) => sessionTitleOf(agent && agent.session, sessionTitles()) || nameOf(agent);
    const readTitles = async (sessionIds) => {
      if (sessionIds.length === 0) return;
      let query;
      try {
        query = typeof ctx.get === "function" ? ctx.get("sessionQuery") : undefined;
      } catch {}
      if (!query || typeof query.readTitleSnapshots !== "function") return;
      try {
        const results = await query.readTitleSnapshots(sessionIds);
        sessionIds.forEach((sessionId, index) => {
          const result = results[index];
          const value = result && result.status === "fulfilled" ? result.value : undefined;
          const snapshot = value && value.title;
          const title = snapshot && typeof snapshot.title === "string" ? snapshot.title.trim() : "";
          titleCache.set(sessionId, { title, at: Date.now() });
        });
      } catch (error) {
        ctx.logger.warn("agent-mail: session titles unavailable: " + (error && error.message ? error.message : String(error)));
      }
    };

    const peers = () => {
      const rows = [];
      const seen = new Set();
      for (const agent of ctx.agents.list()) {
        const sessionId = sessionIdOf(agent);
        if (sessionId === "") continue;
        seen.add(sessionId);
        rows.push({
          sessionId,
          name: displayName(agent),
          cwd: cwdOf(agent),
          live: true,
          lastActivityAt: lastActivityOf(agent),
          unread: box.unread(sessionId).length,
          sent: box.sent(sessionId).length,
        });
      }
      for (const sessionId of box.knownSessions()) {
        if (seen.has(sessionId)) continue;
        rows.push({
          sessionId,
          name: cachedTitle(sessionId),
          cwd: "",
          live: false,
          lastActivityAt: "",
          unread: box.unread(sessionId).length,
          sent: box.sent(sessionId).length,
        });
      }
      return rows;
    };

    /** Peers with log-backed titles for sessions this process has not seen yet. */
    const peersRich = async () => {
      const rows = peers();
      const missing = [];
      for (const row of rows) {
        if (row.name !== "" || !needsTitle(row.sessionId)) continue;
        missing.push(row.sessionId);
        if (missing.length >= 40) break;
      }
      if (missing.length > 0) await readTitles(missing);
      return peers();
    };

    /** Apply a page-submitted { key: value|null } patch and rebuild derived state. */
    const applySettingsPatch = (values) => {
      const patch = mergePatch(overrides, values);
      writeOverrides(dir, patch.overrides);
      overrides = patch.overrides;
      settings = applyOverrides(baseConfig, overrides);
      limiter = createLimiter({
        perPairPerMinute: settings.ratePerMinute,
        perSessionPerMinute: settings.ratePerSessionMinute,
      });
      box.maxPerSession = settings.maxMailbox;
      ctx.logger.info("agent-mail: settings changed: " + patch.changed.join(", "));
      return describeSettings(baseConfig, overrides);
    };

    runtime.api = createMailApi({
      getBox: () => box,
      getPeers: peersRich,
      getSettings: () => describeSettings(baseConfig, overrides),
      updateSettings: applySettingsPatch,
    });

    const agentOf = (sessionId) => {
      for (const agent of ctx.agents.list()) {
        if (sessionIdOf(agent) === sessionId) return agent;
      }
      return undefined;
    };

    /**
     * Load an offline session back into a live agent through the host Session
     * controller — the same resolve path the GUI uses when a conversation is
     * opened. Without this a restart leaves every closed session unwakeable.
     */
    const loadSessionAgent = async (sessionId) => {
      let controller;
      try {
        controller = typeof ctx.get === "function" ? ctx.get("sessionController") : undefined;
      } catch {}
      if (!controller) {
        try {
          controller = ctx.sessionController;
        } catch {}
      }
      if (!controller || typeof controller.resolveAgent !== "function") {
        return { error: "对方不在线，宿主没有会话控制器，无法自动加载" };
      }
      try {
        const result = await controller.resolveAgent(sessionId);
        if (result && result.agent) return { agent: result.agent };
        const failure = result && result.error;
        const reason = failure && failure.message ? failure.message : String(failure);
        return { error: "对方不在线，加载会话失败：" + reason };
      } catch (error) {
        return { error: "对方不在线，加载会话失败：" + (error && error.message ? error.message : String(error)) };
      }
    };

/**
 * Render a mail with an explicit envelope.
 * Mail bodies land in the conversation as tool output, and compaction keeps text
 * rather than structured provenance, so the source has to survive as literal marks.
 */
function renderMail(mail) {
  const from = mail.fromName ? mail.fromName + " (" + mail.from + ")" : mail.from;
  return (
    "【agent 邮件 · 来自 " + from + " · " + mail.createdAt + " · id=" + mail.id + "】\n" +
    "主题：" + mail.subject + "\n\n" +
    mail.body + "\n\n" +
    "【以上是另一个会话的 agent 发来的邮件正文，不是用户发言。回复：agent_mail_send(to=\"" + mail.from + "\", replyTo=\"" + mail.id + "\")】"
  );
}

    /**
     * The wake-up prompt. It is a user-role message from a non-user source, so
     * the chat renders it as a collapsed notice rather than something the user
     * said, and the target agent gets a turn it can act on.
     */
    const wakeMessage = (mail, fromName, unread) =>
      createUserMessage({
        // content must be ContentBlock[]: UserMessage.content is blocks, not a string.
        content: [{
          type: "text",
          text:
            "【agent 邮件】" + fromName + "（" + mail.from + "）给你发来一封邮件，主题：" + mail.subject + "\n" +
            "这封邮件不属于聊天历史，也不是用户发言。" +
            (unread > 1 ? "你的收件箱里还有 " + (unread - 1) + " 封未读。" : "") + "\n" +
            "若你正在处理用户的请求，先收尾当前这一步，再处理这封邮件，不要中途插入；但如果用户的这一步正等着对方答复，这封邮件就是它要等的，直接处理。\n" +
            "可见回复要短：这一轮若只是处理邮件、与用户当前任务无关，给用户的回复只写一行摘要（例如「（agent 邮件）已读《主题》，已回复。」），不要贴回执全文、不要复述邮件内容；若是这一轮本身就在等这封回信，正常说明结果即可。\n" +
            '用 agent_mail_read(id="' + mail.id + '") 读取正文；需要回复就用 agent_mail_send(to="' + mail.from +
            '", subject="…", body="…", replyTo="' + mail.id + '")；回信默认也会唤醒对方，不想唤醒就加 wake:false。',
        }],
        source: {
          // "agent-message" is a source kind the chat client already knows: it renders
          // this waking notice as "收到任务消息" with a paper-plane icon (default
          // collapsed, click to expand). Unknown kinds fall back to the generic
          // "收到执行请求".
          kind: "agent-message",
          form: "notice",
          mailId: mail.id,
          from: mail.from,
          subject: mail.subject,
        },
      });

    const resolveTarget = (rows, ref) => {
      const wanted = String(ref || "").trim();
      if (wanted === "") return undefined;
      const exact = rows.find((row) => row.sessionId === wanted);
      if (exact) return exact;
      const lowered = wanted.toLowerCase();
      // Title, or the agent's own name: callers that knew a peer before titles
      // existed must keep working.
      const agentNames = new Map();
      for (const agent of ctx.agents.list()) {
        const id = sessionIdOf(agent);
        const agentName = nameOf(agent);
        if (id !== "" && agentName !== "") agentNames.set(id, agentName.toLowerCase());
      }
      const byName = rows.filter(
        (row) => (row.name && row.name.toLowerCase() === lowered) || agentNames.get(row.sessionId) === lowered,
      );
      if (byName.length === 1) return byName[0];
      if (byName.length > 1) throw new Error("agent_mail: more than one session is named " + wanted + "; pass the session id instead");
      return undefined;
    };

    const unregister = [];

    unregister.push(
      ctx.tools.register(
        defineTool({
          name: "agent_mail_send",
          description:
            "给另一个 DSH 会话的 agent 发消息。邮件不进聊天历史：对方在下一轮系统提示词里看到未读提示，用 agent_mail_read 读取。默认会唤醒收件方（对方在线时立即开一轮），可用 wake=false 只投递不唤醒；回复已有邮件时传 replyTo 延续线程深度。发完如果不需要在本轮内拿到答复，直接结束本轮最快：对方回信会唤醒你开新一轮，不必轮询或干等；确实必须同轮等才调 agent_mail_wait。",
          parameters: {
            to: { type: "string", required: true, description: "目标会话 id、会话标题，或唯一的 agent 名" },
            subject: { type: "string", required: true, description: "一句话主题" },
            body: { type: "string", required: true, description: "正文" },
            replyTo: { type: "string", description: "被回复邮件的 id，用于计算线程深度" },
            wake: { type: "boolean", description: "是否唤醒收件方；不传则用插件配置 wakeOnSend（默认唤醒）" },
          },
          output: {
            schema: SEND_SCHEMA,
            render: (_args, value) =>
              textOf(
                "已发送 " + value.id + " 给 " + value.toName + "（" + value.to + "），线程深度 " + value.depth +
                  "，对方未读 " + value.unread + " 封" +
                  (value.woken ? "，已唤醒对方" : "，未唤醒" + (value.wakeSkipped ? "：" + value.wakeSkipped : "")),
              ),
          },
          execute: async (args, exec) => {
            const fromAgent = exec && exec.agent;
            const from = sessionIdOf(fromAgent);
            if (from === "") throw new Error("agent_mail_send: this call has no session identity; run it from a session-bound agent");
            const target = resolveTarget(await peersRich(), args.to);
            if (!target) throw new Error("agent_mail_send: unknown target " + args.to + "; call agent_mail_peers for valid ids");
            if (target.sessionId === from) throw new Error("agent_mail_send: a session cannot mail itself");

            const subject = String(args.subject || "").trim().slice(0, 200);
            const body = String(args.body || "").slice(0, settings.bodyLimit);
            if (subject === "") throw new Error("agent_mail_send: subject is required");
            if (body.trim() === "") throw new Error("agent_mail_send: body is required");

            let depth = 0;
            let replyTo = null;
            if (args.replyTo) {
              const parent = box.get(String(args.replyTo));
              if (!parent) throw new Error("agent_mail_send: unknown replyTo " + args.replyTo);
              // Only mail this session sent or received may be extended into a thread.
              if (parent.from !== from && parent.to !== from) {
                throw new Error("agent_mail_send: replyTo " + parent.id + " is not part of a thread this session is in");
              }
              replyTo = parent.id;
              depth = parent.depth + 1;
            }
            const verdict = depthVerdict({ depth, maxDepth: settings.maxDepth });
            if (!verdict.ok) throw new Error("agent_mail_send: " + verdict.reason);

            const rate = limiter.check(from, target.sessionId);
            if (!rate.ok) {
              throw new Error(
                "agent_mail_send: rate limited (" + rate.reason + "); retry in " + Math.ceil(rate.retryAfterMs / 1000) + "s",
              );
            }
            limiter.record(from, target.sessionId);

            const mail = box.append(
              newMail({
                from,
                fromName: displayName(fromAgent) || from,
                to: target.sessionId,
                subject,
                body,
                replyTo,
                depth,
              }),
            );
            try {
              ctx.emit("agent-mail/arrived", { mail, to: target.sessionId });
            } catch {}
            ctx.logger.info("agent mail %s -> %s (%s)", from, target.sessionId, mail.id);

            const wantWake = args.wake === undefined ? settings.wakeOnSend !== false : args.wake !== false;
            let woken = false;
            let resumed = false;
            let wakeSkipped = "";
            if (!wantWake) {
              wakeSkipped = "已关闭唤醒，只投递";
            } else {
              let targetAgent = agentOf(target.sessionId);
              if (targetAgent === undefined && settings.wakeOffline !== false) {
                const loaded = await loadSessionAgent(target.sessionId);
                if (loaded.agent) {
                  targetAgent = loaded.agent;
                  resumed = target.live !== true;
                } else if (loaded.error) {
                  wakeSkipped = loaded.error;
                }
              }
              if (targetAgent === undefined && wakeSkipped === "") {
                wakeSkipped = settings.wakeOffline === false && !target.live
                  ? "对方不在线，离线唤醒已关闭（下次被打开时可见）"
                  : "找不到对方的活动 agent，已投递未唤醒";
              }
              if (targetAgent !== undefined) {
                try {
                  // Agent itself owns send/followup; agent.inbox is only the pending-state reader.
                  const prompt = wakeMessage(mail, displayName(fromAgent) || from, box.unread(target.sessionId).length);
                  if (typeof targetAgent.followup === "function") targetAgent.followup(prompt);
                  else targetAgent.send(prompt, "next-turn", true);
                  woken = true;
                  wakeSkipped = "";
                } catch (error) {
                  wakeSkipped = "唤醒失败：" + (error && error.message ? error.message : String(error));
                }
              }
            }

            return {
              id: mail.id,
              to: target.sessionId,
              toName: target.name || target.sessionId,
              subject,
              depth,
              targetLive: target.live,
              unread: box.unread(target.sessionId).length,
              woken,
              ...(resumed ? { resumed: true } : {}),
              ...(wakeSkipped === "" ? {} : { wakeSkipped }),
            };
          },
        }),
      ),
    );

    unregister.push(
      ctx.tools.register(
        defineTool({
          name: "agent_mail_list",
          description:
            "列出本会话的 agent 邮件。邮件不属于聊天历史；正文用 agent_mail_read 读取。",
          parameters: {
            box: { type: "string", description: "inbox (default) or sent" },
            unreadOnly: { type: "boolean", description: "Only unread inbox mail" },
            limit: { type: "integer", description: "Maximum rows (default 20)" },
          },
          output: {
            schema: { type: "array", items: MAIL_SCHEMA },
            render: (_args, value) =>
              value.length === 0
                ? textOf("No mail.")
                : textOf(
                    value
                      .map((mail) => (mail.readAt === "" ? "[unread] " : "[read]   ") + mail.id + " from " + mail.fromName + " - " + mail.subject)
                      .join("\n"),
                  ),
          },
          execute: (args, exec) => {
            const self = sessionIdOf(exec && exec.agent);
            if (self === "") throw new Error("agent_mail_list: no session identity");
            const limit = clampLimit(args.limit ?? 20, 20, 200);
            const rows = String(args.box ?? "inbox") === "sent" ? box.sent(self) : box.inbox(self);
            const filtered = args.unreadOnly ? rows.filter((mail) => mail.readAt === null) : rows;
            return filtered
              .slice(-limit)
              .reverse()
              .map((mail) => ({
                id: mail.id,
                from: mail.from,
                fromName: mail.fromName,
                to: mail.to,
                subject: mail.subject,
                createdAt: mail.createdAt,
                readAt: mail.readAt ?? "",
                replyTo: mail.replyTo ?? "",
                depth: mail.depth,
              }));
          },
        }),
      ),
    );

    unregister.push(
      ctx.tools.register(
        defineTool({
          name: "agent_mail_read",
          description: "读取一封 agent 邮件的正文并标记已读。只能读发给本会话的邮件。",
          parameters: {
            id: { type: "string", required: true, description: "Mail id from agent_mail_list" },
          },
          output: {
            schema: MAIL_SCHEMA,
            render: (_args, value) => textOf(renderMail(value)),
          },
          execute: (args, exec) => {
            const self = sessionIdOf(exec && exec.agent);
            const mail = box.get(String(args.id));
            if (!mail) throw new Error("agent_mail_read: unknown mail " + args.id);
            if (mail.to !== self) throw new Error("agent_mail_read: mail " + args.id + " is not addressed to this session");
            box.markRead([mail.id]);
            return {
              id: mail.id,
              from: mail.from,
              fromName: mail.fromName,
              to: mail.to,
              subject: mail.subject,
              body: mail.body,
              createdAt: mail.createdAt,
              readAt: mail.readAt ?? "",
              replyTo: mail.replyTo ?? "",
              depth: mail.depth,
            };
          },
        }),
      ),
    );

    unregister.push(
      ctx.tools.register(
        defineTool({
          name: "agent_mail_ack",
          description: "把 agent 邮件标记为已读，不打印正文。",
          parameters: {
            ids: { ...IDS_PARAM, required: true, description: "Mail ids to mark read" },
          },
          output: {
            schema: ACK_SCHEMA,
            render: (_args, value) => textOf("marked " + value.marked + " mail read"),
          },
          execute: (args, exec) => {
            const self = sessionIdOf(exec && exec.agent);
            if (self === "") throw new Error("agent_mail_ack: no session identity");
            // Dedupe first: a repeated id must not inflate the count.
            const ids = [...new Set((args.ids ?? []).map(String))].filter((id) => {
              const mail = box.get(id);
              return mail !== undefined && mail.to === self && mail.readAt === null;
            });
            box.markRead(ids);
            return { marked: ids.length };
          },
        }),
      ),
    );

    unregister.push(
      ctx.tools.register(
        defineTool({
          name: "agent_mail_peers",
          description:
            "列出可以互发 agent 邮件的 DSH 会话：在线会话在前，仅有邮箱但未运行的会话在后。lastActivityAt 是该会话最近一次活动时间（ISO 8601 UTC），离线会话为空串；要按「谁最近活跃」挑目标时按它倒序即可。",
          parameters: {},
          output: {
            schema: { type: "array", items: PEER_SCHEMA },
            render: (_args, value) =>
              value.length === 0
                ? textOf("No peers.")
                : textOf(
                    value
                      .map(
                        (peer) =>
                          (peer.live ? "live " : "idle ") +
                          peer.sessionId +
                          (peer.name ? " (" + peer.name + ")" : "") +
                          " unread=" + peer.unread +
                          " sent=" + peer.sent +
                          (peer.cwd ? " cwd=" + peer.cwd : "") +
                          (peer.lastActivityAt ? " last=" + peer.lastActivityAt : ""),
                      )
                      .join("\n"),
                  ),
          },
          execute: async (_args, exec) => {
            const self = sessionIdOf(exec && exec.agent);
            if (self === "") throw new Error("agent_mail_peers: no session identity");
            return (await peersRich()).filter((peer) => peer.sessionId !== self);
          },
        }),
      ),
    );

    // A waiting call resolves the moment a matching mail lands, so an agent that
    // must stay in the same turn does not poll on a fixed sleep.
    const mailWaiters = new Set();
    // One matcher for both paths: the arrival event and the includeExisting scan.
    const waiterMatches = (waiter, mail) =>
      waiter.to === mail.to &&
      (waiter.from === "" || waiter.from === mail.from) &&
      (waiter.needle === "" || String(mail.subject).indexOf(waiter.needle) !== -1);
    const stopArrivals = ctx.on("agent-mail/arrived", (event) => {
      const mail = event && event.mail;
      if (!mail) return;
      for (const waiter of [...mailWaiters]) {
        if (!waiterMatches(waiter, mail)) continue;
        waiter.settle(mail);
      }
    });
    if (typeof stopArrivals === "function") unregister.push(stopArrivals);

    unregister.push(
      ctx.tools.register(
        defineTool({
          name: "agent_mail_wait",
          description:
            "等一封发给本会话的新邮件：对方一发信这次调用立刻返回（事件驱动，不是轮询），超时返回 timedOut:true。发信后要等回信就用它，最长 280 秒。返回正文但不改已读状态，要标记已读再调 agent_mail_read。如果你发信后本来就能结束本轮，直接结束更快：对方回信会唤醒你开新一轮。",
          parameters: {
            timeoutSeconds: { type: "number", description: "最长等待秒数，默认 60，取值 1..280" },
            from: { type: "string", description: "只接受这个会话 id 发来的邮件（可选）" },
            subjectContains: { type: "string", description: "只接受主题包含这段文字的邮件（可选）" },
            includeExisting: { type: "boolean", description: "默认 true：先看已存在的未读匹配邮件，命中就立刻返回" },
          },
          timeoutMs: 300000,
          output: {
            schema: WAIT_SCHEMA,
            render: (_args, value) =>
              value.timedOut
                ? textOf("等待超时：" + Math.round(value.waitedMs / 1000) + "s 内没有新邮件。")
                : textOf(renderMail(value)),
          },
          execute: (args, exec) => {
            const self = sessionIdOf(exec && exec.agent);
            if (self === "") throw new Error("agent_mail_wait: this call has no session identity");
            const seconds = Math.min(280, Math.max(1, Number(args.timeoutSeconds) || 60));
            const from = typeof args.from === "string" ? args.from.trim() : "";
            const needle = typeof args.subjectContains === "string" ? args.subjectContains.trim() : "";
            const matches = (mail) => waiterMatches({ to: self, from, needle }, mail);
            const shape = (mail) => ({
              timedOut: mail === null,
              waitedMs: 0,
              id: mail === null ? "" : mail.id,
              from: mail === null ? "" : mail.from,
              fromName: mail === null ? "" : mail.fromName ?? "",
              to: self,
              subject: mail === null ? "" : mail.subject,
              body: mail === null ? "" : mail.body,
              createdAt: mail === null ? "" : mail.createdAt,
              readAt: mail === null ? "" : mail.readAt ?? "",
              replyTo: mail === null ? "" : mail.replyTo ?? "",
              depth: mail === null ? 0 : mail.depth,
            });
            const started = Date.now();
            // The reply may have landed between send and this call; do not block on it.
            if (args.includeExisting !== false) {
              const already = box.unread(self).filter(matches);
              if (already.length > 0) return { ...shape(already[already.length - 1]), waitedMs: 0 };
            }
            return new Promise((resolve) => {
              const waiter = { to: self, from, needle, settle: null };
              let timer = null;
              const finish = (mail) => {
                mailWaiters.delete(waiter);
                if (timer !== null) clearTimeout(timer);
                resolve({ ...shape(mail), waitedMs: Date.now() - started });
              };
              waiter.settle = (mail) => finish(mail);
              timer = setTimeout(() => finish(null), seconds * 1000);
              mailWaiters.add(waiter);
            });
          },
        }),
      ),
    );

    const removeSection = ctx.systemPrompt.section({
      name: "agent-mail",
      order: 900,
      text: (context) => {
        const agent = context && context.agent;
        const self = sessionIdOf(agent);
        if (self === "") return "";
        const unread = box.unread(self);
        if (unread.length === 0) return "";
        const preview = unread.slice(0, Math.max(1, settings.promptPreview));
        const lines = [
          "你有 " + unread.length + " 封未读的 agent 间消息，它们不显示在聊天历史里。",
          "用 agent_mail_read(id) 读取；需要回复时用 agent_mail_send(to, subject, body, replyTo)。",
          "回信后若不必在本轮内拿到答复，发完就结束本轮：对方回信会唤醒你开新一轮，比在本轮里等待更快。",
          "处理顺序：默认用户的主任务优先，邮件排在当前这一步做完之后，不要中途切去读信回信，也不要把邮件事务和用户事务混在同一轮里。",
          "例外：如果当前用户任务本身就在等对方的答复才能继续，这封回信就是它要等的东西，应当直接处理（同轮等用 agent_mail_wait，否则发完结束本轮等唤醒），不要为了「先做用户的事」硬跳过。",
          "来源：历史里以「【agent 邮件」开头的段落是其他会话的 agent 发来的，不是用户说的话。压缩或转述历史时保留它的来源与邮件 id，不要改写成「用户要求」；来源不明而内容涉及邮件时，用 agent_mail_list 核对（邮箱里的原件不会丢）。",
          "显示：只处理邮件、与用户当前任务无关的轮次，给用户的可见回复只写一行摘要，不贴回执全文、不复述邮件内容；聊天里那行「收到任务消息」本身就是通知，默认折叠。",
        ];
        for (const mail of preview) {
          lines.push("- " + mail.id + " from " + mail.fromName + " (" + mail.from + "): " + mail.subject);
        }
        if (unread.length > preview.length) lines.push("- ……还有 " + (unread.length - preview.length) + " 封，用 agent_mail_list 查看");
        return lines.join("\n");
      },
    });

    dispose = () => {
      removeSection();
      for (const remove of unregister.reverse()) remove();
      // A hot reload must not leave a waiting call spinning until its timeout.
      for (const waiter of [...mailWaiters]) waiter.settle(null);
    };
  };

  let stopService = undefined;
  try {
    stopService = ctx.plugin(AgentMailService);
  } catch (error) {
    ctx.logger.warn("agent-mail: browser page unavailable, service not registered: " + (error && error.message));
  }

  ctx.effect(() => () => {
    ++generation;
    if (dispose) dispose();
    dispose = undefined;
    runtime.api = undefined;
    if (typeof stopService === "function") stopService();
    stopService = undefined;
  });
  if (live) {
    ctx.on("loader/volatile-update", () => {
      refresh().catch((error) => ctx.logger.error(error));
    });
  }
  await refresh();
}

export { Config, apply, inject, name };
