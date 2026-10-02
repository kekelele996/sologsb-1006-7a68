<script lang="ts">
  import Button from 'flowbite-svelte/Button.svelte'
  import {
    addSession, addSpeaker, addTerm, controlStore, publishVersion, reconcile,
    updateSession, updateSpeaker, updateTerm
  } from '$lib/controlStore'
  import { online } from '$lib/netStore'
  import type { Session, Term, VersionStatus } from '$lib/types'

  $: state = $controlStore
  $: versions = state.versions

  function statusMeta(status: VersionStatus) {
    if (status === 'delivered') return { label: '已送达现场', cls: 'bg-emerald-100 text-emerald-800' }
    if (status === 'pushing') return { label: '下发中…', cls: 'bg-blue-100 text-blue-800' }
    return { label: '部分送达 · 待对账', cls: 'bg-amber-100 text-amber-900' }
  }
  function deliveredCount(entries: { delivered: boolean }[]) {
    return entries.filter(e => e.delivered).length
  }
  function formatTime(iso: string) {
    return new Date(iso).toLocaleTimeString('zh-CN', { hour12: false })
  }
</script>

<div class="mb-5 flex flex-wrap items-end justify-between gap-3">
  <div>
    <p class="text-[10px] font-black uppercase tracking-[.18em] text-teal-700">中控 · 议程与术语表</p>
    <h1 class="mt-1 text-3xl font-black">准备议程、发言人与术语表</h1>
    <p class="mt-2 max-w-2xl text-sm text-slate-500">
      中控只负责议程与术语表草稿；改完请<strong class="text-slate-700">下发新版本</strong>。现场收到完整版本后才切换，
      已确认上屏的段落保留当时译法，新版本只作用于未确认条目。下发中断网时现场照旧干活，恢复后按回执对账、只补未同步条目。
    </p>
  </div>
  <Button size="lg" color="green" on:click={publishVersion}>下发新版本</Button>
</div>

