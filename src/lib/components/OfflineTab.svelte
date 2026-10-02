<script lang="ts">
  import Button from 'flowbite-svelte/Button.svelte'
  import { deleteCue, siteStore, updateCue } from '$lib/siteStore'
  import { online, setOnline } from '$lib/netStore'
  import { speakerName } from '$lib/utils'

  $: state = $siteStore
  $: offlineCues = state.cues.filter(item => item.offline)

  function formatTime(timestamp: number) {
    return new Date(timestamp).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })
  }
</script>

<div class="mb-5 flex flex-wrap items-end justify-between gap-3">
  <div>
    <p class="text-[10px] font-black uppercase tracking-[.18em] text-amber-700">断网继续工作 · 恢复后合并</p>
    <h1 class="mt-1 text-3xl font-black">离线暂存</h1>
    <p class="mt-2 max-w-2xl text-sm text-slate-500">
      网络中断时现场照常手工录入、确认与上屏，内容暂存本机并带“离线”标记。恢复连接后自动合并回现场队列并重新执行重复检查；
      中控下发的新版本则按回执对账，只补未同步条目。
    </p>
  </div>
  <Button color={$online ? 'light' : 'green'} on:click={() => setOnline(!$online)}>
    {$online ? '模拟断网' : '恢复网络并合并'}
  </Button>
</div>

<section class="rounded-2xl border bg-white p-5 shadow-sm">
  <div class="mb-4 flex flex-wrap items-center justify-between gap-3">
    <div><h2 class="font-black">本机暂存条目</h2><p class="text-xs text-slate-500">当前有 {offlineCues.length} 条离线条目。</p></div>
    <span class="rounded-full px-3 py-1 text-xs font-bold {$online ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-900'}">{$online ? '在线 · 已自动合并' : '离线 · 暂存本机'}</span>
  </div>
  <div class="space-y-3">
    {#each offlineCues as cue}
      <article class="rounded-xl border border-dashed border-amber-300 bg-amber-50/60 p-4">
        <div class="flex items-center justify-between text-[10px] font-bold text-amber-800">
          <span>本机暂存 · {formatTime(cue.receivedAt)}</span>
          <span>{speakerName(state.appliedSpeakers, cue.speakerId)} · 术语表 v{cue.glossaryVersion}</span>
        </div>
        <textarea class="focus-ring mt-3 w-full rounded-xl border border-amber-200 bg-white p-3 text-sm" rows="3" value={cue.text} on:change={event => updateCue(cue.id, { text: (event.target as HTMLTextAreaElement).value })}></textarea>
        <div class="mt-2 flex justify-between">
          <span class="text-[10px] text-amber-800">恢复网络后自动进入现场队列</span>
          <button class="text-xs font-bold text-red-700 underline" on:click={() => deleteCue(cue.id)}>删除暂存</button>
        </div>
      </article>
    {/each}
    {#if !offlineCues.length}
      <div class="grid min-h-60 place-items-center rounded-xl bg-slate-50 text-center">
        <div>
          <div class="mx-auto grid h-14 w-14 place-items-center rounded-full bg-emerald-100 text-2xl text-emerald-700">✓</div>
          <strong class="mt-3 block text-sm">没有离线暂存条目</strong>
          <p class="mt-1 text-xs text-slate-500">可点击右上角“模拟断网”，再到现场页手工录入来测试。</p>
        </div>
      </div>
    {/if}
  </div>
</section>
