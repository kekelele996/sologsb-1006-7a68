<script lang="ts">
  import { onMount } from 'svelte'
  import Button from 'flowbite-svelte/Button.svelte'
  import {
    addAnnouncement, addSession, addSpeaker, addTerm, control, controlUndo, controlRedo,
    canControlUndo, canControlRedo, hasUnpublishedChanges, publishAnnouncement, publishVersion,
    updateSession, updateSpeaker, updateTerm
  } from '$lib/control'
  import {
    acknowledgeReminder, appendLog, clearDuplicate, deleteCue, getDelay, ingestCue, live, liveUndo,
    liveRedo, canLiveUndo, canLiveRedo, moveCue, sendReminder, setActiveCue, setCueStatus,
    setFontScale, setLiveSimulation, speakerName, termTarget, updateCue
  } from '$lib/live'
  import { deliveryStats, hasPendingDelivery, reconcile, setNetworkOnline, startSyncEngine, stopSyncEngine } from '$lib/sync'
  import type { Announcement, Cue, TabId, Term } from '$lib/types'

  const liveLines = [
    'Cooling corridors can connect parks, schools, and shaded transit stops.',
    'The program gives every district a shared baseline for heat risk.',
    'Community health workers are collecting temperature and respiratory data together.',
    'This evidence helps us prioritize investments where vulnerability is highest.',
    'We will publish the indicator framework before the next budget cycle.'
  ]
  let tab: TabId = 'live'
  let now = Date.now()
  let manualText = ''
  let manualSpeakerId = ''
  let followup = ''
  let notice = ''
  let announcementText = ''
  let announcementLevel: Announcement['level'] = 'info'
  let manualInput: HTMLTextAreaElement
  let simulationIndex = 0
  let showHelp = false

  // 现场只读自己持有的版本快照
  $: currentSession = $live.sessions.find(item => item.status === 'live') || $live.sessions[0]
  $: activeCue = $live.cues.find(item => item.id === $live.activeCueId) || $live.cues.at(-1)
  $: pendingCount = $live.cues.filter(item => item.status === 'pending').length
  $: offlineCount = $live.cues.filter(item => item.offline).length
  $: lateCount = $live.cues.filter(item => getDelay(item, now) > 8 && item.status !== 'confirmed').length
  $: duplicateCount = $live.cues.filter(item => item.duplicateOf).length
  $: activeSpeaker = $live.speakers.find(item => item.id === activeCue?.speakerId)
  $: activeTerms = $live.terms.filter(item => item.speakerId === activeCue?.speakerId || activeCue?.tags.includes(item.target))
  $: unreadReminders = $live.reminders.filter(item => !item.acknowledged)
  $: stageAnnouncements = $live.announcements.filter(item => item.visibleOnStage)
  $: confirmedCues = $live.cues.filter(item => item.status === 'confirmed')

  // 中控侧
  $: controlDirty = hasUnpublishedChanges($control)
  $: pendingDeliver = hasPendingDelivery()
  // 发件箱按版本汇总（去重出版本号）
  $: outboxVersions = [...new Set($control.outbox.map(record => record.version))].sort((a, b) => b - a)
  $: stageProgress = $live.staging ? Math.round(($live.staging.receivedEntries.length / $live.staging.totalEntries) * 100) : 0

  onMount(() => {
    startSyncEngine()
    window.addEventListener('keydown', handleKeyboard)
    const tick = window.setInterval(() => { now = Date.now() }, 1000)
    const simulate = window.setInterval(() => {
      if ($live.liveSimulation && $live.online) {
        ingestCue(liveLines[simulationIndex % liveLines.length])
        simulationIndex++
      }
    }, 16000)
    return () => {
      stopSyncEngine()
      window.removeEventListener('keydown', handleKeyboard)
      window.clearInterval(tick)
      window.clearInterval(simulate)
    }
  })

  function flash(message: string) {
    notice = message
    window.setTimeout(() => { if (notice === message) notice = '' }, 2800)
  }
  function isControlWorkspace(workspace: TabId) { return workspace === 'agenda' || workspace === 'terms' }
  function undo() { isControlWorkspace(tab) ? controlUndo() : liveUndo() }
  function redo() { isControlWorkspace(tab) ? controlRedo() : liveRedo() }
  $: canUndoNow = isControlWorkspace(tab) ? canControlUndo() : canLiveUndo()
  $: canRedoNow = isControlWorkspace(tab) ? canControlRedo() : canLiveRedo()

  function selectCue(cue: Cue) {
    setActiveCue(cue.id)
    followup = ''
  }
  function confirmActive() {
    if (!activeCue) return
    setCueStatus(activeCue.id, 'confirmed')
    flash('已确认传译并定格当前译法，队列自动前进。')
    moveCue(1)
  }
  function saveFollowup() {
    if (!activeCue || !followup.trim()) return
    updateCue(activeCue.id, { followupText: followup.trim(), status: 'followup' })
    followup = ''
    flash('遗漏内容已补充并标记为待跟进。')
  }
  function submitManual() {
    if (!manualText.trim()) return
    ingestCue(manualText, { manual: true, speakerId: manualSpeakerId || activeCue?.speakerId })
    manualText = ''
    if (!$live.online) flash('网络中断中，内容已暂存在本机，现场照常工作。')
    else flash('手工录入已进入现场队列。')
  }
  function sendTermReminder(termId: string) {
    if (!activeCue) return
    sendReminder(termId, activeCue.id)
    flash(`术语提醒已发送：${termTarget($live, termId)}`)
  }
  function createAnnouncement() {
    addAnnouncement(announcementText, announcementLevel)
    announcementText = ''
    flash('紧急通知已保存到中控工作副本，下次"下发新版本"后现场才可见。')
  }
  function publishControl() {
    const version = publishVersion()
    if (version === null) { flash('没有未下发的改动。'); return }
    flash(`已封版 v${version}，正逐条下发；现场收齐后才会切换。`)
    if (!$live.online) appendLog('warning', `中控已生成 v${version}，但现场离线，条目保留在发件箱，恢复后补发。`)
  }
  function goOnline() { setNetworkOnline(true); flash('网络已恢复，正在按回执对账补发。') }
  function goOffline() { setNetworkOnline(false); flash('已模拟断网：现场继续按当前版本干活。') }
  function runReconcile() { reconcile(); flash('已按回执对账，只补发未同步条目。') }

  function formatTime(timestamp: number) {
    return new Date(timestamp).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })
  }
  function delayClass(seconds: number) {
    if (seconds > 12) return 'bg-red-100 text-red-800 border-red-200'
    if (seconds > 8) return 'bg-amber-100 text-amber-900 border-amber-200'
    return 'bg-emerald-50 text-emerald-800 border-emerald-200'
  }
  function statusLabel(status: Cue['status']) {
    return ({ pending: '待传', confirmed: '已确认', followup: '有补充' })[status]
  }
  function cueIndex(id: string) { return $live.cues.findIndex(item => item.id === id) + 1 }
  function handleKeyboard(event: KeyboardEvent) {
    const target = event.target as HTMLElement
    if (['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)) return
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'z') {
      event.preventDefault(); event.shiftKey ? redo() : undo(); return
    }
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'y') { event.preventDefault(); redo(); return }
    if (tab !== 'live') return
    if (event.key === 'j' || event.key === 'ArrowDown') { event.preventDefault(); moveCue(1) }
    if (event.key === 'k' || event.key === 'ArrowUp') { event.preventDefault(); moveCue(-1) }
    if (event.key.toLowerCase() === 'c') { event.preventDefault(); confirmActive() }
    if (event.key.toLowerCase() === 'n') { event.preventDefault(); manualInput?.focus(); flash('手工录入已获焦，输入后按 Ctrl + Enter 提交。') }
    if (event.key.toLowerCase() === 't' && activeTerms[0]) { event.preventDefault(); sendTermReminder(activeTerms[0].id) }
    if (event.key === '?') { event.preventDefault(); showHelp = true }
    if (event.key === '+' || event.key === '=') setFontScale($live.fontScale + 5)
    if (event.key === '-') setFontScale($live.fontScale - 5)
  }
