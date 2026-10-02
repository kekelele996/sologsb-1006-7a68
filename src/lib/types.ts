export type CueStatus = 'pending' | 'confirmed' | 'followup'
export type TabId = 'live' | 'agenda' | 'terms' | 'sync' | 'offline'

export interface Speaker {
  id: string
  name: string
  title: string
  language: string
  color: string
}

export interface Session {
  id: string
  order: number
  time: string
  title: string
  speakerId: string
  room: string
  status: 'upcoming' | 'live' | 'done'
}

export interface Term {
  id: string
  source: string
  target: string
  note: string
  speakerId: string
  priority: 'normal' | 'high'
}

export interface Announcement {
  id: string
  level: 'info' | 'warning' | 'urgent'
  text: string
  visibleOnStage: boolean
  createdAt: string
}

/** 中控工作内容：议程与术语表（发言人为议程附属资料，通知一并随版本下发） */
export interface ControlContent {
  speakers: Speaker[]
  sessions: Session[]
  terms: Term[]
  announcements: Announcement[]
}

/** 现场持有的、某次下发版本的完整快照 */
export interface ContentBundle extends ControlContent {
  version: number
  publishedAt: number
}

export type EntryKind = 'speaker' | 'session' | 'term' | 'announcement'

/** 下发通道中的最小对账单位：一条议程/术语/通知 */
export interface VersionEntry {
  version: number
  kind: EntryKind
  id: string
  /** kind 与 id 组成条目唯一键，回执按它对账 */
  uid: string
  data: Speaker | Session | Term | Announcement
}

/** 版本清单：随版本一起下发，告诉现场这版共有多少条要收 */
export interface VersionManifest {
  version: number
  publishedAt: number
  totalEntries: number
}

export type OutboxStatus = 'queued' | 'sent' | 'acked'

/** 中控发件箱：每个条目一条，独立回执 */
export interface OutboxRecord {
  uid: string
  version: number
  entry: VersionEntry
  manifest: boolean
  status: OutboxStatus
  sentAt: number | null
}

export interface ControlState {
  content: ControlContent
  /** 最近一次"下发新版本"后的工作副本基线，用来判断有没有未下发改动 */
  lastPublishedContent: ControlContent
  draftVersion: number
  outbox: OutboxRecord[]
}

export interface Cue {
  id: string
  speakerId: string
  text: string
  receivedAt: number
  status: CueStatus
  manual: boolean
  offline: boolean
  delaySeconds: number
  duplicateOf: string | null
  followupText: string
  /** 译法快照：进入队列/确认那一刻使用的术语译法，旧版本术语改动不会改写它 */
  tags: string[]
  /** 该条队列使用（冻结）的术语表版本号 */
  termsVersion: number
}

export interface Reminder {
  id: string
  termId: string
  cueId: string
  target: string
  createdAt: number
  acknowledged: boolean
}

export interface StagedManifest extends VersionManifest {
  receivedEntries: string[]
}

export interface SyncEvent {
  id: string
  at: number
  level: 'info' | 'success' | 'warning'
  message: string
}

export interface LiveState {
  /** 当前生效版本号；没收到新版本前一直保持 */
  activeVersion: number
  speakers: Speaker[]
  sessions: Session[]
  terms: Term[]
  announcements: Announcement[]
  publishedAt: number
  /** 已收到清单、但条目尚未集齐的版本（一次只可能有一个在途版本） */
  staging: StagedManifest | null
  /** 已到达但所属版本尚未激活的条目 */
  stagedEntries: VersionEntry[]
  cues: Cue[]
  reminders: Reminder[]
  activeCueId: string
  fontScale: number
  online: boolean
  liveSimulation: boolean
  syncLog: SyncEvent[]
}
