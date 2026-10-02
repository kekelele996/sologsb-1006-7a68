<script lang="ts">
  import { onMount } from 'svelte'
  import { get } from 'svelte/store'
  import Button from 'flowbite-svelte/Button.svelte'
  import {
    acknowledgeReminder, addAnnouncement, applyBufferedVersion, clearDuplicate, dismissBufferedVersion,
    getDelay, ingestCue, moveCue, publishAnnouncement, sendReminder, setActiveCue, setCueStatus, setLiveSimulation, siteStore, updateCue
  } from '$lib/siteStore'
  import { online } from '$lib/netStore'
  import type { Announcement, Cue } from '$lib/types'
  import { speakerName, termTarget } from '$lib/utils'

  const liveLines = [
    'Cooling corridors can connect parks, schools, and shaded transit stops.',
    'The program gives every district a shared baseline for heat risk.',
    'Community health workers are collecting temperature and respiratory data together.',
    'This evidence helps us prioritize investments where vulnerability is highest.',
    'We will publish the indicator framework before the next budget cycle.'
  ]

  let now = Date.now()
  let manualText = ''
  let manualSpeakerId = ''
  let followup = ''
  let announcementText = ''
  let announcementLevel: Announcement['level'] = 'info'
  let notice = ''
  let manualInput: HTMLTextAreaElement
  let simulationIndex = 0

  $: state = $siteStore
  $: currentSession = state.appliedSessions.find(item => item.status === 'live') || state.appliedSessions[0]
  $: activeCue = state.cues.find(item => item.id === state.activeCueId) || state.cues.at(-1)
  $: pendingCount = state.cues.filter(item => item.status === 'pending').length
  $: lateCount = state.cues.filter(item => getDelay(item, now) > 8 && item.status !== 'confirmed').length
  $: duplicateCount = state.cues.filter(item => item.duplicateOf).length
  $: activeSpeaker = state.appliedSpeakers.find(item => item.id === activeCue?.speakerId)
  $: activeTerms = state.appliedTerms.filter(item => item.speakerId === activeCue?.speakerId || activeCue?.tags.includes(item.target))
  $: unreadReminders = state.reminders.filter(item => !item.acknowledged)
  $: bufferedReady = state.bufferedVersion != null && state.bufferedSnapshot != null

  onMount(() => {
    const tick = window.setInterval(() => { now = Date.now() }, 1000)
    const simulate = window.setInterval(() => {
      if (get(siteStore).liveSimulation && get(online)) {
        ingestCue(liveLines[simulationIndex % liveLines.length])
        simulationIndex++
      }
    }, 16000)
    const focusHandler = () => manualInput?.focus()
    window.addEventListener('site:focus-manual', focusHandler)
    return () => {
      window.clearInterval(tick)
      window.clearInterval(simulate)
      window.removeEventListener('site:focus-manual', focusHandler)
    }
  })

  function flash(message: string) {
    notice = message
    window.setTimeout(() => { if (notice === message) notice = '' }, 2800)
  }
  function selectCue(cue: Cue) {
    setActiveCue(cue.id)
    followup = cue.followupText
  }
  function confirmActive() {
    if (!activeCue) return
    setCueStatus(activeCue.id, 'confirmed')
    flash('已确认传译并上屏，该段落冻结当前术语表译法。')
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
    flash('手工录入已进入现场队列。')
  }
  function sendTermReminder(termId: string) {
    if (!activeCue) return
    sendReminder(termId, activeCue.id)
    flash(`术语提醒已发送：${termTarget(state.appliedTerms, termId)}`)
  }
  function createAnnouncement() {
    addAnnouncement(announcementText, announcementLevel)
    announcementText = ''
    flash('紧急通知已保存到上屏草稿，发布后才可见。')
  }
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
</script>