</script>

<svelte:head><title>会议同传提示台 · Live Cue Desk</title></svelte:head>

<a class="fixed left-2 top-2 z-[100] -translate-y-20 rounded-lg bg-white px-4 py-2 font-bold shadow focus:translate-y-0" href="#main">跳到主要内容</a>

<div class="min-h-full bg-paper text-ink" style={`font-size:${$live.fontScale}%`}>
  <header class="sticky top-0 z-40 border-b border-slate-800 bg-ink text-white shadow-xl">
    <div class="mx-auto flex max-w-[1800px] flex-wrap items-center gap-3 px-4 py-3">
      <div class="mr-3 flex items-center gap-3">
        <div class="grid h-10 w-10 place-items-center rounded-xl bg-orange-500 font-black">译</div>
        <div><strong class="block tracking-tight">会议同传提示台</strong><span class="block text-[10px] uppercase tracking-[.16em] text-slate-400">Control Room × Interpreter Floor</span></div>
      </div>
      <nav class="order-3 flex w-full gap-1 overflow-x-auto rounded-xl bg-slate-800/80 p-1 lg:order-none lg:w-auto" aria-label="工作区">
        {#each [['live','现场传译（现场）'],['agenda','议程与发言人（中控）'],['terms','术语与通知（中控）'],['sync','下发对账'],['offline','离线暂存（现场）']] as item}
          <button class="focus-ring whitespace-nowrap rounded-lg px-3 py-2 text-xs font-bold transition {tab === item[0] ? 'bg-white text-ink shadow' : 'text-slate-300 hover:bg-slate-700'}" aria-current={tab === item[0] ? 'page' : undefined} on:click={() => tab = item[0] as TabId}>
            {item[1]}
            {#if item[0] === 'live' && pendingCount}<span class="ml-2 rounded-full bg-orange-500 px-1.5 py-0.5 text-[10px] text-white">{pendingCount}</span>{/if}
            {#if item[0] === 'offline' && offlineCount}<span class="ml-2 rounded-full bg-amber-500 px-1.5 py-0.5 text-[10px] text-white">{offlineCount}</span>{/if}
            {#if item[0] === 'sync' && pendingDeliver}<span class="ml-2 rounded-full bg-sky-500 px-1.5 py-0.5 text-[10px] text-white">下发中</span>{/if}
          </button>
        {/each}
      </nav>
      <div class="ml-auto flex flex-wrap items-center gap-2">
        <span class="rounded-full border px-3 py-1.5 text-[11px] font-bold {$live.online ? 'border-emerald-500/40 bg-emerald-500/15 text-emerald-300' : 'border-amber-500/40 bg-amber-500/15 text-amber-300'}">
          <span class="mr-2 inline-block h-2 w-2 rounded-full {$live.online ? 'bg-emerald-400' : 'bg-amber-400'}"></span>{$live.online ? '现场连接正常' : '离线 · 本地暂存'}
        </span>
        <span class="rounded-full border border-sky-500/40 bg-sky-500/15 px-3 py-1.5 text-[11px] font-bold text-sky-200" title="现场当前生效的议程/术语版本">现场版 v{$live.activeVersion}</span>
        <span class="rounded-full border px-3 py-1.5 text-[11px] font-bold {controlDirty ? 'border-orange-500/50 bg-orange-500/15 text-orange-300' : 'border-slate-500/40 bg-slate-500/15 text-slate-300'}" title="中控工作副本与最近下发版本的差异">
          {controlDirty ? '中控有未下发改动' : '中控工作副本已全部下发'}
        </span>
        <div class="flex items-center rounded-lg bg-slate-800 p-1">
          <button class="focus-ring h-7 w-7 rounded text-lg" title="缩小字号" on:click={() => setFontScale($live.fontScale - 5)}>−</button>
          <span class="w-12 text-center text-[11px]">{$live.fontScale}%</span>
          <button class="focus-ring h-7 w-7 rounded text-lg" title="放大字号" on:click={() => setFontScale($live.fontScale + 5)}>＋</button>
        </div>
        <Button size="sm" color="light" on:click={() => showHelp = true}>快捷键</Button>
      </div>
    </div>
  </header>

  {#if notice}<div role="status" class="fixed right-5 top-20 z-50 rounded-xl border border-teal-200 bg-white px-4 py-3 text-sm font-bold text-teal-800 shadow-2xl">{notice}</div>{/if}

  <main id="main" class="mx-auto max-w-[1800px] p-4 lg:p-6">
    {#if tab === 'live'}
      <div class="mb-4 flex flex-wrap items-end justify-between gap-4">
        <div>
          <p class="text-[10px] font-black uppercase tracking-[.18em] text-teal-700">现场工作区 · 只读已收版本 v{$live.activeVersion} · {$live.online ? 'LIVE' : 'OFFLINE MODE'}</p>
          <h1 class="mt-1 text-2xl font-black tracking-tight lg:text-4xl">{currentSession?.title}</h1>
          <p class="mt-2 text-sm text-slate-500">{currentSession?.time} · {currentSession?.room} · {$live.speakers.find(item => item.id === currentSession?.speakerId)?.name}</p>
        </div>
        <div class="grid grid-cols-3 gap-2 text-center">
          <div class="rounded-xl border bg-white px-4 py-2"><strong class="block text-xl">{pendingCount}</strong><span class="text-[10px] text-slate-500">待传</span></div>
          <div class="rounded-xl border bg-white px-4 py-2"><strong class="block text-xl text-amber-700">{lateCount}</strong><span class="text-[10px] text-slate-500">偏高延迟</span></div>
          <div class="rounded-xl border bg-white px-4 py-2"><strong class="block text-xl text-red-700">{duplicateCount}</strong><span class="text-[10px] text-slate-500">疑似重复</span></div>
        </div>
      </div>

      {#if $live.staging}
        <div class="mb-4 rounded-2xl border border-sky-300 bg-sky-50 p-4">
          <div class="flex flex-wrap items-center justify-between gap-2">
            <strong class="text-sm text-sky-900">中控 v{$live.staging.version} 正在下发：已收 {$live.staging.receivedEntries.length}/{$live.staging.totalEntries} 条，收齐前现场仍用 v{$live.activeVersion}。</strong>
            <span class="text-xs font-bold text-sky-700">{stageProgress}%</span>
          </div>
          <div class="mt-2 h-2 overflow-hidden rounded-full bg-sky-100"><div class="h-full rounded-full bg-sky-500 transition-all" style={`width:${stageProgress}%`}></div></div>
        </div>
      {/if}

      <div class="grid gap-4 xl:grid-cols-[minmax(0,1.65fr)_minmax(300px,.75fr)]">
        <div class="space-y-4">
          <section class="overflow-hidden rounded-2xl border border-teal-800 bg-[#0d3b36] text-white shadow-lg">
            <div class="flex items-center justify-between border-b border-white/10 px-4 py-3">
              <div><span class="text-[10px] font-black uppercase tracking-[.16em] text-teal-200">现场可见内容（现场所有）</span><h2 class="mt-1 font-bold">舞台字幕与紧急通知</h2></div>
              <span class="rounded-full bg-teal-600 px-2.5 py-1 text-[10px] font-black text-white">STAGE OUTPUT · v{$live.activeVersion}</span>
            </div>
            <div class="space-y-3 p-4">
              {#each stageAnnouncements as item}
                <div class="rounded-xl border border-orange-300/30 bg-orange-500/15 p-3"><strong class="text-xs text-orange-200">紧急通知</strong><p class="mt-1 text-lg font-bold">{item.text}</p></div>
              {/each}
              {#each confirmedCues.slice(-2) as cue}
                <div class="rounded-xl bg-white/10 p-3">
                  <div class="mb-1 flex justify-between text-[10px] text-teal-200">
                    <span>{speakerName($live, cue.speakerId)}</span>
                    <span>{formatTime(cue.receivedAt)} · 译法定格于 v{cue.termsVersion}{#if cue.termsVersion !== $live.activeVersion} <em class="not-italic text-amber-200">（旧版保留）</em>{/if}</span>
                  </div>
                  <p class="text-base leading-relaxed lg:text-lg">{cue.text}</p>
                  <div class="mt-2 flex flex-wrap gap-1">{#each cue.tags as tag}<span class="rounded-full bg-teal-500/30 px-2 py-0.5 text-[10px] font-bold text-teal-50">{tag}</span>{/each}</div>
                </div>
              {/each}
              {#if !confirmedCues.length && !stageAnnouncements.length}
                <p class="py-5 text-center text-sm text-teal-100/60">确认传译或发布通知后，现场可见内容将在这里出现。</p>
              {/if}
            </div>
          </section>

          <section class="rounded-2xl border bg-white shadow-sm">
            <div class="flex flex-wrap items-center justify-between gap-3 border-b px-4 py-3">
              <div><span class="text-[10px] font-black uppercase tracking-[.16em] text-slate-400">现场传译队列（现场所有）</span><h2 class="mt-1 font-bold">待确认与遗漏补充</h2></div>
              <div class="flex items-center gap-3 text-xs text-slate-500"><span>自动接入</span><button type="button" role="switch" aria-label="自动接入现场文字" aria-checked={$live.liveSimulation} class="focus-ring h-6 w-11 rounded-full p-1 transition {$live.liveSimulation ? 'bg-teal-600' : 'bg-slate-300'}" on:click={() => setLiveSimulation(!$live.liveSimulation)}><span class="block h-4 w-4 rounded-full bg-white transition {$live.liveSimulation ? 'translate-x-5' : ''}"></span></button></div>
            </div>
            <div class="max-h-[600px] space-y-2 overflow-y-auto p-3 scrollbar-thin">
              {#each $live.cues as cue, index}
                <!-- svelte-ignore a11y_no_noninteractive_element_to_interactive_role -->
                <article role="button" tabindex="0" class="cue-enter cursor-pointer rounded-xl border p-3 transition {cue.id === $live.activeCueId ? 'border-teal-600 bg-teal-50 shadow-md' : 'border-slate-200 bg-white hover:border-slate-300'}" on:click={() => selectCue(cue)} on:keydown={event => (event.key === 'Enter' || event.key === ' ') && selectCue(cue)}>
                  <div class="flex flex-wrap items-start gap-3">
                    <span class="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-slate-900 text-xs font-black text-white">{index + 1}</span>
                    <div class="min-w-0 flex-1">
                      <div class="mb-2 flex flex-wrap items-center gap-2 text-[10px] font-bold">
                        <span class="rounded-md bg-slate-100 px-2 py-1 text-slate-600">{speakerName($live, cue.speakerId)}</span>
                        <span class="rounded-md border px-2 py-1 {delayClass(getDelay(cue, now))}">{formatTime(cue.receivedAt)} · 延迟 {getDelay(cue, now)}s</span>
                        <span class="rounded-md px-2 py-1 {cue.status === 'confirmed' ? 'bg-emerald-100 text-emerald-800' : cue.status === 'followup' ? 'bg-amber-100 text-amber-900' : 'bg-blue-100 text-blue-800'}">{statusLabel(cue.status)}</span>
                        <span class="rounded-md border border-slate-200 px-2 py-1 text-slate-500" title="该条目使用的术语表版本">v{cue.termsVersion}{#if cue.status !== 'confirmed' && cue.termsVersion !== $live.activeVersion} → v{$live.activeVersion}{/if}</span>
                        {#if cue.offline}<span class="rounded-md bg-amber-100 px-2 py-1 text-amber-900">离线暂存</span>{/if}
                        {#if cue.manual}<span class="rounded-md bg-slate-100 px-2 py-1 text-slate-600">手工</span>{/if}
                      </div>
                      <p class="text-sm leading-6 lg:text-base">{cue.text}</p>
                      {#if cue.duplicateOf}
                        <div class="mt-2 flex items-center justify-between gap-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800">
                          <span><strong>疑似重复：</strong>与第 {cueIndex(cue.duplicateOf)} 条高度相似</span>
                          <button class="font-black underline" on:click|stopPropagation={() => clearDuplicate(cue.id)}>确认非重复</button>
                        </div>
                      {/if}
                      {#if cue.followupText}<p class="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-900"><strong>补译：</strong>{cue.followupText}</p>{/if}
                      <div class="mt-2 flex flex-wrap gap-1">{#each cue.tags as tag}<span class="rounded-full bg-teal-100 px-2 py-1 text-[10px] font-bold text-teal-800">{tag}</span>{/each}</div>
                    </div>
                  </div>
                </article>
              {/each}
            </div>
          </section>
        </div>

        <div class="space-y-4">
          <section class="rounded-2xl border bg-white p-4 shadow-sm">
            <div class="mb-3 flex items-start justify-between gap-3">
              <div><span class="text-[10px] font-black uppercase tracking-[.16em] text-teal-700">当前口译位 · 术语 v{$live.activeVersion}</span><h2 class="mt-1 font-bold">{activeSpeaker?.name || '等待队列'}</h2><p class="text-xs text-slate-500">{activeSpeaker?.language}</p></div>
              <div class="flex gap-1"><button class="focus-ring rounded-lg border px-2 py-1 text-xs" aria-label="上一条" on:click={() => moveCue(-1)}>↑</button><button class="focus-ring rounded-lg border px-2 py-1 text-xs" aria-label="下一条" on:click={() => moveCue(1)}>↓</button></div>
            </div>
            {#if activeCue}
              <div class="rounded-xl bg-slate-50 p-3"><p class="text-sm leading-6">{activeCue.text}</p><p class="mt-2 text-[10px] text-slate-500">快捷键：J / K 移动，C 确认（译法定格），T 发送首条高优先术语提醒</p></div>
              <div class="mt-3 grid grid-cols-2 gap-2"><Button color="green" on:click={confirmActive}>确认已传 <kbd class="ml-1 text-[10px]">C</kbd></Button><Button color="yellow" on:click={() => tab = 'offline'}>手工补充</Button></div>
              <label for="followup-input" class="mt-4 block text-[10px] font-black uppercase tracking-wider text-slate-500">遗漏补译</label>
              <textarea id="followup-input" class="focus-ring mt-2 w-full rounded-xl border p-3 text-sm" rows="3" bind:value={followup} placeholder="输入遗漏内容或修正术语…"></textarea>
              <Button class="mt-2 w-full" color="light" disabled={!followup.trim()} on:click={saveFollowup}>标记补充完成</Button>
            {/if}
          </section>

          <section class="rounded-2xl border bg-white p-4 shadow-sm">
            <div class="mb-3 flex items-center justify-between"><div><span class="text-[10px] font-black uppercase tracking-[.16em] text-slate-400">术语提醒（来自已收版本）</span><h2 class="mt-1 font-bold">当前发言人术语</h2></div><span class="rounded-full bg-emerald-100 px-2.5 py-1 text-xs font-black text-emerald-800">{activeTerms.length}</span></div>
            <div class="space-y-2">
              {#each activeTerms as term}
                <div class="flex items-center justify-between gap-3 rounded-xl border border-slate-200 p-3">
                  <div><strong class="block text-xs">{term.target}</strong><span class="text-[10px] text-slate-500">{term.source} · {term.note}</span></div>
                  <Button size="xs" color={term.priority === 'high' ? 'yellow' : 'light'} on:click={() => sendTermReminder(term.id)}>提醒</Button>
                </div>
              {/each}
            </div>
          </section>

          <section class="rounded-2xl border bg-white p-4 shadow-sm">
            <div class="mb-3 flex items-center justify-between"><h2 class="font-bold">已发送提醒</h2><span class="text-xs text-slate-500">{unreadReminders.length} 条未确认</span></div>
            <div class="max-h-52 space-y-2 overflow-y-auto">
              {#each $live.reminders as reminder}
                <div class="flex items-center justify-between gap-2 rounded-lg px-3 py-2 text-xs {reminder.acknowledged ? 'bg-slate-50 text-slate-400' : 'bg-teal-50 text-teal-900'}">
                  <span><strong>{reminder.target}</strong> · {formatTime(reminder.createdAt)}</span>
                  {#if !reminder.acknowledged}<button class="font-bold underline" on:click={() => acknowledgeReminder(reminder.id)}>已看到</button>{/if}
                </div>
              {/each}
              {#if !$live.reminders.length}<p class="py-4 text-center text-xs text-slate-400">尚未发送术语提醒。</p>{/if}
            </div>
          </section>
        </div>
      </div>
    {/if}

    {#if tab === 'agenda'}
      <div class="mb-5">
        <p class="text-[10px] font-black uppercase tracking-[.18em] text-orange-700">中控工作区 · 议程与发言人只存在于中控工作副本</p>
        <h1 class="mt-1 text-3xl font-black">议程、发言人</h1>
        <p class="mt-2 text-sm text-slate-500">这里的修改不会影响现场；改完到「下发对账」封版下发，现场收齐新版本后才切换。{#if controlDirty}<strong class="text-orange-700">当前有未下发改动。</strong>{/if}</p>
      </div>
      <div class="grid gap-4 xl:grid-cols-[1.3fr_.7fr]">
        <section class="rounded-2xl border bg-white p-4 shadow-sm">
          <div class="mb-4 flex items-center justify-between"><div><h2 class="font-black">演讲顺序</h2><p class="text-xs text-slate-500">拖动时间、状态或发言人只更新中控工作副本。</p></div><Button size="sm" on:click={addSession}>新增场次</Button></div>
          <div class="space-y-3">
            {#each [...$control.content.sessions].sort((a,b) => a.order - b.order) as session}
              <article class="grid gap-3 rounded-xl border p-3 md:grid-cols-[80px_1fr_190px_120px]">
                <input class="focus-ring rounded-lg border px-2 py-2 text-sm font-bold" type="time" value={session.time} on:change={event => updateSession(session.id, { time: (event.target as HTMLInputElement).value })} />
                <div><input class="focus-ring w-full rounded-lg border px-2 py-2 font-bold" value={session.title} on:change={event => updateSession(session.id, { title: (event.target as HTMLInputElement).value })} /><span class="mt-1 block text-[10px] text-slate-500">{session.room}</span></div>
                <select class="focus-ring rounded-lg border px-2" value={session.speakerId} on:change={event => updateSession(session.id, { speakerId: (event.target as HTMLSelectElement).value })}>{#each $control.content.speakers as speaker}<option value={speaker.id}>{speaker.name}</option>{/each}</select>
                <select class="focus-ring rounded-lg border px-2" value={session.status} on:change={event => updateSession(session.id, { status: (event.target as HTMLSelectElement).value as typeof session.status })}><option value="upcoming">未开始</option><option value="live">进行中</option><option value="done">已结束</option></select>
              </article>
            {/each}
          </div>
        </section>
        <section class="rounded-2xl border bg-white p-4 shadow-sm">
          <div class="mb-4 flex items-center justify-between"><div><h2 class="font-black">发言人</h2><p class="text-xs text-slate-500">语气、语言方向与标识颜色。</p></div><Button size="sm" color="light" on:click={addSpeaker}>新增</Button></div>
          <div class="space-y-3">
            {#each $control.content.speakers as speaker}
              <div class="rounded-xl border p-3">
                <div class="flex items-center gap-2"><input class="focus-ring h-8 w-8 rounded-lg border-0 p-1" type="color" value={speaker.color} aria-label="标识颜色" on:change={event => updateSpeaker(speaker.id, { color: (event.target as HTMLInputElement).value })} /><input class="focus-ring min-w-0 flex-1 rounded-lg border px-3 py-2 font-bold" value={speaker.name} on:change={event => updateSpeaker(speaker.id, { name: (event.target as HTMLInputElement).value })} /></div>
                <input class="focus-ring mt-2 w-full rounded-lg border px-3 py-2 text-xs" value={speaker.title} on:change={event => updateSpeaker(speaker.id, { title: (event.target as HTMLInputElement).value })} />
                <input class="focus-ring mt-2 w-full rounded-lg border px-2 py-2 text-xs" value={speaker.language} on:change={event => updateSpeaker(speaker.id, { language: (event.target as HTMLInputElement).value })} />
              </div>
            {/each}
          </div>
        </section>
      </div>
    {/if}

    {#if tab === 'terms'}
      <div class="mb-5">
        <p class="text-[10px] font-black uppercase tracking-[.18em] text-orange-700">中控工作区 · 术语表修改不会实时改写现场上屏</p>
        <h1 class="mt-1 text-3xl font-black">术语表与紧急通知</h1>
        <p class="mt-2 text-sm text-slate-500">新版本只影响现场尚未确认的条目；已经上屏的段落保留当时那版译法。{#if controlDirty}<strong class="text-orange-700">当前有未下发改动。</strong>{/if}</p>
      </div>
      <div class="grid gap-4 xl:grid-cols-[1.35fr_.65fr]">
        <section class="overflow-hidden rounded-2xl border bg-white shadow-sm">
          <div class="flex items-center justify-between border-b p-4"><div><h2 class="font-black">术语表（中控工作副本 v{$control.draftVersion + (controlDirty ? 1 : 0)}）</h2><p class="text-xs text-slate-500">改译法后需「下发新版本」；现场收到前照旧版继续。</p></div><Button size="sm" on:click={addTerm}>新增术语</Button></div>
          <div class="overflow-x-auto">
            <table class="w-full min-w-[760px] text-left text-xs">
              <thead class="bg-slate-50 uppercase tracking-wider text-slate-500"><tr><th class="p-3">原文</th><th class="p-3">指定译法</th><th class="p-3">说明</th><th class="p-3">发言人</th><th class="p-3">优先级</th><th class="p-3"></th></tr></thead>
              <tbody>{#each $control.content.terms as term}<tr class="border-t"><td class="p-2"><input class="focus-ring w-full rounded border px-2 py-2" value={term.source} on:change={event => updateTerm(term.id, { source: (event.target as HTMLInputElement).value })} /></td><td class="p-2"><input class="focus-ring w-full rounded border px-2 py-2 font-bold" value={term.target} on:change={event => updateTerm(term.id, { target: (event.target as HTMLInputElement).value })} /></td><td class="p-2"><input class="focus-ring w-full rounded border px-2 py-2" value={term.note} on:change={event => updateTerm(term.id, { note: (event.target as HTMLInputElement).value })} /></td><td class="p-2"><select class="focus-ring rounded border px-2 py-2" value={term.speakerId} on:change={event => updateTerm(term.id, { speakerId: (event.target as HTMLSelectElement).value })}>{#each $control.content.speakers as speaker}<option value={speaker.id}>{speaker.name}</option>{/each}</select></td><td class="p-2"><select class="focus-ring rounded border px-2 py-2" value={term.priority} on:change={event => updateTerm(term.id, { priority: (event.target as HTMLSelectElement).value as Term['priority'] })}><option value="normal">常规</option><option value="high">高优先</option></select></td><td class="p-2"><Button size="xs" color="yellow" disabled={!activeCue} on:click={() => sendTermReminder(term.id)}>提醒现场</Button></td></tr>{/each}</tbody>
            </table>
          </div>
        </section>
        <section class="rounded-2xl border bg-white p-4 shadow-sm">
          <div class="mb-4"><h2 class="font-black">紧急通知</h2><p class="text-xs text-slate-500">先保存在中控，勾选"发布到现场"也只是工作副本标记，随下一版下发后才真正上屏。</p></div>
          <select class="focus-ring w-full rounded-xl border p-3 text-sm" bind:value={announcementLevel}><option value="info">信息提示</option><option value="warning">时间提醒</option><option value="urgent">紧急通知</option></select>
          <textarea class="focus-ring mt-3 w-full rounded-xl border p-3 text-sm" rows="3" bind:value={announcementText} placeholder="输入通知内容…"></textarea>
          <Button class="mt-3 w-full" disabled={!announcementText.trim()} on:click={createAnnouncement}>保存到中控</Button>
          <div class="mt-6 space-y-3">
            {#each $control.content.announcements as announcement}
              <div class="rounded-xl border p-3 {announcement.visibleOnStage ? 'border-orange-300 bg-orange-50' : 'border-slate-200 bg-slate-50'}">
                <div class="flex items-center justify-between gap-3"><span class="rounded-full bg-white px-2 py-1 text-[10px] font-bold">{announcement.level === 'urgent' ? '紧急' : announcement.level === 'warning' ? '提醒' : '信息'}</span><span class="text-[10px] font-bold {announcement.visibleOnStage ? 'text-orange-700' : 'text-slate-500'}">{announcement.visibleOnStage ? '将在下版上屏' : '仅中控'}</span></div>
                <p class="my-2 text-sm font-bold">{announcement.text}</p>
                <Button size="xs" color={announcement.visibleOnStage ? 'light' : 'yellow'} on:click={() => publishAnnouncement(announcement.id, !announcement.visibleOnStage)}>{announcement.visibleOnStage ? '撤下上屏标记' : '标记发布到现场'}</Button>
              </div>
            {/each}
          </div>
        </section>
      </div>
    {/if}

    {#if tab === 'sync'}
      <div class="mb-5">
        <p class="text-[10px] font-black uppercase tracking-[.18em] text-sky-700">版本下发与回执对账</p>
        <h1 class="mt-1 text-3xl font-black">中控 → 现场 下发对账中心</h1>
        <p class="mt-2 text-sm text-slate-500">中控封版后逐条下发，现场集齐整版才切换；断网时现场照旧版工作，恢复后按回执只补没同步上的条目（已确认内容不重发）。</p>
      </div>
      <div class="grid gap-4 xl:grid-cols-[1.1fr_.9fr]">
        <section class="rounded-2xl border bg-white p-5 shadow-sm">
          <div class="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 class="font-black">封版下发</h2>
              <p class="text-xs text-slate-500">中控最新工作副本：草稿 v{$control.draftVersion + (controlDirty ? 1 : 0)} · 现场生效：v{$live.activeVersion}</p>
            </div>
            <Button color={controlDirty ? 'green' : 'light'} disabled={!controlDirty} on:click={publishControl}>下发新版本 v{$control.draftVersion + 1}</Button>
          </div>
          <div class="mt-5 space-y-3">
            {#each outboxVersions as version}
              {@const stats = deliveryStats(version)}
              <article class="rounded-xl border p-4 {version === $live.activeVersion ? 'border-emerald-300 bg-emerald-50' : 'border-slate-200 bg-slate-50'}">
                <div class="flex flex-wrap items-center justify-between gap-2">
                  <strong class="text-sm">v{version}{#if version === 1} · 初始版本{/if}</strong>
                  <span class="text-[11px] font-bold">
                    {#if version === $live.activeVersion}<span class="text-emerald-700">现场已启用</span>
                    {:else if stats.acked === stats.total}<span class="text-sky-700">条目已送达，等待整版切换</span>
                    {:else}<span class="text-amber-700">下发中 {stats.acked}/{stats.total}（待发 {stats.queued} · 已发待回执 {stats.sent}）</span>{/if}
                  </span>
                </div>
                <div class="mt-2 h-2 overflow-hidden rounded-full bg-white"><div class="h-full rounded-full {version === $live.activeVersion ? 'bg-emerald-500' : 'bg-sky-500'}" style={`width:${stats.total ? Math.round(stats.acked / stats.total * 100) : 100}%`}></div></div>
              </article>
            {/each}
          </div>
        </section>

        <section class="rounded-2xl border bg-white p-5 shadow-sm">
          <div class="flex flex-wrap items-center justify-between gap-3">
            <div><h2 class="font-black">网络与对账</h2><p class="text-xs text-slate-500">模拟下发通道中断/恢复。</p></div>
            <div class="flex gap-2">
              {#if $live.online}<Button color="yellow" on:click={goOffline}>模拟断网</Button>{:else}<Button color="green" on:click={goOnline}>恢复网络</Button>{/if}
              <Button color="light" disabled={!$live.online} on:click={runReconcile}>手动对账</Button>
            </div>
          </div>
          <div class="mt-4 rounded-xl bg-slate-50 p-3 text-xs leading-6 text-slate-600">
            <strong class="block text-slate-800">验证步骤</strong>
            1. 在「术语」页改一个译法 → 回这里「下发新版本」。<br />
            2. 下发进度走到一半时点「模拟断网」→ 切到「现场传译」照常确认条目。<br />
            3. 点「恢复网络」→ 只补发剩余条目；现场集齐后整版切换。<br />
            4. 已确认上屏的段落仍显示旧版译法，并带 v 版本标记。
          </div>
          <h3 class="mt-5 text-xs font-black uppercase tracking-wider text-slate-400">现场同步日志</h3>
          <div class="mt-2 max-h-80 space-y-2 overflow-y-auto">
            {#each $live.syncLog as event}
              <div class="rounded-lg border px-3 py-2 text-xs {event.level === 'success' ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : event.level === 'warning' ? 'border-amber-200 bg-amber-50 text-amber-900' : 'border-slate-200 bg-white text-slate-700'}">
                <span class="mr-2 font-bold text-slate-400">{formatTime(event.at)}</span>{event.message}
              </div>
            {/each}
          </div>
        </section>
      </div>
    {/if}

    {#if tab === 'offline'}
      <div class="mb-5"><p class="text-[10px] font-black uppercase tracking-[.18em] text-amber-700">现场工作区 · 断网继续工作 · 恢复后合并</p><h1 class="mt-1 text-3xl font-black">手工录入与离线暂存</h1></div>
      <div class="grid gap-4 xl:grid-cols-[.9fr_1.1fr]">
        <section class="offline-hatch rounded-2xl border border-amber-200 bg-white p-5 shadow-sm">
          <div class="mb-4 flex items-center justify-between gap-3"><div><h2 class="font-black">手工录入现场文字</h2><p class="text-xs text-slate-500">按 Ctrl + Enter 也可以提交。</p></div><span class="rounded-full px-3 py-1 text-xs font-bold {$live.online ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-900'}">{$live.online ? '在线写入队列' : '离线保存本机'}</span></div>
          <label class="text-xs font-bold">发言人或场次<select class="focus-ring mt-2 w-full rounded-xl border p-3" bind:value={manualSpeakerId}><option value="">跟随当前发言人</option>{#each $live.speakers as speaker}<option value={speaker.id}>{speaker.name}</option>{/each}</select></label>
          <label class="mt-4 block text-xs font-bold">现场文字<textarea bind:this={manualInput} class="focus-ring mt-2 w-full rounded-xl border p-4 text-base leading-7" rows="8" bind:value={manualText} placeholder="网络中断时，在这里继续录入…" on:keydown={event => { if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') submitManual() }}></textarea></label>
          <Button class="mt-3 w-full" size="lg" disabled={!manualText.trim()} on:click={submitManual}>加入队列</Button>
          <div class="mt-4 rounded-xl bg-amber-50 p-3 text-xs text-amber-900"><strong>暂存规则：</strong>断网期间现场照常干活，离线条目带"本地"标记；恢复连接后自动合并并执行相似内容检测；版本补发不影响这些条目（未确认的在整版切换时按新术语重新标注）。</div>
        </section>
        <section class="rounded-2xl border bg-white p-5 shadow-sm">
          <div class="mb-4 flex flex-wrap items-center justify-between gap-3"><div><h2 class="font-black">合并与冲突检查</h2><p class="text-xs text-slate-500">当前有 {offlineCount} 条离线条目，{duplicateCount} 条疑似重复。</p></div><Button disabled={$live.online || !offlineCount} color="green" on:click={goOnline}>恢复连接并合并</Button></div>
          <div class="space-y-3">
            {#each $live.cues.filter(item => item.offline) as cue}
              <article class="rounded-xl border border-dashed border-amber-300 bg-amber-50/60 p-4">
                <div class="flex items-center justify-between text-[10px] font-bold text-amber-800"><span>本机暂存 · {formatTime(cue.receivedAt)}</span><span>{speakerName($live, cue.speakerId)}</span></div>
                <textarea class="focus-ring mt-3 w-full rounded-xl border border-amber-200 bg-white p-3 text-sm" rows="3" value={cue.text} on:change={event => updateCue(cue.id, { text: (event.target as HTMLTextAreaElement).value })}></textarea>
                <div class="mt-2 flex justify-between"><span class="text-[10px] text-amber-800">等待恢复网络后留在现场队列</span><button class="text-xs font-bold text-red-700 underline" on:click={() => deleteCue(cue.id)}>删除暂存</button></div>
              </article>
            {/each}
            {#if !offlineCount}<div class="grid min-h-60 place-items-center rounded-xl bg-slate-50 text-center"><div><div class="mx-auto grid h-14 w-14 place-items-center rounded-full bg-emerald-100 text-2xl text-emerald-700">✓</div><strong class="mt-3 block text-sm">没有离线暂存条目</strong><p class="mt-1 text-xs text-slate-500">可在「下发对账」页模拟断网后测试手工录入与恢复合并。</p></div></div>{/if}
          </div>
        </section>
      </div>
    {/if}
  </main>

  <footer class="mx-auto flex max-w-[1800px] flex-wrap items-center justify-between gap-3 px-4 pb-6 text-[11px] text-slate-500 lg:px-6">
    <span>中控与现场各自独立持久化 · 现场生效 v{$live.activeVersion} · 中控草稿 v{$control.draftVersion}</span>
    <span>中控管议程与术语表 · 现场管队列与上屏 · 收齐整版才切换</span>
    <div class="flex gap-2"><button class="font-bold underline disabled:opacity-40" disabled={!canUndoNow} on:click={undo}>撤销</button><button class="font-bold underline disabled:opacity-40" disabled={!canRedoNow} on:click={redo}>重做</button></div>
  </footer>
</div>

{#if showHelp}
  <div class="fixed inset-0 z-[80] grid place-items-center bg-slate-950/60 p-4" role="presentation" on:click={() => showHelp = false} on:keydown={event => event.key === 'Escape' && (showHelp = false)}>
    <div class="w-full max-w-xl rounded-2xl bg-white p-5 shadow-2xl" role="dialog" tabindex="-1" aria-modal="true" aria-labelledby="shortcut-title" on:click|stopPropagation on:keydown|stopPropagation>
      <div class="flex items-start justify-between"><div><span class="text-[10px] font-black uppercase tracking-[.16em] text-teal-700">Keyboard First</span><h2 id="shortcut-title" class="mt-1 text-xl font-black">键盘操作（现场页）</h2></div><button class="rounded-lg px-2 py-1 text-xl" aria-label="关闭" on:click={() => showHelp = false}>×</button></div>
      <div class="mt-4 grid gap-2 sm:grid-cols-2">
        {#each [['J / ↓','下一条队列'],['K / ↑','上一条队列'],['C','确认已传并定格译法'],['N','聚焦手工录入'],['T','发送当前高优先术语'],['+ / −','调整界面字号'],['Ctrl + Z','撤销（按工作区区分）'],['Ctrl + Shift + Z','重做（按工作区区分）']] as shortcut}
          <div class="flex items-center justify-between rounded-xl bg-slate-50 px-3 py-2"><kbd class="rounded-md border bg-white px-2 py-1 text-xs font-black">{shortcut[0]}</kbd><span class="text-xs text-slate-600">{shortcut[1]}</span></div>
        {/each}
      </div>
    </div>
  </div>
{/if}
