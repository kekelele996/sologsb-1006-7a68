import type { Cue, Term } from './types'

export function clone<T>(value: T): T {
  return structuredClone(value)
}

/** 基于当前术语表为段落抽取命中的术语译法标签。 */
export function detectTerms(text: string, terms: Term[]): string[] {
  const lower = text.toLowerCase()
  return terms
    .filter(term => lower.includes(term.source.toLowerCase()) || lower.includes(term.target))
    .map(term => term.target)
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

export function speakerName(speakers: { id: string; name: string }[], id: string): string {
  return speakers.find(item => item.id === id)?.name || '未指定'
}

export function termTarget(terms: Term[], id: string): string {
  return terms.find(item => item.id === id)?.target || ''
}
