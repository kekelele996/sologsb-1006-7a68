import { writable, get } from 'svelte/store'
import type { Announcement, ControlContent, ControlState, OutboxRecord, Session, Speaker, Term, VersionEntry } from './types'
import { clone, entryUid, INITIAL_VERSION, sameContent, seedContent, snapshotEntries } from './catalog'

const STORAGE_KEY = 'conference-control-v1'

function freshState(): ControlState {
  const content = seedContent()
  const entries = snapshotEntries(INITIAL_VERSION, content)
  // 初始版本视为已全部送达并拿到回执
  const outbox: OutboxRecord[] = [
    { uid: `v${INITIAL_VERSION}:manifest`, version: INITIAL_VERSION, entry: null as unknown as VersionEntry, manifest: true, status: 'acked', sentAt: null },
    ...entries.map(entry => ({ uid: `v${INITIAL_VERSION}:${entry.uid}`, version: INITIAL_VERSION, entry, manifest: false, status: 'acked' as const, sentAt: null }))
  ]
  return { content, lastPublishedContent: clone(content), draftVersion: INITIAL_VERSION, outbox }
}

function loadState(): ControlState {
  if (typeof localStorage === 'undefined') return freshState()
  try {
    const saved = localStorage.getItem(STORAGE_KEY)
    return saved ? { ...freshState(), ...JSON.parse(saved) } : freshState()
  } catch {
    return freshState()
  }
}

const history: ControlState[] = []
const future: ControlState[] = []
export const control = writable<ControlState>(loadState())

function persist(state: ControlState) {
  if (typeof localStorage !== 'undefined') localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
}

function commit(recipe: (state: ControlState) => void, options: { history?: boolean } = { history: true }) {
  const current = clone(get(control))
  const next = clone(current)
  recipe(next)
  if (options.history !== false) {
    history.push(current)
    if (history.length > 60) history.shift()
    future.length = 0
  }
  persist(next)
  control.set(next)
}

export function controlUndo() {
  const previous = history.pop()
  if (!previous) return
  future.push(clone(get(control)))
  persist(previous); control.set(previous)
}
export function controlRedo() {
  const next = future.pop()
  if (!next) return
  history.push(clone(get(control)))
  persist(next); control.set(next)
}
export const canControlUndo = () => history.length > 0
export const canControlRedo = () => future.length > 0

export const hasUnpublishedChanges = (state: ControlState): boolean =>
  !sameContent(state.content, state.lastPublishedContent)

/* ---------- 议程 / 发言人 ---------- */

export function addSpeaker() {
  commit(state => state.content.speakers.push({ id: `sp-${Date.now()}`, name: '新发言人', title: '待填写机构与职务', language: '待设置语言方向', color: '#475569' }))
}
export function updateSpeaker(id: string, patch: Partial<Speaker>) {
  commit(state => { const item = state.content.speakers.find(row => row.id === id); if (item) Object.assign(item, patch) })
}
export function addSession() {
  commit(state => state.content.sessions.push({
    id: `se-${Date.now()}`, order: Math.max(0, ...state.content.sessions.map(item => item.order)) + 1,
    time: '11:30', title: '新演讲', speakerId: state.content.speakers[0]?.id || '', room: '主会场 A', status: 'upcoming'
  }))
}
export function updateSession(id: string, patch: Partial<Session>) {
  commit(state => { const item = state.content.sessions.find(row => row.id === id); if (item) Object.assign(item, patch) })
}

/* ---------- 术语表 ---------- */

export function addTerm() {
  commit(state => state.content.terms.push({ id: `term-${Date.now()}`, source: 'new term', target: '新术语', note: '', speakerId: state.content.speakers[0]?.id || '', priority: 'normal' }))
}
export function updateTerm(id: string, patch: Partial<Term>) {
  commit(state => { const item = state.content.terms.find(row => row.id === id); if (item) Object.assign(item, patch) })
}

/* ---------- 紧急通知 ---------- */

export function addAnnouncement(text: string, level: Announcement['level']) {
  if (!text.trim()) return
  commit(state => state.content.announcements.unshift({ id: `ann-${Date.now()}`, level, text: text.trim(), visibleOnStage: false, createdAt: new Date().toISOString() }))
}
/** 改"是否上屏"同样只改中控工作副本，下次下发才到现场 */
export function publishAnnouncement(id: string, visible: boolean) {
  commit(state => { const item = state.content.announcements.find(row => row.id === id); if (item) item.visibleOnStage = visible })
}

/* ---------- 版本下发 ---------- */

/**
 * 中控把当前工作内容封成新版本，逐条放进发件箱等待同步引擎发送。
 * 已确认的现场内容不属于新版本，发件箱只承载议程/术语/通知条目。
 */
export function publishVersion(): number | null {
  const state = get(control)
  if (!hasUnpublishedChanges(state)) return null
  const version = state.draftVersion + 1
  const entries = snapshotEntries(version, state.content)
  const records: OutboxRecord[] = [
    { uid: `v${version}:manifest`, version, entry: null as unknown as VersionEntry, manifest: true, status: 'queued', sentAt: null },
    ...entries.map(entry => ({ uid: `v${version}:${entry.uid}`, version, entry, manifest: false, status: 'queued' as const, sentAt: null }))
  ]
  commit(next => {
    next.draftVersion = version
    next.lastPublishedContent = clone(next.content)
    next.outbox.push(...records)
  })
  return version
}

/* ---------- 同步引擎使用的底层接口（不进撤销栈） ---------- */

/** 取出下一批待发送的记录；严格按版本顺序，现场未收齐 vN 时不发 v(N+1) */
export function pendingOutbox(limit: number, activeVersion: number): OutboxRecord[] {
  const targetVersion = activeVersion + 1
  return get(control).outbox
    .filter(record => record.version === targetVersion && record.status !== 'acked')
    .sort((a, b) => Number(b.manifest) - Number(a.manifest) || a.uid.localeCompare(b.uid))
    .slice(0, limit)
}

export function markSent(uids: string[], at: number) {
  if (!uids.length) return
  commit(state => {
    for (const record of state.outbox) {
      if (uids.includes(record.uid) && record.status === 'queued') {
        record.status = 'sent'; record.sentAt = at
      }
    }
  }, { history: false })
}

/** 现场回执：按 uid 逐条销账 */
export function acknowledgeDelivery(uids: string[]) {
  if (!uids.length) return
  commit(state => {
    for (const record of state.outbox) {
      if (uids.includes(record.uid)) record.status = 'acked'
    }
  }, { history: false })
}

/** 恢复联网后的对账：sent 但没收到回执的记录退回 queued，只补这些条目 */
export function requeueUnacked(maxVersion: number): OutboxRecord[] {
  let requeued: OutboxRecord[] = []
  commit(state => {
    for (const record of state.outbox) {
      if (record.version <= maxVersion) continue
      if (record.status === 'sent') record.status = 'queued'
    }
    requeued = state.outbox.filter(record => record.version > maxVersion && record.status === 'queued')
  }, { history: false })
  return clone(requeued)
}

export { entryUid }
