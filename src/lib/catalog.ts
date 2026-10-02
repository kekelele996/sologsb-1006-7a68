import type {
  Announcement, ContentBundle, ControlContent, Cue, EntryKind, Session, Speaker, Term, VersionEntry
} from './types'

export const INITIAL_VERSION = 1

export function seedSpeakers(): Speaker[] {
  return [
    { id: 'sp-1', name: 'Dr. Maya Chen', title: '首席气候科学家', language: '英语 → 中文', color: '#0f766e' },
    { id: 'sp-2', name: '刘启明', title: '城市韧性研究员', language: '中文 → 英语', color: '#b45309' },
    { id: 'sp-3', name: 'Prof. Daniel Ortiz', title: '公共卫生政策顾问', language: '西班牙语 → 中文', color: '#6d28d9' },
    { id: 'sp-4', name: '佐藤 美咲', title: '社区能源设计师', language: '日语 → 中文', color: '#be123c' }
  ]
}

export function seedSessions(): Session[] {
  return [
    { id: 'se-1', order: 1, time: '09:00', title: '开幕式与议程说明', speakerId: 'sp-2', room: '主会场 A', status: 'done' },
    { id: 'se-2', order: 2, time: '09:20', title: '城市热岛与适应性基础设施', speakerId: 'sp-1', room: '主会场 A', status: 'live' },
    { id: 'se-3', order: 3, time: '10:05', title: '社区健康数据的地方行动', speakerId: 'sp-3', room: '主会场 A', status: 'upcoming' },
    { id: 'se-4', order: 4, time: '10:45', title: '分布式能源与社区共治', speakerId: 'sp-4', room: '主会场 A', status: 'upcoming' }
  ]
}

export function seedTerms(): Term[] {
  return [
    { id: 'term-1', source: 'urban heat island', target: '城市热岛', note: '首次出现完整译出，后可简称热岛', speakerId: 'sp-1', priority: 'high' },
    { id: 'term-2', source: 'resilience', target: '韧性', note: '不使用“恢复力”', speakerId: 'sp-1', priority: 'high' },
    { id: 'term-3', source: 'co-benefit', target: '协同效益', note: '环境与健康共同收益', speakerId: 'sp-1', priority: 'normal' },
    { id: 'term-4', source: 'distributed energy resource', target: '分布式能源资源', note: '缩写 DER', speakerId: 'sp-4', priority: 'high' },
    { id: 'term-5', source: 'health equity', target: '健康公平', note: '不译为健康平等', speakerId: 'sp-3', priority: 'high' }
  ]
}

export function seedAnnouncements(): Announcement[] {
  const now = new Date().toISOString()
  return [
    { id: 'ann-1', level: 'info', text: '十点整有消防联动测试，请提醒会场人员保持镇定。', visibleOnStage: false, createdAt: now },
    { id: 'ann-2', level: 'urgent', text: '请下一位发言人提前到侧台候场。', visibleOnStage: false, createdAt: now }
  ]
}

export function seedContent(): ControlContent {
  return { speakers: seedSpeakers(), sessions: seedSessions(), terms: seedTerms(), announcements: seedAnnouncements() }
}

export function clone<T>(value: T): T { return structuredClone(value) }

export function entryUid(kind: EntryKind, id: string): string {
  return `${kind}:${id}`
}

/** 把某一版工作内容拆成可逐条下发、逐条回执的条目 */
export function snapshotEntries(version: number, content: ControlContent): VersionEntry[] {
  const make = (kind: EntryKind, rows: Array<Speaker | Session | Term | Announcement>): VersionEntry[] =>
    rows.map(row => ({ version, kind, id: row.id, uid: entryUid(kind, row.id), data: clone(row) }))
  return [
    ...make('speaker', content.speakers),
    ...make('session', content.sessions),
    ...make('term', content.terms),
    ...make('announcement', content.announcements)
  ]
}

/** 现场按清单集齐条目后，重组成完整版本快照 */
export function assembleBundle(version: number, publishedAt: number, entries: VersionEntry[]): ContentBundle {
  const pick = <T>(kind: EntryKind): T[] =>
    entries.filter(entry => entry.kind === kind).map(entry => clone(entry.data)) as T[]
  return {
    version,
    publishedAt,
    speakers: pick<Speaker>('speaker'),
    sessions: pick<Session>('session'),
    terms: pick<Term>('term'),
    announcements: pick<Announcement>('announcement')
  }
}

/** 深比较：判断中控工作副本与上次下发是否一致（有未下发改动） */
export function sameContent(a: ControlContent, b: ControlContent): boolean {
  return JSON.stringify(a) === JSON.stringify(b)
}

export function detectTerms(text: string, terms: Term[]): string[] {
  const lower = text.toLowerCase()
  const tags: string[] = []
  for (const term of terms) {
    if ((lower.includes(term.source.toLowerCase()) || lower.includes(term.target)) && !tags.includes(term.target)) {
      tags.push(term.target)
    }
  }
  return tags
}

export function findDuplicate(text: string, cues: Cue[]): Cue | undefined {
  return cues.find(cue => similarity(text, cue.text) >= 0.72)
}

function similarity(a: string, b: string): number {
  const grams = (value: string) => {
    const clean = value.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '')
    return new Set(Array.from({ length: Math.max(0, clean.length - 1) }, (_, index) => clean.slice(index, index + 2)))
  }
  const left = grams(a), right = grams(b)
  if (!left.size || !right.size) return a.trim() === b.trim() ? 1 : 0
  let intersection = 0
  left.forEach(item => { if (right.has(item)) intersection++ })
  return intersection / (left.size + right.size - intersection)
}

export function getDelay(cue: Cue, now = Date.now()): number {
  return Math.max(cue.delaySeconds, Math.round((now - cue.receivedAt) / 1000))
}

export function seedCues(version: number): Cue[] {
  const now = Date.now()
  const rows: Array<[string, number, Cue['status'], number, string, string[]]> = [
    ['cue-101', 36000, 'confirmed', 4, '', ['城市热岛']],
    ['cue-102', 19000, 'confirmed', 6, '补译：“夜间温差可达数摄氏度。”', ['树冠覆盖率']],
    ['cue-103', 9000, 'pending', 11, '', ['韧性', '协同效益']],
    ['cue-104', 2500, 'pending', 4, '', ['健康公平']]
  ]
  const texts: Record<string, string> = {
    'cue-101': 'The urban heat island effect is not evenly distributed across a city.',
    'cue-102': 'Neighborhoods with less tree canopy can be several degrees warmer at night.',
    'cue-103': 'Our resilience strategy links cooling corridors with public health investments.',
    'cue-104': 'That data also reveals health equity gaps between districts.'
  }
  return rows.map(([id, ago, status, delay, followupText, tags]) => ({
    id, speakerId: 'sp-1', text: texts[id], receivedAt: now - ago, status,
    manual: false, offline: false, delaySeconds: delay, duplicateOf: null,
    followupText,
    // 标签是当时那版译法的快照，原样冻结
    tags, termsVersion: version
  }))
}
