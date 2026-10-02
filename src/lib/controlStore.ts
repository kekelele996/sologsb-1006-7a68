import { writable, get } from 'svelte/store'
import { online } from './netStore'
import { siteStore, receiveEntry, receiveVersionComplete } from './siteStore'
import { seedSessions, seedSpeakers, seedTerms } from './seed'
import type { ControlState, GlossaryVersion, Session, Speaker, Term, VersionEntry } from './types'
import { clone } from './utils'

const STORAGE_KEY = 'conference-cue-desk-control-v2'

function initialState(): ControlState {
  return {
    speakers: clone(seedSpeakers),
    sessions: clone(seedSessions),
    terms: clone(seedTerms),
    versions: [],
    updatedAt: new Date().toISOString()
  }
}

function loadState(): ControlState {
  if (typeof localStorage === 'undefined') return initialState()
  try {
    const saved = localStorage.getItem(STORAGE_KEY)
    return saved ? { ...initialState(), ...JSON.parse(saved) } : initialState()
  } catch {
    return initialState()
  }
}

export const controlStore = writable<ControlState>(loadState())

function persist(state: ControlState) {
  state.updatedAt = new Date().toISOString()
  if (typeof localStorage !== 'undefined') localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
}
function commit(recipe: (state: ControlState) => void) {
  const next = clone(get(controlStore))
  recipe(next)
  persist(next)
  controlStore.set(next)
}

/* ------------------------------- 议程与术语表编辑 ------------------------------- */

export function addSpeaker() {
  commit(state => {
    state.speakers.push({ id: `sp-${Date.now()}`, name: '新发言人', title: '待填写机构与职务', language: '待设置语言方向', color: '#475569' })
  })
}
export function updateSpeaker(id: string, patch: Partial<Speaker>) {
  commit(state => {
    const item = state.speakers.find(row => row.id === id)
    if (item) Object.assign(item, patch)
  })
}
export function addSession() {
  commit(state => {
    state.sessions.push({
      id: `se-${Date.now()}`,
      order: Math.max(0, ...state.sessions.map(item => item.order)) + 1,
      time: '11:30',
      title: '新演讲',
      speakerId: state.speakers[0]?.id || '',
      room: '主会场 A',
      status: 'upcoming'
    })
  })
}
export function updateSession(id: string, patch: Partial<Session>) {
  commit(state => {
    const item = state.sessions.find(row => row.id === id)
    if (item) Object.assign(item, patch)
  })
}
export function addTerm() {
  commit(state => {
    state.terms.push({ id: `term-${Date.now()}`, source: 'new term', target: '新术语', note: '', speakerId: state.speakers[0]?.id || '', priority: 'normal' })
  })
}
export function updateTerm(id: string, patch: Partial<Term>) {
  commit(state => {
    const item = state.terms.find(row => row.id === id)
    if (item) Object.assign(item, patch)
  })
}

/* --------------------------------- 版本下发 --------------------------------- */

let pushTimer: ReturnType<typeof setInterval> | null = null
const PUSH_INTERVAL_MS = 700

function stopPush() {
  if (pushTimer) {
    clearInterval(pushTimer)
    pushTimer = null
  }
}

/** 逐条下发：在线时每 700ms 送达一条；断网则挂起为 partial，现场照旧版干活。 */
function tickPush() {
  if (!get(online)) {
    commit(state => {
      state.versions.forEach(v => { if (v.status === 'pushing') v.status = 'partial' })
    })
    stopPush()
    return
  }
  const state = get(controlStore)
  const version = state.versions.find(v => v.status === 'pushing' || v.status === 'partial')
  if (!version) { stopPush(); return }
  if (version.status === 'partial') {
    commit(c => { const v = c.versions.find(x => x.id === version.id); if (v) v.status = 'pushing' })
  }
  const entry = version.entries.find(e => !e.delivered)
  if (!entry) {
    // 全部条目都有回执：版本送达，现场可切换。
    commit(c => { const v = c.versions.find(x => x.id === version.id); if (v) v.status = 'delivered' })
    receiveVersionComplete(version.number, version.snapshot)
    if (!get(controlStore).versions.some(v => v.status === 'pushing' || v.status === 'partial')) stopPush()
    return
  }
  // 送达这一条（现场记回执）；已回执的条目不会重复下发。
  commit(c => {
    const v = c.versions.find(x => x.id === version.id)
    if (!v) return
    const target = v.entries.find(x => x.termId === entry.termId)
    if (target) target.delivered = true
  })
  const delivered: VersionEntry = { ...entry, delivered: true }
  receiveEntry(version.number, delivered, version.entries.length)
}

function runPush() {
  if (pushTimer) return
  pushTimer = setInterval(tickPush, PUSH_INTERVAL_MS)
  tickPush()
}

/** 中控改完术语表后下发新版本。种子术语表为 v1，首次下发为 v2。 */
export function publishVersion() {
  const state = get(controlStore)
  const maxNumber = state.versions.reduce((max, v) => Math.max(max, v.number), 1)
  const number = maxNumber + 1
  const terms = clone(state.terms)
  const version: GlossaryVersion = {
    id: `gv-${Date.now()}`,
    number,
    publishedAt: new Date().toISOString(),
    status: get(online) ? 'pushing' : 'partial',
    entries: terms.map(t => ({
      termId: t.id,
      source: t.source,
      target: t.target,
      note: t.note,
      speakerId: t.speakerId,
      priority: t.priority,
      delivered: false
    })),
    snapshot: { terms, sessions: clone(state.sessions), speakers: clone(state.speakers) }
  }
  commit(c => { c.versions.unshift(version) })
  runPush()
}

/**
 * 恢复后按回执对账：只补下发没有回执（没同步上）的条目，
 * 已回执（现场已确认收到）的内容不再重复下发。
 */
export function reconcile(versionId?: string) {
  if (!get(online)) return
  commit(state => {
    const targets = versionId
      ? state.versions.filter(v => v.id === versionId)
      : state.versions.filter(v => v.status === 'partial')
    targets.forEach(v => {
      const hasPending = v.entries.some(e => !e.delivered)
      v.status = hasPending ? 'pushing' : 'delivered'
    })
  })
  runPush()
}

// 网络恢复：自动对账，补下发所有未同步条目。
online.subscribe(value => {
  if (value) reconcile()
})
