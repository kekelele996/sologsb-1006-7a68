import { writable, get } from 'svelte/store'
import type {
  ContentBundle, Cue, CueStatus, LiveState, Reminder, SyncEvent, VersionEntry, VersionManifest
} from './types'
import { assembleBundle, clone, detectTerms, findDuplicate, getDelay, INITIAL_VERSION, seedContent, seedCues } from './catalog'

const STORAGE_KEY = 'conference-live-v1'

function freshState(online = true): LiveState {
  const bundle = { ...seedContent(), version: INITIAL_VERSION, publishedAt: Date.now() }
  return {
    activeVersion: bundle.version,
    speakers: bundle.speakers,
    sessions: bundle.sessions,
    terms: bundle.terms,
    announcements: bundle.announcements,
    publishedAt: bundle.publishedAt,
    staging: null,
    stagedEntries: [],
    cues: seedCues(bundle.version),
    reminders: [],
    activeCueId: 'cue-103',
    fontScale: 100,
    online,
    liveSimulation: true,
    syncLog: [{ id: `log-${Date.now()}`, at: Date.now(), level: 'success', message: `已接收并启用中控第 ${INITIAL_VERSION} 版议程与术语表。` }]
  }
}

function loadState(): LiveState {
  if (typeof localStorage === 'undefined') return freshState()
  try {
    const saved = localStorage.getItem(STORAGE_KEY)
    if (!saved) return freshState(typeof navigator !== 'undefined' ? navigator.onLine : true)
    const parsed: LiveState = { ...freshState(), ...JSON.parse(saved) }
    // 本地加载时不替用户决定网络状态
    return parsed
  } catch {
    return freshState()
  }
}

const history: LiveState[] = []
const future: LiveState[] = []
export const live = writable<LiveState>(loadState())

function persist(state: LiveState) {
  if (typeof localStorage !== 'undefined') localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
}

function commit(recipe: (state: LiveState) => void, options: { history?: boolean } = { history: true }) {
  const current = clone(get(live))
  const next = clone(current)
  recipe(next)
  if (options.history !== false) {
    history.push(current)
    if (history.length > 60) history.shift()
    future.length = 0
  }
  persist(next)
  live.set(next)
}

export function liveUndo() {
  const previous = history.pop()
  if (!previous) return
  future.push(clone(get(live)))
  persist(previous); live.set(previous)
}
export function liveRedo() {
  const next = future.pop()
  if (!next) return
  history.push(clone(get(live)))
  persist(next); live.set(next)
}
export const canLiveUndo = () => history.length > 0
export const canLiveRedo = () => future.length > 0

