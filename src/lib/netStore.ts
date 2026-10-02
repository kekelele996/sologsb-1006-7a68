import { writable } from 'svelte/store'

/**
 * 共享网络状态。中控与现场各自订阅：
 * - 现场恢复在线时合并离线暂存；
 * - 中控恢复在线时按回执对账、补下发未同步条目。
 */
export const online = writable(true)

export function setOnline(value: boolean) {
  online.set(value)
}
