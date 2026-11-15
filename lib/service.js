/**
 * Client-facing read API over the mailbox. Pure functions so the browser RPC
 * layer and its unit tests share one implementation.
 *
 * The page never marks mail read: read state means "has the agent read it",
 * decided only by the agent's own agent_mail_read / agent_mail_ack calls.
 *
 * @module dsh-agent-mail/service
 */

function clampLimit(value, fallback, max) {
  const number = Number(value)
  if (!Number.isFinite(number) || number < 1) return fallback
  return Math.min(Math.floor(number), max)
}

/** Read state is the agent's call alone; the page never marks mail read. */
const isUnread = (mail) => mail.readAt === null

function meta(mail, viewer) {
  return {
    id: mail.id,
    from: mail.from,
    fromName: mail.fromName,
    to: mail.to,
    subject: mail.subject,
    createdAt: mail.createdAt,
    readAt: mail.readAt ?? '',
    replyTo: mail.replyTo ?? '',
    depth: mail.depth,
    direction: mail.from === viewer ? 'out' : 'in',
  };
}

/**
 * @param {{ getBox: () => any, getPeers: () => any[] }} deps
 */
export function createMailApi(deps) {
  const requireSession = (args, method) => {
    const sessionId = String(args.sessionId || '')
    if (sessionId === '') throw new Error('agentMail.' + method + ': sessionId is required')
    return sessionId
  }

  return {
    async list(args) {
      const sessionId = requireSession(args, 'list')
      const box = deps.getBox()
      const source = args.box === 'sent' ? box.sent(sessionId) : args.box === 'all' ? box.threads(sessionId).flatMap((group) => group.mails) : box.inbox(sessionId)
      const filtered = args.unreadOnly ? source.filter(isUnread) : source
      const limit = clampLimit(args.limit ?? 50, 50, 200)
      return {
        sessionId,
        unread: box.unread(sessionId).length,
        rows: filtered.slice(-limit).reverse().map((mail) => meta(mail, sessionId)),
      }
    },

    /**
     * Reply threads this session took part in, newest thread first. Each group
     * is one root mail plus every reply, so "sent → reply → reply-back" stays
     * together instead of scattering across the list.
     */
    async threads(args) {
      const sessionId = requireSession(args, 'threads')
      const box = deps.getBox()
      const limit = clampLimit(args.limit ?? 30, 30, 100)
      const groups = box.threads(sessionId).slice(0, limit).map((group) => {
        const participants = []
        for (const mail of group.mails) {
          for (const side of [mail.from, mail.to]) {
            if (!participants.includes(side)) participants.push(side)
          }
        }
        const mails = group.mails.map((mail) => meta(mail, sessionId))
        return {
          rootId: group.rootId,
          subject: group.mails[0].subject,
          participants,
          count: group.mails.length,
          unread: group.mails.filter((mail) => mail.to === sessionId && isUnread(mail)).length,
          startedAt: group.mails[0].createdAt,
          lastAt: group.mails[group.mails.length - 1].createdAt,
          mails,
        }
      })
      return { sessionId, unread: box.unread(sessionId).length, groups }
    },

    /** Body of one mail, without touching read state. Visible to both sides of the thread. */
    async peek(args) {
      const sessionId = requireSession(args, 'peek')
      const box = deps.getBox()
      const mail = box.get(String(args.id || ''))
      if (mail === undefined) throw new Error('agentMail.peek: unknown mail')
      if (mail.from !== sessionId && mail.to !== sessionId) throw new Error('agentMail.peek: this session is not part of that thread')
      return Object.assign(meta(mail, sessionId), { body: mail.body })
    },

    async peers(args) {
      const sessionId = requireSession(args, 'peers')
      const rows = await deps.getPeers()
      return rows.filter((peer) => peer.sessionId !== sessionId)
    },

    /** Current editable settings plus the values the profile config supplies. */
    async settings() {
      return deps.getSettings()
    },

    /** Persist a patch of { key: value | null }; null restores the config value. */
    async updateSettings(request) {
      return deps.updateSettings((request && request.values) || {})
    },
  }
}
