/**
 * Rate limiting and reply-depth policy for dsh-agent-mail.
 *
 * @module dsh-agent-mail/limits
 */

/**
 * @param {{ perPairPerMinute: number, perSessionPerMinute: number, now?: () => number }} options
 */
export function createLimiter(options) {
  const now = options.now ?? Date.now
  const pairHits = new Map()
  const sessionHits = new Map()

  const prune = (list, floor) => list.filter((at) => at > floor)

  const retryAfter = (list, windowMs) => {
    if (list.length === 0) return 0
    return Math.max(0, list[0] + windowMs - now())
  }

  return {
    /**
     * @returns {{ ok: true } | { ok: false, reason: string, retryAfterMs: number }}
     */
    check(from, to) {
      const windowMs = 60_000
      const floor = now() - windowMs
      const pair = prune(pairHits.get(from + '>' + to) ?? [], floor)
      pairHits.set(from + '>' + to, pair)
      if (pair.length >= options.perPairPerMinute) {
        return { ok: false, reason: 'pair-rate', retryAfterMs: retryAfter(pair, windowMs) }
      }
      const session = prune(sessionHits.get(to) ?? [], floor)
      sessionHits.set(to, session)
      if (session.length >= options.perSessionPerMinute) {
        return { ok: false, reason: 'session-rate', retryAfterMs: retryAfter(session, windowMs) }
      }
      return { ok: true }
    },
    record(from, to) {
      const stamp = now()
      const pairKey = from + '>' + to
      pairHits.set(pairKey, [...(pairHits.get(pairKey) ?? []), stamp])
      sessionHits.set(to, [...(sessionHits.get(to) ?? []), stamp])
    },
  }
}

/**
 * Reply chains deeper than maxDepth need a human decision, not an agent loop.
 * @param {{ depth: number, maxDepth: number }} input
 */
export function depthVerdict(input) {
  if (input.depth <= input.maxDepth) return { ok: true }
  return {
    ok: false,
    reason:
      'reply depth ' + input.depth + ' exceeds maxDepth ' + input.maxDepth +
      ': stop and ask the user whether this thread should continue, then raise maxDepth in the agent-mail plugin config if approved',
  }
}