export function appendLog(level: SyncEvent['level'], message: string) {
  commit(state => {
    state.syncLog.unshift({ id: `log-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, at: Date.now(), level, message })
    if (state.syncLog.length > 100) state.syncLog.length = 100
  }, { history: false })
}

/* ---------- 版本接收：清单 + 逐条进入暂存区，集齐才切换 ---------- */

/** 接收版本清单。旧版本忽略；同一时刻只保留一个在途版本。 */
export function receiveManifest(manifest: VersionManifest): 'ignored' | 'staged' {
  const state = get(live)
  if (manifest.version <= state.activeVersion) return 'ignored'
  commit(next => {
    const carried = next.staging && next.staging.version === manifest.version
      ? next.staging.receivedEntries
      : []
    next.staging = { ...manifest, receivedEntries: carried }
    next.stagedEntries = carried.length
      ? next.stagedEntries.filter(entry => entry.version === manifest.version)
      : []
  }, { history: false })
  return 'staged'
}

/** 接收单条内容；返回可销账 uid（用于回执）与是否刚刚集齐版本 */
export function receiveEntries(entries: VersionEntry[]): { ackUids: string[]; applied: ContentBundle | null } {
  const state = get(live)
  const staging = state.staging
  // 只有"已是旧版本"或"正属于当前暂存版本"的条目才能在本拍销账；
  // 更高版本、暂存区尚未就位的条目不回执，恢复对账时由发件箱原样补发。
  const usable = entries.filter(entry => staging && entry.version === staging.version)
  const stale = entries.filter(entry => entry.version <= state.activeVersion)
  if (!usable.length) {
    return { ackUids: stale.map(entry => `v${entry.version}:${entry.uid}`), applied: null }
  }
  let applied: ContentBundle | null = null
  commit(next => {
    for (const entry of usable) {
      if (!next.staging || next.staging.version !== entry.version) continue
      if (next.staging.receivedEntries.includes(entry.uid)) continue
      next.staging.receivedEntries.push(entry.uid)
      next.stagedEntries.push(clone(entry))
    }
    const target = next.staging
    if (target && target.receivedEntries.length >= target.totalEntries) {
      const bundle = assembleBundle(target.version, target.publishedAt, next.stagedEntries.filter(entry => entry.version === target.version))
      activateBundle(next, bundle)
      applied = bundle
      next.staging = null
      next.stagedEntries = []
    }
  }, { history: false })
  // 暂存版条目（含重复补发）+ 旧版条目都可销账
  const ackUids = [...usable, ...stale].map(entry => `v${entry.version}:${entry.uid}`)
  return { ackUids, applied }
}

/**
 * 切换到新版本：替换议程/术语/通知；只重新解释未确认条目，
 * 已确认（上屏）段落保留当时那版译法，不做任何改动。
 */
function activateBundle(state: LiveState, bundle: ContentBundle) {
  state.speakers = bundle.speakers
  state.sessions = bundle.sessions
  state.terms = bundle.terms
  state.announcements = bundle.announcements
  state.publishedAt = bundle.publishedAt
  state.activeVersion = bundle.version
  for (const cue of state.cues) {
    if (cue.status === 'confirmed') continue
    cue.tags = detectTerms(cue.text, bundle.terms)
    cue.termsVersion = bundle.version
  }
}

/* ---------- 网络与模拟 ---------- */

export function setOnline(online: boolean) {
  commit(state => {
    state.online = online
    if (online) {
      // 恢复后对离线条目重新做重复检查
      state.cues.forEach(cue => {
        if (cue.offline) {
          cue.offline = false
          const duplicate = findDuplicate(cue.text, state.cues.filter(item => item.id !== cue.id && !item.offline))
          cue.duplicateOf = duplicate?.id || null
        }
      })
    }
  })
}
export function setLiveSimulation(enabled: boolean) { commit(state => { state.liveSimulation = enabled }) }

/* ---------- 现场队列（现场独有，中控不持有） ---------- */

export function setActiveCue(id: string) { commit(state => { state.activeCueId = id }) }
export function moveCue(direction: 1 | -1) {
  const state = get(live)
  const index = state.cues.findIndex(item => item.id === state.activeCueId)
  const next = state.cues[index + direction]
  if (next) setActiveCue(next.id)
}
export function setFontScale(scale: number) { commit(state => { state.fontScale = Math.min(150, Math.max(85, scale)) }) }

export function ingestCue(text: string, options: { manual?: boolean; speakerId?: string; receivedAt?: number } = {}) {
  const trimmed = text.trim()
  if (!trimmed) return
  commit(state => {
    const existing = state.cues.filter(item => item.text !== trimmed)
    const duplicate = findDuplicate(trimmed, existing)
    const speakerId = options.speakerId || state.sessions.find(item => item.status === 'live')?.speakerId || state.speakers[0]?.id || ''
    const receivedAt = options.receivedAt || Date.now()
    const cue: Cue = {
      id: `cue-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, speakerId, text: trimmed, receivedAt,
      status: 'pending', manual: Boolean(options.manual), offline: !state.online,
      delaySeconds: Math.max(0, Math.round((Date.now() - receivedAt) / 1000)),
      duplicateOf: duplicate?.id || null, followupText: '',
      // 进入队列时按当前生效版本的术语表定格
      tags: detectTerms(trimmed, state.terms), termsVersion: state.activeVersion
    }
    state.cues.push(cue); state.activeCueId = cue.id
  })
}
export function updateCue(id: string, patch: Partial<Cue>) { commit(state => { const cue = state.cues.find(item => item.id === id); if (cue) Object.assign(cue, patch) }) }
export function setCueStatus(id: string, status: CueStatus) {
  commit(state => { const cue = state.cues.find(item => item.id === id); if (cue) cue.status = status })
}
export function deleteCue(id: string) { commit(state => { state.cues = state.cues.filter(item => item.id !== id); if (state.activeCueId === id) state.activeCueId = state.cues.at(-1)?.id || '' }) }
export function clearDuplicate(id: string) { commit(state => { const cue = state.cues.find(item => item.id === id); if (cue) cue.duplicateOf = null }) }

/* ---------- 术语提醒（现场动作，取当前生效版本术语） ---------- */

export function sendReminder(termId: string, cueId: string) {
  commit(state => {
    const exists = state.reminders.some(item => item.termId === termId && item.cueId === cueId)
    if (exists) return
    state.reminders.unshift({
      id: `rem-${Date.now()}`, termId, cueId,
      target: state.terms.find(item => item.id === termId)?.target || '',
      createdAt: Date.now(), acknowledged: false
    })
  })
}
export function acknowledgeReminder(id: string) { commit(state => { const item = state.reminders.find(row => row.id === id); if (item) item.acknowledged = true }) }

export function speakerName(state: LiveState, id: string): string { return state.speakers.find(item => item.id === id)?.name || '未指定' }
export function termTarget(state: LiveState, id: string): string { return state.terms.find(item => item.id === id)?.target || '' }
export { getDelay }
