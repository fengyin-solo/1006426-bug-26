import { SEED_REVIEW_ITEMS, SEED_ROWS } from './seed'
import type { EntryRow, ReviewItem } from './types'

// 本地持久化：业务批次和环保待复核清单各占一个 localStorage 键，刷新、关掉再打开都还在。
const STORAGE_KEY = 'waste-to-energy-plant:entries'
const REVIEW_KEY = 'waste-to-energy-plant:review-queue'

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

function readStorage(): Record<string, EntryRow[]> {
  const fallback = clone(SEED_ROWS)
  if (typeof window === 'undefined' || !window.localStorage) {
    return fallback
  }
  const raw = window.localStorage.getItem(STORAGE_KEY)
  if (!raw) {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(fallback))
    return fallback
  }
  try {
    const parsed = JSON.parse(raw) as Record<string, EntryRow[]>
    return { ...fallback, ...parsed }
  } catch {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(fallback))
    return fallback
  }
}

let cache: Record<string, EntryRow[]> | null = null

export function allRows(): Record<string, EntryRow[]> {
  if (cache === null) {
    cache = readStorage()
  }
  return cache
}

export function listRows(key: string): EntryRow[] {
  return allRows()[key] ?? []
}

export function saveRows(key: string, rows: EntryRow[]): void {
  const next = { ...allRows(), [key]: rows }
  cache = next
  if (typeof window !== 'undefined' && window.localStorage) {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
  }
}

export function resetRows(key: string): EntryRow[] {
  const rows = clone(SEED_ROWS[key] ?? [])
  saveRows(key, rows)
  return rows
}

export function storageKey(): string {
  return STORAGE_KEY
}

function readReviewStorage(): ReviewItem[] {
  const fallback = clone(SEED_REVIEW_ITEMS)
  if (typeof window === 'undefined' || !window.localStorage) {
    return fallback
  }
  const raw = window.localStorage.getItem(REVIEW_KEY)
  if (!raw) {
    window.localStorage.setItem(REVIEW_KEY, JSON.stringify(fallback))
    return fallback
  }
  try {
    return JSON.parse(raw) as ReviewItem[]
  } catch {
    window.localStorage.setItem(REVIEW_KEY, JSON.stringify(fallback))
    return fallback
  }
}

let reviewCache: ReviewItem[] | null = null

export function listReviews(): ReviewItem[] {
  if (reviewCache === null) {
    reviewCache = readReviewStorage()
  }
  return reviewCache
}

export function saveReviews(items: ReviewItem[]): void {
  reviewCache = items
  if (typeof window !== 'undefined' && window.localStorage) {
    window.localStorage.setItem(REVIEW_KEY, JSON.stringify(items))
  }
}
