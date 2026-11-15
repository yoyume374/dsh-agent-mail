/**
 * Output schemas for dsh-agent-mail, kept free of DSH imports so they can be
 * linted and exercised offline.
 *
 * Author dialect (dsh-tools schema.ts): one scalar type string per node, every
 * object needs an explicit additionalProperties boolean, and "required: true"
 * is only valid inside a property definition.
 *
 * @module dsh-agent-mail/schemas
 */

export const SEND_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    id: { type: "string", required: true },
    to: { type: "string", required: true },
    toName: { type: "string" },
    subject: { type: "string", required: true },
    depth: { type: "number", required: true },
    targetLive: { type: "boolean", required: true },
    unread: { type: "number", required: true },
    woken: { type: "boolean", required: true },
    resumed: { type: "boolean" },
    wakeSkipped: { type: "string" },
  },
};

export const MAIL_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    id: { type: "string", required: true },
    from: { type: "string", required: true },
    fromName: { type: "string" },
    to: { type: "string", required: true },
    subject: { type: "string", required: true },
    body: { type: "string" },
    createdAt: { type: "string", required: true },
    readAt: { type: "string", required: true },
    replyTo: { type: "string", required: true },
    depth: { type: "number", required: true },
  },
};

export const PEER_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    sessionId: { type: "string", required: true },
    name: { type: "string" },
    cwd: { type: "string" },
    lastActivityAt: { type: "string" },
    live: { type: "boolean", required: true },
    unread: { type: "number", required: true },
    sent: { type: "number", required: true },
  },
};

export const ACK_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    marked: { type: "number", required: true },
  },
};

export const IDS_PARAM = { type: "array", items: { type: "string" } };

/**
 * Wait result: the delivered mail flattened, plus timing flags. A timeout keeps
 * the same shape with timedOut: true and empty fields, so the tool always
 * returns one predictable object.
 */
export const WAIT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    timedOut: { type: "boolean", required: true },
    waitedMs: { type: "number", required: true },
    id: { type: "string", required: true },
    from: { type: "string", required: true },
    fromName: { type: "string" },
    to: { type: "string", required: true },
    subject: { type: "string", required: true },
    body: { type: "string" },
    createdAt: { type: "string", required: true },
    readAt: { type: "string", required: true },
    replyTo: { type: "string", required: true },
    depth: { type: "number", required: true },
  },
};

