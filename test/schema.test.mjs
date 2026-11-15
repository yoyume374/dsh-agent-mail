import assert from 'node:assert/strict'
import { test } from 'node:test'
import { ACK_SCHEMA, IDS_PARAM, MAIL_SCHEMA, PEER_SCHEMA, SEND_SCHEMA, WAIT_SCHEMA } from '../lib/schemas.js'

const ANNOTATIONS = new Set(['description', 'default', 'title', 'deprecated', 'examples'])
const TYPES = new Set(['string', 'number', 'integer', 'boolean', 'null', 'array', 'object', 'json'])

/** Walk an author-dialect schema and collect violations. */
const lint = (node, path, allowRequired) => {
  const problems = []
  if (node === null || typeof node !== 'object' || Array.isArray(node)) return [path + ' must be an object']
  for (const key of Object.keys(node)) {
    if (key === 'required' && allowRequired) continue
    if (ANNOTATIONS.has(key)) continue
    if (!['type', 'properties', 'items', 'additionalProperties', 'enum', 'const'].includes(key)) {
      problems.push(path + ' has unsupported key ' + key)
    }
  }
  if (node.required !== undefined && node.required !== true) problems.push(path + '.required must be true')
  if (!TYPES.has(node.type)) problems.push(path + ' type must be one string, got ' + JSON.stringify(node.type))
  if (node.type === 'object') {
    if (typeof node.additionalProperties !== 'boolean') problems.push(path + ' needs additionalProperties boolean')
    for (const [key, child] of Object.entries(node.properties ?? {})) {
      problems.push(...lint(child, path + '.' + key, true))
    }
    if (node.properties === undefined) problems.push(path + ' object without properties')
  }
  if (node.type === 'array') {
    if (node.items === undefined) problems.push(path + ' array without items')
    else problems.push(...lint(node.items, path + '[]', false))
  }
  return problems
}

test('every output schema follows the author dialect', () => {
  for (const [name, schema] of Object.entries({ SEND_SCHEMA, MAIL_SCHEMA, PEER_SCHEMA, ACK_SCHEMA, WAIT_SCHEMA, IDS_PARAM })) {
    assert.deepEqual(lint(schema, name, false), [])
  }
})

/** Validate a produced value against the same subset the executor enforces. */
const validate = (node, value, path) => {
  const problems = []
  if (node.type === 'object') {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) return [path + ' must be an object']
    const properties = node.properties ?? {}
    for (const key of Object.keys(properties)) {
      if (value[key] === undefined) {
        if (properties[key].required === true) problems.push(path + '.' + key + ' is required')
        continue
      }
      problems.push(...validate(properties[key], value[key], path + '.' + key))
    }
    if (node.additionalProperties === false) {
      for (const key of Object.keys(value)) {
        if (!(key in properties)) problems.push(path + '.' + key + ' is not allowed')
      }
    }
    return problems
  }
  if (node.type === 'array') {
    if (!Array.isArray(value)) return [path + ' must be an array']
    return value.flatMap((item, index) => validate(node.items, item, path + '[' + index + ']'))
  }
  const actual = value === null ? 'null' : Array.isArray(value) ? 'array' : typeof value
  if (node.type !== actual) problems.push(path + ' expected ' + node.type + ' but got ' + actual)
  return problems
}

test('tool return values satisfy their declared schemas', () => {
  const mail = {
    id: 'm1', from: 's1', fromName: 'lead', to: 's2', subject: 'hi', body: 'text',
    createdAt: '2026-11-15T00:00:00.000Z', readAt: '', replyTo: '', depth: 0,
  }
  const send = { id: 'm1', to: 's2', toName: 'helper', subject: 'hi', depth: 0, targetLive: true, unread: 1, woken: true }
  const sendQuiet = { ...send, woken: false, wakeSkipped: '对方不在线' }
  const peer = { sessionId: 's2', name: 'helper', cwd: 'E:/w', live: true, unread: 1, sent: 0 }
  assert.deepEqual(validate(MAIL_SCHEMA, mail, 'mail'), [])
  assert.deepEqual(validate(SEND_SCHEMA, send, 'send'), [])
  assert.deepEqual(validate(SEND_SCHEMA, sendQuiet, 'send'), [])
  assert.deepEqual(validate(PEER_SCHEMA, peer, 'peer'), [])
  assert.deepEqual(validate(ACK_SCHEMA, { marked: 2 }, 'ack'), [])
  assert.deepEqual(validate(MAIL_SCHEMA, { ...mail, readAt: null }, 'mail'), ['mail.readAt expected string but got null'])
  assert.deepEqual(validate(SEND_SCHEMA, { ...send, woken: undefined }, 'send'), ['send.woken is required'])
  const waited = { ...mail, timedOut: false, waitedMs: 12 }
  const timedOut = { timedOut: true, waitedMs: 60000, id: '', from: '', fromName: '', to: 's2', subject: '', body: '', createdAt: '', readAt: '', replyTo: '', depth: 0 }
  assert.deepEqual(validate(WAIT_SCHEMA, waited, 'wait'), [])
  assert.deepEqual(validate(WAIT_SCHEMA, timedOut, 'wait'), [])
  assert.deepEqual(validate(WAIT_SCHEMA, { ...timedOut, timedOut: undefined }, 'wait'), ['wait.timedOut is required'])
})
