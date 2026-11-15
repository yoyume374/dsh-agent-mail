import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { createLimiter, depthVerdict } from '../lib/limits.js'
import { Mailbox, newMail } from '../lib/store.js'

const withMailbox = (run) => {
  const dir = mkdtempSync(join(tmpdir(), 'agent-mail-'))
  try {
    return run(join(dir, 'mailbox.jsonl'))
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

test('append, reload, unread and read marking', () => {
  withMailbox((file) => {
    const box = new Mailbox({ file })
    box.append(newMail({ from: 'A', to: 'B', subject: 'hi', body: 'body' }))
    assert.equal(box.unread('B').length, 1)

    const reloaded = new Mailbox({ file })
    assert.equal(reloaded.inbox('B').length, 1)
    const mail = reloaded.unread('B')[0]
    assert.equal(mail.subject, 'hi')

    reloaded.markRead([mail.id])
    assert.equal(new Mailbox({ file }).unread('B').length, 0)
  })
})

test('reply depth follows the chain', () => {
  withMailbox((file) => {
    const box = new Mailbox({ file })
    const root = box.append(newMail({ from: 'A', to: 'B', subject: 'r' }))
    const reply = box.append(newMail({ from: 'B', to: 'A', subject: 're', replyTo: root.id }))
    assert.equal(root.depth, 0)
    assert.equal(reply.depth, 0)
    assert.equal(depthVerdict({ depth: 5, maxDepth: 5 }).ok, true)
    assert.equal(depthVerdict({ depth: 6, maxDepth: 5 }).ok, false)
  })
})

test('rate limiter blocks the seventh message in a minute', () => {
  let clock = 1_000_000
  const limiter = createLimiter({ perPairPerMinute: 6, perSessionPerMinute: 20, now: () => clock })
  for (let i = 0; i < 6; i++) {
    assert.equal(limiter.check('A', 'B').ok, true)
    limiter.record('A', 'B')
  }
  const verdict = limiter.check('A', 'B')
  assert.equal(verdict.ok, false)
  assert.equal(verdict.reason, 'pair-rate')
  clock += 61_000
  assert.equal(limiter.check('A', 'B').ok, true)
})

test('trim keeps the cap by dropping read mail first', () => {
  withMailbox((file) => {
    const box = new Mailbox({ file, maxPerSession: 2 })
    const a = box.append(newMail({ from: 'A', to: 'B', subject: '1' }))
    box.append(newMail({ from: 'A', to: 'B', subject: '2' }))
    box.markRead([a.id])
    box.append(newMail({ from: 'A', to: 'B', subject: '3' }))
    assert.deepEqual(box.inbox('B').map((m) => m.subject), ['2', '3'])
    assert.equal(new Mailbox({ file, maxPerSession: 2 }).inbox('B').length, 2)
  })
})