<!-- 下发记录与回执对账 -->
<section class="mb-6 rounded-2xl border bg-white p-4 shadow-sm">
  <div class="mb-3 flex items-center justify-between">
    <div><h2 class="font-black">版本下发与回执</h2><p class="text-xs text-slate-500">逐条下发，现场收到即记回执；已回执条目不会重复下发。</p></div>
    <span class="rounded-full px-3 py-1 text-xs font-bold {$online ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-900'}">{$online ? '网络在线' : '网络中断 · 下发挂起'}</span>
  </div>
  {#if versions.length}
    <div class="space-y-3">
      {#each versions as version}
        {@const meta = statusMeta(version.status)}
        <article class="rounded-xl border p-3 {version.status === 'partial' ? 'border-amber-300 bg-amber-50/60' : 'border-slate-200'}">
          <div class="flex flex-wrap items-center justify-between gap-3">
            <div class="flex items-center gap-3">
              <strong class="text-sm">术语表 v{version.number}</strong>
              <span class="rounded-full px-2 py-0.5 text-[10px] font-black {meta.cls}">{meta.label}</span>
              <span class="text-[11px] text-slate-500">{formatTime(version.publishedAt)} 下发</span>
            </div>
            <div class="flex items-center gap-3">
              <span class="text-xs font-bold text-slate-600">已回执 {deliveredCount(version.entries)}/{version.entries.length} 条</span>
              {#if version.status === 'partial'}
                <Button size="xs" color="yellow" disabled={!$online} on:click={() => reconcile(version.id)}>对账并补下发</Button>
              {/if}
            </div>
          </div>
          <div class="mt-2 flex flex-wrap gap-1.5">
            {#each version.entries as entry}
              <span class="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold {entry.delivered ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-100 text-slate-400'}">
                <span class="h-1.5 w-1.5 rounded-full {entry.delivered ? 'bg-emerald-500' : 'bg-slate-300'}"></span>{entry.target}
              </span>
            {/each}
          </div>
        </article>
      {/each}
    </div>
  {:else}
    <p class="rounded-xl bg-slate-50 py-6 text-center text-xs text-slate-400">尚未下发过版本。编辑下方术语表后点击“下发新版本”。</p>
  {/if}
</section>

<div class="grid gap-4 xl:grid-cols-[1.3fr_.7fr]">
  <section class="rounded-2xl border bg-white p-4 shadow-sm">
    <div class="mb-4 flex items-center justify-between">
      <div><h2 class="font-black">演讲顺序</h2><p class="text-xs text-slate-500">议程为中控持有，随版本一并下发。</p></div>
      <Button size="sm" on:click={addSession}>新增场次</Button>
    </div>
    <div class="space-y-3">
      {#each state.sessions.sort((a, b) => a.order - b.order) as session}
        <article class="grid gap-3 rounded-xl border p-3 md:grid-cols-[80px_1fr_190px_120px]">
          <input class="focus-ring rounded-lg border px-2 py-2 text-sm font-bold" type="time" value={session.time} on:change={event => updateSession(session.id, { time: (event.target as HTMLInputElement).value })} />
          <div><input class="focus-ring w-full rounded-lg border px-3 py-2 font-bold" value={session.title} on:change={event => updateSession(session.id, { title: (event.target as HTMLInputElement).value })} /><span class="mt-1 block text-[10px] text-slate-500">{session.room}</span></div>
          <select class="focus-ring rounded-lg border px-2" value={session.speakerId} on:change={event => updateSession(session.id, { speakerId: (event.target as HTMLSelectElement).value })}>{#each state.speakers as speaker}<option value={speaker.id}>{speaker.name}</option>{/each}</select>
          <select class="focus-ring rounded-lg border px-2" value={session.status} on:change={event => updateSession(session.id, { status: (event.target as HTMLSelectElement).value as Session['status'] })}><option value="upcoming">未开始</option><option value="live">进行中</option><option value="done">已结束</option></select>
        </article>
      {/each}
    </div>
  </section>

  <section class="rounded-2xl border bg-white p-4 shadow-sm">
    <div class="mb-4 flex items-center justify-between">
      <div><h2 class="font-black">发言人</h2><p class="text-xs text-slate-500">语气、语言方向与标识颜色。</p></div>
      <Button size="sm" color="light" on:click={addSpeaker}>新增</Button>
    </div>
    <div class="space-y-3">
      {#each state.speakers as speaker}
        <div class="rounded-xl border p-3">
          <div class="flex items-center gap-2"><input class="focus-ring h-8 w-8 rounded-lg border-0 p-1" type="color" value={speaker.color} aria-label="标识颜色" on:change={event => updateSpeaker(speaker.id, { color: (event.target as HTMLInputElement).value })} /><input class="focus-ring min-w-0 flex-1 rounded-lg border px-3 py-2 font-bold" value={speaker.name} on:change={event => updateSpeaker(speaker.id, { name: (event.target as HTMLInputElement).value })} /></div>
          <input class="focus-ring mt-2 w-full rounded-lg border px-3 py-2 text-xs" value={speaker.title} on:change={event => updateSpeaker(speaker.id, { title: (event.target as HTMLInputElement).value })} />
          <input class="focus-ring mt-2 w-full rounded-lg border px-3 py-2 text-xs" value={speaker.language} on:change={event => updateSpeaker(speaker.id, { language: (event.target as HTMLInputElement).value })} />
        </div>
      {/each}
    </div>
  </section>
</div>

<section class="mt-4 overflow-hidden rounded-2xl border bg-white shadow-sm">
  <div class="flex items-center justify-between border p-4">
    <div><h2 class="font-black">术语表草稿</h2><p class="text-xs text-slate-500">此处修改不会影响现场；下发新版本并由现场切换后才生效。</p></div>
    <Button size="sm" on:click={addTerm}>新增术语</Button>
  </div>
  <div class="overflow-x-auto">
    <table class="w-full min-w-[760px] text-left text-xs">
      <thead class="bg-slate-50 uppercase tracking-wider text-slate-500"><tr><th class="p-3">原文</th><th class="p-3">指定译法</th><th class="p-3">说明</th><th class="p-3">发言人</th><th class="p-3">优先级</th></tr></thead>
      <tbody>
        {#each state.terms as term}
          <tr class="border-t">
            <td class="p-2"><input class="focus-ring w-full rounded border px-2 py-2" value={term.source} on:change={event => updateTerm(term.id, { source: (event.target as HTMLInputElement).value })} /></td>
            <td class="p-2"><input class="focus-ring w-full rounded border px-2 py-2 font-bold" value={term.target} on:change={event => updateTerm(term.id, { target: (event.target as HTMLInputElement).value })} /></td>
            <td class="p-2"><input class="focus-ring w-full rounded border px-2 py-2" value={term.note} on:change={event => updateTerm(term.id, { note: (event.target as HTMLInputElement).value })} /></td>
            <td class="p-2"><select class="focus-ring rounded border px-2 py-2" value={term.speakerId} on:change={event => updateTerm(term.id, { speakerId: (event.target as HTMLSelectElement).value })}>{#each state.speakers as speaker}<option value={speaker.id}>{speaker.name}</option>{/each}</select></td>
            <td class="p-2"><select class="focus-ring rounded border px-2 py-2" value={term.priority} on:change={event => updateTerm(term.id, { priority: (event.target as HTMLSelectElement).value as Term['priority'] })}><option value="normal">常规</option><option value="high">高优先</option></select></td>
          </tr>
        {/each}
      </tbody>
    </table>
  </div>
</section>
