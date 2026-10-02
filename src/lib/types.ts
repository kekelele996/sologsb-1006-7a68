export type CueStatus = 'pending' | 'confirmed' | 'followup'
export type TabId = 'live' | 'control' | 'offline'
export type TermPriority = 'normal' | 'high'

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
  priority: TermPriority
}

export interface Announcement {
  id: string
  level: 'info' | 'warning' | 'urgent'
  text: string
  visibleOnStage: boolean
  createdAt: string
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
  tags: string[]
  /** 该条目译法所归属的术语表版本；已确认上屏后冻结，不随新版本变化。 */
  glossaryVersion: number
}

export interface Reminder {
  id: string
  termId: string
  cueId: string
  target: string
  createdAt: number
  acknowledged: boolean
}

/** 一个可下发的术语表条目（带现场回执状态）。 */
export interface VersionEntry {
  termId: string
  source: string
  target: string
  note: string
  speakerId: string
  priority: TermPriority
  /** 现场已收到并回执 = 已确认同步。 */
  delivered: boolean
}

export interface VersionSnapshot {
  terms: Term[]
  sessions: Session[]
  speakers: Speaker[]
}

export type VersionStatus = 'pushing' | 'delivered' | 'partial'

/** 中控下发的一个术语表版本。 */
export interface GlossaryVersion {
  id: string
  number: number
  publishedAt: string
  status: VersionStatus
  entries: VersionEntry[]
  snapshot: VersionSnapshot
}

/** 现场回执：某版本的某条目已收到。 */
export interface Receipt {
  versionNumber: number
  termId: string
  receivedAt: number
}

/** 现场工作内容：队列、上屏、提醒、当前应用的术语表版本。 */
export interface SiteState {
  cues: Cue[]
  reminders: Reminder[]
  announcements: Announcement[]
  activeCueId: string
  fontScale: number
  liveSimulation: boolean
  /** 现场当前实际在用的术语表版本。 */
  appliedVersion: number
  /** 已完整送达、等待现场切换的新版本号；null 表示没有待切换版本。 */
  bufferedVersion: number | null
  bufferedSnapshot: VersionSnapshot | null
  /** 下发中断网时，已收到一部分的版本（现场不切换，照旧版）。 */
  partialVersion: number | null
  partialReceived: number
  partialTotal: number
  /** 现场已应用版本的术语表（现场只看自己这版）。 */
  appliedTerms: Term[]
  appliedSpeakers: Speaker[]
  appliedSessions: Session[]
  receipts: Receipt[]
  updatedAt: string
}

/** 中控工作内容：议程与术语表草稿 + 下发版本记录。 */
export interface ControlState {
  speakers: Speaker[]
  sessions: Session[]
  terms: Term[]
  versions: GlossaryVersion[]
  updatedAt: string
}
