/**
 * Runtime-editable settings for dsh-agent-mail.
 *
 * The plugin config (profile cordis.yml) is the base; the page can override a
 * subset of keys and the overrides are persisted next to the mailbox in
 * settings.json. Everything here is plain node so it can be unit-tested.
 *
 * @module dsh-agent-mail/settings
 */
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

/**
 * Keys the page may change. "value" types are enforced; ranges keep a bad
 * number from silently disabling the plugin.
 */
export const EDITABLE = {
  wakeOnSend: {
    type: 'boolean',
    label: '自动唤醒收件方',
    hint: '关掉后只投递不唤醒；agent 调用时仍可用 wake:true 单次开启',
  },
  wakeOffline: {
    type: 'boolean',
    label: '离线会话也唤醒',
    hint: '对方没打开时也加载它的会话历史后唤醒；关掉则只投递，等它被打开',
  },
  ratePerMinute: {
    type: 'number',
    min: 1,
    max: 600,
    label: '每分钟每对上限',
    hint: '同一对会话之间每分钟最多几封',
  },
  ratePerSessionMinute: {
    type: 'number',
    min: 1,
    max: 1200,
    label: '每分钟每会话上限',
    hint: '任何来源发给同一会话，每分钟最多几封',
  },
  maxDepth: {
    type: 'number',
    min: 0,
    max: 50,
    label: '最大回复深度',
    hint: '自动回复链最深几层；超过后 agent 必须停下来问用户',
  },
  maxMailbox: {
    type: 'number',
    min: 10,
    max: 100000,
    label: '每会话保留封数',
    hint: '超出后先丢最老的已读邮件',
  },
  promptPreview: {
    type: 'number',
    min: 0,
    max: 50,
    label: '未读摘要条数',
    hint: '每轮系统提示词里最多列出几封未读邮件的主题',
  },
  bodyLimit: {
    type: 'number',
    min: 100,
    max: 200000,
    label: '单封正文上限（字符）',
    hint: '超出部分发送时截断',
  },
}

const SETTINGS_FILE = 'settings.json'

export function settingsFile(dir) {
  return join(dir, SETTINGS_FILE)
}

function normalizeValue(key, raw) {
  const spec = EDITABLE[key]
  if (spec.type === 'boolean') {
    if (typeof raw === 'boolean') return raw
    if (raw === 'true') return true
    if (raw === 'false') return false
    throw new Error('设置 ' + key + ' 需要 true / false')
  }
  const value = Number(raw)
  if (!Number.isFinite(value)) throw new Error('设置 ' + key + ' 需要数字')
  const rounded = Math.round(value)
  if (rounded < spec.min || rounded > spec.max) {
    throw new Error('设置 ' + key + ' = ' + rounded + ' 超出范围 ' + spec.min + '..' + spec.max)
  }
  return rounded
}

/** Read the overrides file; unknown or invalid keys are ignored. */
export function readOverrides(dir) {
  const file = settingsFile(dir)
  if (!existsSync(file)) return {}
  let parsed
  try {
    parsed = JSON.parse(readFileSync(file, 'utf8'))
  } catch {
    return {}
  }
  if (parsed === null || typeof parsed !== 'object') return {}
  const overrides = {}
  for (const key of Object.keys(EDITABLE)) {
    if (!(key in parsed)) continue
    try {
      overrides[key] = normalizeValue(key, parsed[key])
    } catch {
      // Ignore a hand-edited value that no longer validates.
    }
  }
  return overrides
}

/** Persist the overrides object atomically. */
export function writeOverrides(dir, overrides) {
  const file = settingsFile(dir)
  mkdirSync(dirname(file), { recursive: true })
  const tmp = file + '.tmp'
  writeFileSync(tmp, JSON.stringify(overrides, null, 2) + '\n', 'utf8')
  renameSync(tmp, file)
  return file
}

/** Merge config defaults with overrides into the effective settings. */
export function applyOverrides(config, overrides) {
  return { ...config, ...overrides }
}

/**
 * Apply a page-submitted patch of { key: value | null }. null clears the
 * override so the config value wins again.
 *
 * @returns {{ overrides: object, changed: string[] }}
 */
export function mergePatch(overrides, values) {
  if (values === null || typeof values !== 'object') {
    throw new Error('设置请求必须是 { key: value } 对象')
  }
  const next = { ...overrides }
  const changed = []
  for (const key of Object.keys(values)) {
    if (!(key in EDITABLE)) throw new Error('未知设置项 ' + key)
    const raw = values[key]
    if (raw === null || raw === undefined) {
      if (key in next) {
        delete next[key]
        changed.push(key)
      }
      continue
    }
    const value = normalizeValue(key, raw)
    if (next[key] !== value) {
      next[key] = value
      changed.push(key)
    }
  }
  if (changed.length === 0) throw new Error('没有要保存的改动')
  return { overrides: next, changed }
}

/** Shape the page renders: effective value, config value, and whether overridden. */
export function describeSettings(config, overrides) {
  const rows = []
  for (const key of Object.keys(EDITABLE)) {
    const spec = EDITABLE[key]
    rows.push({
      key,
      label: spec.label,
      hint: spec.hint ?? '',
      type: spec.type,
      min: spec.type === 'number' ? spec.min : 0,
      max: spec.type === 'number' ? spec.max : 0,
      value: key in overrides ? overrides[key] : config[key],
      configured: config[key],
      overridden: key in overrides,
    })
  }
  return {
    overrides: { ...overrides },
    rows,
    wakeSummary:
      (overrides.wakeOnSend ?? config.wakeOnSend) === false
        ? '当前：只投递，不自动唤醒'
        : (overrides.wakeOffline ?? config.wakeOffline) === false
          ? '当前：在线会话自动唤醒，离线会话只投递'
          : '当前：自动唤醒收件方（离线会话也会先加载）',
  }
}