{#if notice}<div role="status" class="fixed right-5 top-20 z-50 rounded-xl border border-teal-200 bg-white px-4 py-3 text-sm font-bold text-teal-800 shadow-2xl">{notice}</div>{/if}

<div class="mb-4 flex flex-wrap items-end justify-between gap-4">
  <div>
    <p class="text-[10px] font-black uppercase tracking-[.18em] text-teal-700">当前场次 · 现场 {$online ? 'LIVE' : 'OFFLINE'}</p>
    <h1 class="mt-1 text-2xl font-black tracking-tight lg:text-4xl">{currentSession?.title}</h1>
    <p class="mt-2 text-sm text-slate-500">{currentSession?.time} · {currentSession?.room} · {speakerName(state.appliedSpeakers, currentSession?.speakerId || '')}</p>
  </div>
  <div class="flex flex-col items-end gap-2">
    <div class="grid grid-cols-3 gap-2 text-center">
      <div class="rounded-xl border bg-white px-4 py-2"><strong class="block text-xl">{pendingCount}</strong><span class="text-[10px] text-slate-500">待传</span></div>
      <div class="rounded-xl border bg-white px-4 py-2"><strong class="block text-xl text-amber-700">{lateCount}</strong><span class="text-[10px] text-slate-500">偏高延迟</span></div>
      <div class="rounded-xl border bg-white px-4 py-2"><strong class="block text-xl text-red-700">{duplicateCount}</strong><span class="text-[10px] text-slate-500">疑似重复</span></div>
    </div>
    <span class="rounded-full border border-teal-500/40 bg-teal-50 px-3 py-1 text-[11px] font-black text-teal-800">当前术语表 v{state.appliedVersion}</span>
  </div>
</div>

<!-- 版本切换横幅：现场收到完整新版本才切换；没收到照旧版 -->
{#if bufferedReady}
  <div class="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-teal-300 bg-teal-50 p-4 shadow-sm">
    <div>
      <strong class="text-teal-900">中控已下发术语表 v{state.bufferedVersion}（{state.bufferedSnapshot?.terms.length} 条）。</strong>
      <p class="mt-1 text-xs text-teal-800">现场仅在收到后切换：已确认上屏的段落保留 v{state.appliedVersion} 译法，新版本只重算未确认条目。</p>
    </div>
    <div class="flex gap-2">
      <Button color="green" on:click={() => { applyBufferedVersion(); flash(`已切换到术语表 v${state.bufferedVersion}，未确认条目已按新译法重标。`) }}>切换到 v{state.bufferedVersion}</Button>
      <Button color="light" on:click={() => { dismissBufferedVersion(); flash('已保留旧版本，未切换。') }}>稍后</Button>
    </div>
  </div>
{:else if state.partialVersion != null}
  <div class="mb-4 rounded-2xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">
    <strong>术语表 v{state.partialVersion} 下发中断：</strong>
    现场已收到 {state.partialReceived}/{state.partialTotal} 条，内容不完整，<strong>继续使用 v{state.appliedVersion} 旧版</strong>。恢复网络后中控会按回执对账，只补下发未同步的条目。
  </div>
{/if}

<div class="grid gap-4 xl:grid-cols-[minmax(0,1.65fr)_minmax(300px,.75fr)]">
  <div class="space-y-4">
    <section class="overflow-hidden rounded-2xl border border-teal-800 bg-[#0d3b36] text-white shadow-lg">
      <div class="flex items-center justify-between border-b border-white/10 px-4 py-3">
        <div><span class="text-[10px] font-black uppercase tracking-[.16em] text-teal-200">现场可见内容</span><h2 class="mt-1 font-bold">舞台字幕与紧急通知</h2></div>
        <span class="rounded-full bg-teal-600 px-2.5 py-1 text-[10px] font-black text-white">STAGE OUTPUT</span>
      </div>
      <div class="space-y-3 p-4">
        {#each state.announcements.filter(item => item.visibleOnStage) as item}
          <div class="rounded-xl border border-orange-300/30 bg-orange-500/15 p-3"><strong class="text-xs text-orange-200">紧急通知</strong><p class="mt-1 text-lg font-bold">{item.text}</p></div>
        {/each}
        {#each state.cues.filter(item => item.status === 'confirmed').slice(-2) as cue}
          <div class="rounded-xl bg-white/10 p-3">
            <div class="mb-1 flex items-center justify-between text-[10px] text-teal-200">
              <span>{speakerName(state.appliedSpeakers, cue.speakerId)}</span>
              <span>{formatTime(cue.receivedAt)} · 上屏留 v{cue.glossaryVersion} 译法</span>
            </div>
            <p class="text-base leading-relaxed lg:text-lg">{cue.text}</p>
          </div>
        {/each}
        {#if !state.cues.some(item => item.status === 'confirmed') && !state.announcements.some(item => item.visibleOnStage)}
          <p class="py-5 text-center text-sm text-teal-100/60">确认传译或发布通知后，现场可见内容将在这里出现。</p>
        {/if}
      </div>
    </section>

    <section class="rounded-2xl border bg-white shadow-sm">
      <div class="flex flex-wrap items-center justify-between gap-3 border-b px-4 py-3">
        <div><span class="text-[10px] font-black uppercase tracking-[.16em] text-slate-400">现场传译队列</span><h2 class="mt-1 font-bold">待确认与遗漏补充</h2></div>
        <div class="flex items-center gap-3 text-xs text-slate-500"><span>自动接入</span><button type="button" role="switch" aria-label="自动接入现场文字" aria-checked={state.liveSimulation} class="focus-ring h-6 w-11 rounded-full p-1 transition {state.liveSimulation ? 'bg-teal-600' : 'bg-slate-300'}" on:click={() => setLiveSimulation(!state.liveSimulation)}><span class="block h-4 w-4 rounded-full bg-white transition {state.liveSimulation ? 'translate-x-5' : ''}"></span></button></div>
      </div>
      <div class="max-h-[600px] space-y-2 overflow-y-auto p-3 scrollbar-thin">
        {#each state.cues as cue, index}
          <!-- svelte-ignore a11y_no_noninteractive_element_to_interactive_role -->
          <article role="button" tabindex="0" class="cue-enter cursor-pointer rounded-xl border p-3 transition {cue.id === state.activeCueId ? 'border-teal-600 bg-teal-50 shadow-md' : 'border-slate-200 bg-white hover:border-slate-300'}" on:click={() => selectCue(cue)} on:keydown={event => (event.key === 'Enter' || event.key === ' ') && selectCue(cue)}>
            <div class="flex flex-wrap items-start gap-3">
              <span class="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-slate-900 text-xs font-black text-white">{index + 1}</span>
              <div class="min-w-0 flex-1">
                <div class="mb-2 flex flex-wrap items-center gap-2 text-[10px] font-bold">
                  <span class="rounded-md bg-slate-100 px-2 py-1 text-slate-600">{speakerName(state.appliedSpeakers, cue.speakerId)}</span>
                  <span class="rounded-md border px-2 py-1 {delayClass(getDelay(cue, now))}">{formatTime(cue.receivedAt)} · 延迟 {getDelay(cue, now)}s</span>
                  <span class="rounded-md px-2 py-1 {cue.status === 'confirmed' ? 'bg-emerald-100 text-emerald-800' : cue.status === 'followup' ? 'bg-amber-100 text-amber-900' : 'bg-blue-100 text-blue-800'}">{statusLabel(cue.status)}</span>
                  <span class="rounded-md bg-teal-100 px-2 py-1 text-teal-800">术语表 v{cue.glossaryVersion}{cue.status === 'confirmed' ? ' · 已冻结' : ''}</span>
                  {#if cue.offline}<span class="rounded-md bg-amber-100 px-2 py-1 text-amber-900">离线暂存</span>{/if}
                  {#if cue.manual}<span class="rounded-md bg-slate-100 px-2 py-1 text-slate-600">手工</span>{/if}
                </div>
                <p class="text-sm leading-6 lg:text-base">{cue.text}</p>
                {#if cue.duplicateOf}
                  <div class="mt-2 flex items-center justify-between gap-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800">
                    <span><strong>疑似重复：</strong>与第 {state.cues.findIndex(item => item.id === cue.duplicateOf) + 1} 条高度相似</span>
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
        <div><span class="text-[10px] font-black uppercase tracking-[.16em] text-teal-700">当前口译位</span><h2 class="mt-1 font-bold">{activeSpeaker?.name || '等待队列'}</h2><p class="text-xs text-slate-500">{activeSpeaker?.language}</p></div>
        <div class="flex gap-1"><button class="focus-ring rounded-lg border px-2 py-1 text-xs" aria-label="上一条" on:click={() => moveCue(-1)}>↑</button><button class="focus-ring rounded-lg border px-2 py-1 text-xs" aria-label="下一条" on:click={() => moveCue(1)}>↓</button></div>
      </div>
      {#if activeCue}
        <div class="rounded-xl bg-slate-50 p-3"><p class="text-sm leading-6">{activeCue.text}</p><p class="mt-2 text-[10px] text-slate-500">快捷键：J / K 移动，C 确认，T 发送首条高优先术语提醒</p></div>
        <div class="mt-3 grid grid-cols-2 gap-2"><Button color="green" on:click={confirmActive}>确认已传 <kbd class="ml-1 text-[10px]">C</kbd></Button><Button color="light" on:click={() => manualInput?.focus()}>手工补充</Button></div>
        <label for="followup-input" class="mt-4 block text-[10px] font-black uppercase tracking-wider text-slate-500">遗漏补译</label>
        <textarea id="followup-input" class="focus-ring mt-2 w-full rounded-xl border p-3 text-sm" rows="3" bind:value={followup} placeholder="输入遗漏内容或修正术语…"></textarea>
        <Button class="mt-2 w-full" color="light" disabled={!followup.trim()} on:click={saveFollowup}>标记补充完成</Button>
      {/if}
    </section>

    <section class="rounded-2xl border bg-white p-4 shadow-sm">
      <div class="mb-3 flex items-center justify-between"><div><span class="text-[10px] font-black uppercase tracking-[.16em] text-slate-400">术语提醒</span><h2 class="mt-1 font-bold">当前发言人术语</h2></div><span class="rounded-full bg-emerald-100 px-2.5 py-1 text-xs font-black text-emerald-800">{activeTerms.length}</span></div>
      <p class="mb-2 text-[10px] text-slate-400">仅显示现场已应用的 v{state.appliedVersion} 术语表；中控草稿在下发并切换前不影响现场。</p>
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
        {#each state.reminders as reminder}
          <div class="flex items-center justify-between gap-2 rounded-lg px-3 py-2 text-xs {reminder.acknowledged ? 'bg-slate-50 text-slate-400' : 'bg-teal-50 text-teal-900'}">
            <span><strong>{reminder.target}</strong> · {formatTime(reminder.createdAt)}</span>
            {#if !reminder.acknowledged}<button class="font-bold underline" on:click={() => acknowledgeReminder(reminder.id)}>已看到</button>{/if}
          </div>
        {/each}
        {#if !state.reminders.length}<p class="py-4 text-center text-xs text-slate-400">尚未发送术语提醒。</p>{/if}
      </div>
    </section>

    <section class="rounded-2xl border bg-white p-4 shadow-sm">
      <div class="mb-3"><h2 class="font-bold">紧急通知上屏</h2><p class="text-xs text-slate-500">先存草稿，发布后才进入现场可见区。</p></div>
      <select class="focus-ring w-full rounded-xl border p-3 text-sm" bind:value={announcementLevel}><option value="info">信息提示</option><option value="warning">时间提醒</option><option value="urgent">紧急通知</option></select>
      <textarea class="focus-ring mt-3 w-full rounded-xl border p-3 text-sm" rows="2" bind:value={announcementText} placeholder="输入通知内容…"></textarea>
      <Button class="mt-3 w-full" disabled={!announcementText.trim()} on:click={createAnnouncement}>存为草稿</Button>
      <div class="mt-4 space-y-2">
        {#each state.announcements as announcement}
          <div class="rounded-xl border p-3 {announcement.visibleOnStage ? 'border-orange-300 bg-orange-50' : 'border-slate-200 bg-slate-50'}">
            <div class="flex items-center justify-between gap-3"><span class="rounded-full bg-white px-2 py-1 text-[10px] font-bold">{announcement.level === 'urgent' ? '紧急' : announcement.level === 'warning' ? '提醒' : '信息'}</span><span class="text-[10px] font-bold {announcement.visibleOnStage ? 'text-orange-700' : 'text-slate-500'}">{announcement.visibleOnStage ? '现场可见' : '草稿'}</span></div>
            <p class="my-2 text-sm font-bold">{announcement.text}</p>
            <Button size="xs" color={announcement.visibleOnStage ? 'light' : 'yellow'} on:click={() => publishAnnouncement(announcement.id, !announcement.visibleOnStage)}>{announcement.visibleOnStage ? '撤下现场' : '发布到现场'}</Button>
          </div>
        {/each}
      </div>
    </section>
  </div>
</div>

<!-- 手工录入入口（离线也可录入，见“离线暂存”页） -->
<section class="mt-4 rounded-2xl border border-dashed border-slate-300 bg-white/60 p-4">
  <div class="mb-2 flex items-center justify-between gap-3">
    <div><h2 class="font-bold">手工录入现场文字</h2><p class="text-xs text-slate-500">Ctrl + Enter 提交；断网时自动暂存本机。</p></div>
    <span class="rounded-full px-3 py-1 text-xs font-bold {$online ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-900'}">{$online ? '在线' : '离线暂存'}</span>
  </div>
  <label class="text-xs font-bold">发言人
    <select class="focus-ring mt-2 w-full rounded-xl border p-3" bind:value={manualSpeakerId}><option value="">跟随当前发言人</option>{#each state.appliedSpeakers as speaker}<option value={speaker.id}>{speaker.name}</option>{/each}</select>
  </label>
  <textarea bind:this={manualInput} class="focus-ring mt-3 w-full rounded-xl border p-4 text-base leading-7" rows="3" bind:value={manualText} placeholder="输入现场文字…" on:keydown={event => { if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') submitManual() }}></textarea>
  <Button class="mt-3 w-full" size="lg" disabled={!manualText.trim()} on:click={submitManual}>加入队列</Button>
</section>
