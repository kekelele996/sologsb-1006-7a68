import { writable, get } from 'svelte/store'
import { online } from './netStore'
import { seedAnnouncements, seedCues, seedSessions, seedSpeakers, seedTerms } from './seed'
import type { Announcement, Cue, Receipt, Reminder, SiteState, VersionEntry, VersionSnapshot } from './types'
import { clone, detectTerms, findDuplicate } from './utils'

const STORAGE_KEY = 'conference-cue-desk-site-v2'

function initialState(): SiteState {
  return {
    cues: seedCues(),
    reminders: [],
    announcements: seedAnnouncements(),
    activeCueId: 'cue-103',
    fontScale: 100,
    liveSimulation: true,
    appliedVersion: 1,
    bufferedVersion: null,
    bufferedSnapshot: null,
    partialVersion: null,
    partialReceived: 0,
    partialTotal: 0,
    appliedTerms: clone(seedTerms),
    appliedSpeakers: clone(seedSpeakers),
    appliedSessions: clone(seedSessions),
    receipts: [],
    updatedAt: new Date().toISOString()
  }
}

function loadState(): SiteState {
  if (typeof localStorage === 'undefined') return initialState()
  try {
    const saved = localStorage.getItem(STORAGE_KEY)
    if (!saved) return initialState()
    return { ...initialState(), ...JSON.parse(saved) }
  } catch {
    return initialState()
  }
}

export const siteStore = writable<SiteState>(loadState())

function persist(state: SiteState) {
  state.updatedAt = new Date().toISOString()
  if (typeof localStorage !== 'undefined') localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
}
function commit(recipe: (state: SiteState) => void) {
  const next = clone(get(siteStore))
  recipe(next)
  persist(next)
  siteStore.set(next)
}

/* ------------------------------- 版本下发接收 ------------------------------- */

/** 中控逐条下发：现场收到一条就记一条回执；用于断网时展示“已收到 X/Y 条”。 */
export function receiveEntry(versionNumber: number, entry: VersionEntry, total: number) {
  commit(state => {
    const already = state.receipts.some(r => r.versionNumber === versionNumber && r.termId === entry.termId)
    if (!already) state.receipts.push({ versionNumber, termId: entry.termId, receivedAt: Date.now() })
    // 仅记录进度，不切换版本（没收到完整版本照旧版继续）。
    if (state.bufferedVersion !== versionNumber) {
      state.partialVersion = versionNumber
      state.partialTotal = total
    }
    state.partialReceived = state.receipts.filter(r => r.versionNumber === versionNumber).length
  })
}

/** 中控下发完成：完整版本到达，进入待切换缓冲（现场收到才切换）。 */
export function receiveVersionComplete(versionNumber: number, snapshot: VersionSnapshot) {
  commit(state => {
    state.bufferedVersion = versionNumber
    state.bufferedSnapshot = clone(snapshot)
    state.partialVersion = null
    state.partialReceived = 0
    state.partialTotal = 0
  })
}

/** 现场切换到已送达的新版本：只有未确认条目按新术语表重算译法，已确认上屏条目冻结。 */
export function applyBufferedVersion() {
  commit(state => {
    if (state.bufferedVersion == null || !state.bufferedSnapshot) return
    const versionNumber = state.bufferedVersion
    const terms = clone(state.bufferedSnapshot.terms)
    state.cues.forEach(cue => {
      if (cue.status === 'confirmed') return // 上屏段落留当时那版译法，不随新版本变
      cue.tags = detectTerms(cue.text, terms)
      cue.glossaryVersion = versionNumber
    })
    state.appliedVersion = versionNumber
    state.appliedTerms = terms
    state.appliedSpeakers = clone(state.bufferedSnapshot.speakers)
    state.appliedSessions = clone(state.bufferedSnapshot.sessions)
    state.bufferedVersion = null
    state.bufferedSnapshot = null
  })
}

/** 现场选择稍后切换：继续沿用旧版本（中控可在对账后重新下发）。 */
export function dismissBufferedVersion() {
  commit(state => {
    state.bufferedVersion = null
    state.bufferedSnapshot = null
  })
}

/* --------------------------------- 队列操作 --------------------------------- */

