/**
 * Mailbox storage for dsh-agent-mail.
 *
 * Append-mostly JSONL: new mail appends, read-marking and trim rewrite the file.
 * In-process index. No DSH imports so the
 * module can be unit-tested with plain node.
 *
 * @module dsh-agent-mail/store
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { randomUUID } from 'node:crypto'

/** One message. Plain JSON only. */
export function newMail(input) {
  return {
    id: input.id ?? randomUUID(),
    from: input.from,
    fromName: input.fromName ?? input.from,
    to: input.to,
    subject: input.subject ?? '',
    body: input.body ?? '',
    createdAt: input.createdAt ?? new Date().toISOString(),
    readAt: input.readAt ?? null,
    replyTo: input.replyTo ?? null,
    depth: input.depth ?? 0,
    rootId: input.rootId ?? null,
  }
}

export class Mailbox {
  /**
   * @param {{ file: string, maxPerSession?: number }} options
   */
  constructor(options) {
    this.file = options.file
    this.maxPerSession = options.maxPerSession ?? 500
    this.records = []
    this.bySession = new Map()
    this.byId = new Map()
    this.load()
  }

  load() {
    this.records = []
    this.bySession.clear()
    this.byId.clear()
    if (!existsSync(this.file)) return
    const raw = readFileSync(this.file, 'utf8')
    for (const line of raw.split('\n')) {
      const text = line.trim()
      if (text === '') continue
      let record
      try {
        record = JSON.parse(text)
      } catch {
        continue
      }
      this.index(record)
    }
  }

  addToMaps(record) {
    this.byId.set(record.id, record)
    for (const session of [record.from, record.to]) {
      const bucket = this.bySession.get(session)
      if (bucket === undefined) this.bySession.set(session, [record])
      else if (!bucket.includes(record)) bucket.push(record)
    }
  }

  index(record) {
    this.records.push(record)
    this.addToMaps(record)
  }

  /** Rebuild the derived maps from this.records, e.g. after a trim. */
  reindex() {
    this.byId.clear()
    this.bySession.clear()
    for (const record of this.records) this.addToMaps(record)
  }

  /** Records that touch this session; lookups stay inside one bucket, not the whole file. */
  bucketOf(sessionId) {
    return this.bySession.get(sessionId) ?? []
  }

  inbox(sessionId) {
    return this.bucketOf(sessionId).filter((record) => record.to === sessionId)
  }

  sent(sessionId) {
    return this.bucketOf(sessionId).filter((record) => record.from === sessionId)
  }

  unread(sessionId) {
    return this.inbox(sessionId).filter((record) => record.readAt === null)
  }

  get(id) {
    return this.byId.get(id)
  }

  /** Thread root of one record: follow replyTo up to the first mail. */
  rootIdOf(record) {
    if (record.rootId !== undefined && record.rootId !== null) return record.rootId
    const seen = new Set()
    let cursor = record
    while (cursor !== undefined && cursor !== null && cursor.replyTo !== null && cursor.replyTo !== undefined && !seen.has(cursor.id)) {
      seen.add(cursor.id)
      const parent = this.byId.get(cursor.replyTo)
      if (parent === undefined) break
      cursor = parent
    }
    return cursor.id
  }

  /** Group the mails this session sent or received into reply threads, newest thread first. */
  threads(sessionId) {
    const groups = new Map()
    for (const record of this.records) {
      if (record.from !== sessionId && record.to !== sessionId) continue
      const root = this.rootIdOf(record)
      const bucket = groups.get(root)
      if (bucket === undefined) groups.set(root, [record])
      else bucket.push(record)
    }
    const result = []
    for (const [rootId, mails] of groups) {
      const sorted = mails.slice().sort((a, b) => (a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0))
      result.push({ rootId, mails: sorted })
    }
    result.sort((a, b) => {
      const left = a.mails[a.mails.length - 1].createdAt
      const right = b.mails[b.mails.length - 1].createdAt
      return left < right ? 1 : left > right ? -1 : 0
    })
    return result
  }

  append(record) {
    if (record.rootId === undefined || record.rootId === null) {
      const parent = record.replyTo === null || record.replyTo === undefined ? undefined : this.byId.get(record.replyTo)
      record.rootId = parent === undefined ? record.id : this.rootIdOf(parent)
    }
    mkdirSync(dirname(this.file), { recursive: true })
    appendFileSync(this.file, JSON.stringify(record) + '\n', 'utf8')
    this.index(record)
    this.trim(record.to)
    return record
  }

  /** Drop the oldest already-read mail when a session exceeds its cap. */
  trim(sessionId) {
    const bucket = this.inbox(sessionId)
    if (bucket.length <= this.maxPerSession) return
    const extra = bucket.length - this.maxPerSession
    const droppable = bucket.filter((record) => record.readAt !== null).slice(0, extra)
    if (droppable.length === 0) return
    const drop = new Set(droppable.map((record) => record.id))
    this.records = this.records.filter((record) => !drop.has(record.id))
    this.reindex()
    this.rewrite()
  }

  markRead(ids) {
    const now = new Date().toISOString()
    let changed = false
    for (const id of ids) {
      const record = this.byId.get(id)
      if (record === undefined || record.readAt !== null) continue
      record.readAt = now
      changed = true
    }
    if (changed) this.rewrite()
    return changed
  }

  rewrite() {
    mkdirSync(dirname(this.file), { recursive: true })
    const temp = this.file + '.' + randomUUID() + '.tmp'
    const body = this.records.map((record) => JSON.stringify(record)).join('\n')
    writeFileSync(temp, body === '' ? '' : body + '\n', 'utf8')
    renameSync(temp, this.file)
  }

  knownSessions() {
    return [...this.bySession.keys()]
  }
}

/** Default mailbox path: <dshHome>/agent-mail/mailbox.jsonl */
export function defaultDataDir(dshHome) {
  return join(dshHome, 'agent-mail')
}
