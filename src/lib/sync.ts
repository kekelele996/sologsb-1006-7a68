import { get } from 'svelte/store'
import type { OutboxRecord, VersionEntry, VersionManifest } from './types'
import { live, receiveEntries, receiveManifest, setOnline as setLiveOnline, appendLog } from './live'
import { acknowledgeDelivery, control, markSent, pendingOutbox, requeueUnacked } from './control'

const TICK_MS = 750
const BATCH_SIZE = 2

let timer: ReturnType<typeof setInterval> | null = null
let wasOnline = get(live).online
/** 已经播报过"整版送达"的版本 */
const fullyAnnounced = new Set<number>([1])
/** 上一拍已送达、等待本拍回执销账的 uid；断网时这批回执视为丢失 */
let pendingAcks: string[] = []

export function startSyncEngine() {
  if (timer || typeof setInterval === 'undefined') return
  wasOnline = get(live).online
  timer = setInterval(tick, TICK_MS)
}

export function stopSyncEngine() {
  if (timer) { clearInterval(timer); timer = null }
}

/** 手动切换网络（演示断网/恢复） */
export function setNetworkOnline(online: boolean) {
  setLiveOnline(online)
  if (!online) {
    appendLog('warning', '网络中断：现场继续按当前版本工作，队列与上屏不受影响。')
  } else {
    appendLog('info', '网络恢复：开始按回执对账，只补发未同步的条目。')
    reconcile()
  }
}

/**
 * 恢复联网后的对账：
 * sent 但没有回执的条目退回待发，引擎随后只补这些 uid；
 * 已确认的现场内容不在发件箱里，不会重发。
 */
export function reconcile() {
  // 未完成往返的回执作废：这些记录要作为"未同步"重新补发
  pendingAcks = []
  const activeVersion = get(live).activeVersion
  const requeued = requeueUnacked(activeVersion)
  const byVersion = new Map<number, number>()
  // 只汇报现场下一个待收版本；更高版本必须等这版收齐
  for (const record of requeued.filter(record => record.version === activeVersion + 1)) {
    byVersion.set(record.version, (byVersion.get(record.version) || 0) + 1)
  }
  for (const [version, count] of byVersion) {
    appendLog('info', `对账：第 ${version} 版还差 ${count} 条未同步，仅补发这些条目。`)
  }
  if (!requeued.length) appendLog('success', '对账完成：所有下发条目均已同步，无需补发。')
}

function tick() {
  const online = get(live).online
  if (online !== wasOnline) {
    if (wasOnline && !online) appendLog('warning', '网络中断：现场继续按当前版本工作，队列与上屏不受影响。')
    if (!wasOnline && online) { appendLog('info', '网络恢复：开始按回执对账，只补发未同步的条目。'); reconcile() }
    wasOnline = online
  }
  if (!online) return

  // 1) 先销账上一拍的回执；若上一拍之后断网，pendingAcks 里的记录仍是 sent，恢复后由 reconcile 退回
  if (pendingAcks.length) {
    acknowledgeDelivery(pendingAcks)
    pendingAcks = []
  }

  // 2) 发新的一批（清单必须先单独送达，现场据此建立暂存区）
  const allPending = pendingOutbox(BATCH_SIZE + 1, get(live).activeVersion)
  const manifestRecord = allPending.find(record => record.manifest)
  const batch = manifestRecord
    ? [manifestRecord]
    : allPending.slice(0, BATCH_SIZE)
  if (!batch.length) return

  const now = Date.now()
  const manifests: VersionManifest[] = []
  const entries: VersionEntry[] = []
  for (const record of batch) {
    if (record.manifest) {
      const totalEntries = get(control).outbox
        .filter((item: OutboxRecord) => item.version === record.version && !item.manifest).length
      manifests.push({ version: record.version, publishedAt: now, totalEntries })
    } else {
      entries.push(record.entry)
    }
  }

  for (const manifest of manifests) receiveManifest(manifest)
  const { ackUids: entryAcks, applied } = receiveEntries(entries)
  markSent(batch.map(record => record.uid), now)
  // 清单与条目一样要回执销账；下一拍才处理，模拟网络往返
  const manifestAcks = batch.filter(record => record.manifest).map(record => record.uid)
  pendingAcks = [...manifestAcks, ...entryAcks]

  if (applied && !fullyAnnounced.has(applied.version)) {
    fullyAnnounced.add(applied.version)
    appendLog('success', `第 ${applied.version} 版全部条目收齐并启用（议程 ${applied.sessions.length} 条 · 术语 ${applied.terms.length} 条）；已确认上屏段落仍保持旧版译法。`)
  }
}

export function deliveryStats(version: number) {
  const records = get(control).outbox.filter(record => record.version === version && !record.manifest)
  return {
    total: records.length,
    acked: records.filter(record => record.status === 'acked').length,
    sent: records.filter(record => record.status === 'sent').length,
    queued: records.filter(record => record.status === 'queued').length
  }
}

export function hasPendingDelivery(): boolean {
  const activeVersion = get(live).activeVersion
  return get(control).outbox.some(record => record.version > activeVersion && record.status !== 'acked')
}