export function setActiveCue(id: string) {
  commit(state => { state.activeCueId = id })
}
export function moveCue(direction: 1 | -1) {
  const state = get(siteStore)
  const index = state.cues.findIndex(item => item.id === state.activeCueId)
  const next = state.cues[index + direction]
  if (next) setActiveCue(next.id)
}
export function setFontScale(scale: number) {
  commit(state => { state.fontScale = Math.min(150, Math.max(85, scale)) })
}
export function setLiveSimulation(enabled: boolean) {
  commit(state => { state.liveSimulation = enabled })
}

export function ingestCue(text: string, options: { manual?: boolean; speakerId?: string; receivedAt?: number } = {}) {
  const trimmed = text.trim()
  if (!trimmed) return
  commit(state => {
    const existing = state.cues.filter(item => item.text !== trimmed)
    const duplicate = findDuplicate(trimmed, existing)
    const speakerId = options.speakerId || state.appliedSessions.find(item => item.status === 'live')?.speakerId || state.appliedSpeakers[0]?.id || ''
    const receivedAt = options.receivedAt || Date.now()
    const cue: Cue = {
      id: `cue-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      speakerId,
      text: trimmed,
      receivedAt,
      status: 'pending',
      manual: Boolean(options.manual),
      offline: !get(online),
      delaySeconds: Math.max(0, Math.round((Date.now() - receivedAt) / 1000)),
      duplicateOf: duplicate?.id || null,
      followupText: '',
      tags: detectTerms(trimmed, state.appliedTerms),
      glossaryVersion: state.appliedVersion
    }
    state.cues.push(cue)
    state.activeCueId = cue.id
  })
}

export function updateCue(id: string, patch: Partial<Cue>) {
  commit(state => {
    const cue = state.cues.find(item => item.id === id)
    if (cue) Object.assign(cue, patch)
  })
}

export function setCueStatus(id: string, status: Cue['status']) {
  commit(state => {
    const cue = state.cues.find(item => item.id === id)
    if (cue) cue.status = status
  })
}

export function deleteCue(id: string) {
  commit(state => {
    state.cues = state.cues.filter(item => item.id !== id)
    if (state.activeCueId === id) state.activeCueId = state.cues.at(-1)?.id || ''
  })
}

export function clearDuplicate(id: string) {
  commit(state => {
    const cue = state.cues.find(item => item.id === id)
    if (cue) cue.duplicateOf = null
  })
}

/* --------------------------------- 术语提醒 --------------------------------- */

export function sendReminder(termId: string, cueId: string) {
  commit(state => {
    const exists = state.reminders.some(item => item.termId === termId && item.cueId === cueId)
    if (exists) return
    state.reminders.unshift({
      id: `rem-${Date.now()}`,
      termId,
      cueId,
      target: state.appliedTerms.find(item => item.id === termId)?.target || '',
      createdAt: Date.now(),
      acknowledged: false
    })
  })
}

export function acknowledgeReminder(id: string) {
  commit(state => {
    const item = state.reminders.find(row => row.id === id)
    if (item) item.acknowledged = true
  })
}

/* --------------------------------- 紧急通知 --------------------------------- */

export function addAnnouncement(text: string, level: Announcement['level']) {
  if (!text.trim()) return
  commit(state => {
    state.announcements.unshift({
      id: `ann-${Date.now()}`,
      level,
      text: text.trim(),
      visibleOnStage: false,
      createdAt: new Date().toISOString()
    })
  })
}

export function publishAnnouncement(id: string, visible: boolean) {
  commit(state => {
    const item = state.announcements.find(row => row.id === id)
    if (item) item.visibleOnStage = visible
  })
}

/* --------------------------------- 离线合并 --------------------------------- */

function mergeOfflineCues(state: SiteState) {
  state.cues.forEach(cue => {
    if (!cue.offline) return
    cue.offline = false
    const duplicate = findDuplicate(cue.text, state.cues.filter(item => item.id !== cue.id && !item.offline))
    cue.duplicateOf = duplicate?.id || null
  })
}

// 恢复在线：合并离线暂存（中控侧的补下发由 controlStore 订阅 online 触发）。
online.subscribe(value => {
  if (!value) return
  const state = get(siteStore)
  if (!state.cues.some(cue => cue.offline)) return
  commit(mergeOfflineCues)
})

export function getDelay(cue: Cue, now = Date.now()): number {
  return Math.max(cue.delaySeconds, Math.round((now - cue.receivedAt) / 1000))
}
