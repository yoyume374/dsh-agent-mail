import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createMailApi } from "../lib/service.js";
import { Mailbox, newMail } from "../lib/store.js";

function fixture() {
  const dir = mkdtempSync(join(tmpdir(), "dsh-agent-mail-"));
  const box = new Mailbox({ file: join(dir, "mailbox.jsonl") });
  const peers = [
    { sessionId: "s-a", name: "lead", live: true },
    { sessionId: "s-b", name: "helper", live: true },
  ];
  const api = createMailApi({ getBox: () => box, getPeers: () => peers });
  const send = (from, to, subject, extra = {}) => {
    const mail = newMail({ from, to, subject, body: subject + " body", ...extra });
    box.append(mail);
    return mail;
  };
  return { dir, box, api, send, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

test("list returns metadata only, newest first, with direction and the unread count", async () => {
  const f = fixture();
  try {
    f.send("s-b", "s-a", "one");
    const second = f.send("s-b", "s-a", "two");
    const page = await f.api.list({ sessionId: "s-a" });
    assert.equal(page.unread, 2);
    assert.deepEqual(page.rows.map((row) => row.subject), ["two", "one"]);
    assert.equal(page.rows[0].id, second.id);
    assert.equal(page.rows[0].direction, "in");
    assert.equal("body" in page.rows[0], false);
  } finally {
    f.cleanup();
  }
});

test("list honours unreadOnly, the sent box, box 'all' and the limit", async () => {
  const f = fixture();
  try {
    const first = f.send("s-b", "s-a", "one");
    f.send("s-b", "s-a", "two");
    f.box.markRead([first.id]);
    const unread = await f.api.list({ sessionId: "s-a", unreadOnly: true });
    assert.deepEqual(unread.rows.map((row) => row.subject), ["two"]);
    assert.equal(unread.unread, 1);
    const sent = await f.api.list({ sessionId: "s-b", box: "sent" });
    assert.equal(sent.rows.length, 2);
    assert.equal(sent.rows[0].direction, "out");
    const all = await f.api.list({ sessionId: "s-a", box: "all" });
    assert.equal(all.rows.length, 2);
    const limited = await f.api.list({ sessionId: "s-a", limit: 1 });
    assert.deepEqual(limited.rows.map((row) => row.subject), ["two"]);
  } finally {
    f.cleanup();
  }
});

test("peek returns the body without changing read state, and only to thread members", async () => {
  const f = fixture();
  try {
    const mail = f.send("s-b", "s-a", "hello");
    await assert.rejects(() => f.api.peek({ sessionId: "s-c", id: mail.id }), /not part of that thread/);
    const detail = await f.api.peek({ sessionId: "s-a", id: mail.id });
    assert.equal(detail.body, "hello body");
    assert.equal(f.box.unread("s-a").length, 1);
    assert.equal(f.box.unread("s-a")[0].readAt, null);
    const sender = await f.api.peek({ sessionId: "s-b", id: mail.id });
    assert.equal(sender.direction, "out");
    await assert.rejects(() => f.api.peek({ sessionId: "s-a", id: "nope" }), /unknown mail/);
  } finally {
    f.cleanup();
  }
});

test("threads groups a request, its reply and the reply-back into one thread newest first", async () => {
  const f = fixture();
  try {
    const root = f.send("s-a", "s-b", "question");
    const reply = f.send("s-b", "s-a", "answer", { replyTo: root.id, depth: 1 });
    const back = f.send("s-a", "s-b", "thanks", { replyTo: reply.id, depth: 2 });
    f.send("s-b", "s-a", "unrelated");

    const page = await f.api.threads({ sessionId: "s-a" });
    assert.equal(page.groups.length, 2);
    const thread = page.groups.find((group) => group.rootId === root.id);
    assert.equal(thread.count, 3);
    assert.deepEqual(thread.mails.map((mail) => mail.subject), ["question", "answer", "thanks"]);
    assert.deepEqual(thread.mails.map((mail) => mail.direction), ["out", "in", "out"]);
    assert.deepEqual(thread.participants, ["s-a", "s-b"]);
    assert.equal(thread.unread, 1);
    assert.equal(thread.subject, "question");
    assert.equal(page.unread, 2);
  } finally {
    f.cleanup();
  }
});

test("threads keeps old mail without rootId grouped through its replyTo chain", async () => {
  const f = fixture();
  try {
    const root = { id: "m-root", from: "s-a", fromName: "s-a", to: "s-b", subject: "old", body: "x", createdAt: "2026-01-01T00:00:00.000Z", readAt: null, replyTo: null, depth: 0 };
    f.box.index(root);
    const reply = { id: "m-reply", from: "s-b", fromName: "s-b", to: "s-a", subject: "old-re", body: "y", createdAt: "2026-01-01T00:01:00.000Z", readAt: null, replyTo: "m-root", depth: 1 };
    f.box.index(reply);
    const page = await f.api.threads({ sessionId: "s-a" });
    assert.equal(page.groups.length, 1);
    assert.equal(page.groups[0].rootId, "m-root");
    assert.equal(page.groups[0].count, 2);
  } finally {
    f.cleanup();
  }
});

test("peers excludes the caller and the api validates its input", async () => {
  const f = fixture();
  try {
    const peers = await f.api.peers({ sessionId: "s-a" });
    assert.deepEqual(peers.map((peer) => peer.sessionId), ["s-b"]);
    await assert.rejects(() => f.api.list({ sessionId: "" }), /sessionId is required/);
    await assert.rejects(() => f.api.threads({ sessionId: "" }), /sessionId is required/);
    const capped = await f.api.list({ sessionId: "s-a", limit: 10_000 });
    assert.deepEqual(capped.rows, []);
  } finally {
    f.cleanup();
  }
});
