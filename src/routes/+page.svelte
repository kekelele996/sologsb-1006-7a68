<script lang="ts">
  import { onMount } from 'svelte'
  import Button from 'flowbite-svelte/Button.svelte'
  import SiteTab from '$lib/components/SiteTab.svelte'
  import ControlTab from '$lib/components/ControlTab.svelte'
  import OfflineTab from '$lib/components/OfflineTab.svelte'
  import { online, setOnline } from '$lib/netStore'
  import {
    moveCue, sendReminder, setCueStatus, setFontScale, siteStore
  } from '$lib/siteStore'
  import type { TabId } from '$lib/types'

  let tab: TabId = 'live'
  let showHelp = false

  $: site = $siteStore
  $: pendingCount = site.cues.filter(item => item.status === 'pending').length
  $: offlineCount = site.cues.filter(item => item.offline).length
  $: activeCue = site.cues.find(item => item.id === site.activeCueId) || site.cues.at(-1)

  onMount(() => {
    if (typeof navigator !== 'undefined') setOnline(navigator.onLine)
    const onlineHandler = () => setOnline(true)
    const offlineHandler = () => setOnline(false)
    window.addEventListener('online', onlineHandler)
    window.addEventListener('offline', offlineHandler)
    window.addEventListener('keydown', handleKeyboard)
    return () => {
      window.removeEventListener('online', onlineHandler)
      window.removeEventListener('offline', offlineHandler)
      window.removeEventListener('keydown', handleKeyboard)
    }
  })

  function confirmActive() {
    if (!activeCue) return
    setCueStatus(activeCue.id, 'confirmed')
    moveCue(1)
  }
  function focusManual() {
    window.dispatchEvent(new CustomEvent('site:focus-manual'))
  }
  function sendTopReminder() {
    const current = $siteStore
    const cue = current.cues.find(item => item.id === current.activeCueId) || current.cues.at(-1)
    if (!cue) return
    const term = current.appliedTerms.find(t => t.priority === 'high' && (t.speakerId === cue.speakerId || cue.tags.includes(t.target)))
    if (term) sendReminder(term.id, cue.id)
  }

  function handleKeyboard(event: KeyboardEvent) {
    const target = event.target as HTMLElement
    if (['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)) return
    if (event.key === 'j' || event.key === 'ArrowDown') { event.preventDefault(); moveCue(1) }
    if (event.key === 'k' || event.key === 'ArrowUp') { event.preventDefault(); moveCue(-1) }
    if (event.key.toLowerCase() === 'c') { event.preventDefault(); confirmActive() }
    if (event.key.toLowerCase() === 'n') { event.preventDefault(); focusManual() }
    if (event.key.toLowerCase() === 't') { event.preventDefault(); sendTopReminder() }
    if (event.key === '?') { event.preventDefault(); showHelp = true }
    if (event.key === '+' || event.key === '=') setFontScale($siteStore.fontScale + 5)
    if (event.key === '-') setFontScale($siteStore.fontScale - 5)
  }
</script>

<svelte:head><title>会议同传提示台 · Live Cue Desk</title></svelte:head>

<a class="fixed left-2 top-2 z-[100] -translate-y-20 rounded-lg bg-white px-4 py-2 font-bold shadow focus:translate-y-0" href="#main">跳到主要内容</a>

<div class="min-h-full bg-paper text-ink" style={`font-size:${site.fontScale}%`}>
  <header class="sticky top-0 z-40 border-b border-slate-800 bg-ink text-white shadow-xl">
    <div class="mx-auto flex max-w-[1800px] flex-wrap items-center gap-3 px-4 py-3">
      <div class="mr-3 flex items-center gap-3">
        <div class="grid h-10 w-10 place-items-center rounded-xl bg-orange-500 font-black">译</div>
        <div><strong class="block tracking-tight">会议同传提示台</strong><span class="block text-[10px] uppercase tracking-[.16em] text-slate-400">中控 · 现场 分离版</span></div>
      </div>
      <nav class="order-3 flex w-full gap-1 overflow-x-auto rounded-xl bg-slate-800/80 p-1 lg:order-none lg:w-auto" aria-label="工作区">
        {#each [['live','现场传译'],['control','中控'],['offline','离线暂存']] as item}
          <button class="focus-ring whitespace-nowrap rounded-lg px-4 py-2 text-xs font-bold transition {tab === item[0] ? 'bg-white text-ink shadow' : 'text-slate-300 hover:bg-slate-700'}" aria-current={tab === item[0] ? 'page' : undefined} on:click={() => tab = item[0] as TabId}>
            {item[1]}
            {#if item[0] === 'live' && pendingCount}<span class="ml-2 rounded-full bg-orange-500 px-1.5 py-0.5 text-[10px] text-white">{pendingCount}</span>{/if}
            {#if item[0] === 'offline' && offlineCount}<span class="ml-2 rounded-full bg-amber-500 px-1.5 py-0.5 text-[10px] text-white">{offlineCount}</span>{/if}
          </button>
        {/each}
      </nav>
      <div class="ml-auto flex flex-wrap items-center gap-2">
        <button class="focus-ring rounded-full border px-3 py-1.5 text-[11px] font-bold {$online ? 'border-emerald-500/40 bg-emerald-500/15 text-emerald-300' : 'border-amber-500/40 bg-amber-500/15 text-amber-300'}" on:click={() => setOnline(!$online)} title="点击模拟断网/恢复，用于测试下发中断与对账补下发">
          <span class="mr-2 inline-block h-2 w-2 rounded-full {$online ? 'bg-emerald-400' : 'bg-amber-400'}"></span>{$online ? '现场连接正常' : '离线 · 本地暂存'}
        </button>
        <div class="flex items-center rounded-lg bg-slate-800 p-1">
          <button class="focus-ring h-7 w-7 rounded text-lg" title="缩小字号" on:click={() => setFontScale(site.fontScale - 5)}>−</button>
          <span class="w-12 text-center text-[11px]">{site.fontScale}%</span>
          <button class="focus-ring h-7 w-7 rounded text-lg" title="放大字号" on:click={() => setFontScale(site.fontScale + 5)}>＋</button>
        </div>
        <Button size="sm" color="light" on:click={() => showHelp = true}>快捷键</Button>
      </div>
    </div>
  </header>

  <main id="main" class="mx-auto max-w-[1800px] p-4 lg:p-6">
    {#if tab === 'live'}<SiteTab />{:else if tab === 'control'}<ControlTab />{:else if tab === 'offline'}<OfflineTab />{/if}
  </main>

  <footer class="mx-auto flex max-w-[1800px] flex-wrap items-center justify-between gap-3 px-4 pb-6 text-[11px] text-slate-500 lg:px-6">
    <span>现场持有队列与上屏 · 中控持有议程与术语表 · 最近更新 {new Date(site.updatedAt).toLocaleTimeString('zh-CN', { hour12: false })}</span>
    <span>新版本只作用于未确认条目，已上屏段落保留当时译法</span>
  </footer>
</div>

{#if showHelp}
  <div class="fixed inset-0 z-[80] grid place-items-center bg-slate-950/60 p-4" role="presentation" on:click={() => showHelp = false} on:keydown={event => event.key === 'Escape' && (showHelp = false)}>
    <div class="w-full max-w-xl rounded-2xl bg-white p-5 shadow-2xl" role="dialog" tabindex="-1" aria-modal="true" aria-labelledby="shortcut-title" on:click|stopPropagation on:keydown|stopPropagation>
      <div class="flex items-start justify-between"><div><span class="text-[10px] font-black uppercase tracking-[.16em] text-teal-700">Keyboard First</span><h2 id="shortcut-title" class="mt-1 text-xl font-black">键盘操作</h2></div><button class="rounded-lg px-2 py-1 text-xl" aria-label="关闭" on:click={() => showHelp = false}>×</button></div>
      <div class="mt-4 grid gap-2 sm:grid-cols-2">
        {#each [['J / ↓','下一条队列'],['K / ↑','上一条队列'],['C','确认已传并上屏'],['N','聚焦手工录入'],['T','发送当前高优先术语提醒'],['+ / −','调整界面字号'],['顶部网络按钮','模拟断网 / 恢复']] as shortcut}
          <div class="flex items-center justify-between rounded-xl bg-slate-50 px-3 py-2"><kbd class="rounded-md border bg-white px-2 py-1 text-xs font-black">{shortcut[0]}</kbd><span class="text-xs text-slate-600">{shortcut[1]}</span></div>
        {/each}
      </div>
    </div>
  </div>
{/if}
