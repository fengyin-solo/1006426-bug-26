import { MODULE_BY_KEY } from '@/data/modules'
import { allRows, listRows, resetRows, saveRows } from '@/data/local-store'
import type { ActionPayload, ActionResult, EntryRow, ModuleMeta, OverviewResult, PageResult } from '@/data/types'

// 会写进数据的「往回走」动作：命中就把这条记录标成异常态，看板上能一眼看出来。
const NEGATIVE_ACTIONS = ['撤销', '作废', '拒绝', '驳回', '停用', '忽略', '下线', '回滚']

const FLYASH_KEY = 'flyash'
const EMISSION_KEY = 'emission'
// 飞灰检测结论进环保监控后挂的待复核状态，以及标记来源用的字段。
const REVIEW_STATUS = '待复核'
const SOURCE_FIELD = '来源模块'

// 飞灰固化状态线：固化编号下的批次只能沿这条线走，回退与返工必须走明确的入口。
const FLYASH = {
  待固化: ['提交固化'],
  固化中: ['确认检测'],
  已检测: ['要求返工', '归档'],
  需返工: ['提交复检'],
  待复检: ['确认复检'],
  已归档: [] as string[],
} as const

function normalizeFlyashRow(row: EntryRow): EntryRow {
  // 旧数据里固化状态字段可能是占位文案甚至与 status 不一致：以 status 为唯一真相，
  // 列表与详情都读这里，保证同一条固化编号看到的是同一个状态。
  if (row['固化状态'] !== undefined && row['固化状态'] !== row.status) {
    const next = { ...row, 固化状态: row.status }
    return next
  }
  return row
}

export function moduleMeta(key: string): ModuleMeta {
  const meta = MODULE_BY_KEY.get(key)
  if (!meta) {
    throw new Error(`没有登记名为 ${key} 的业务模块`)
  }
  return meta
}

export function filterRows(rows: EntryRow[], filters: Record<string, string>): EntryRow[] {
  const pairs = Object.entries(filters).filter(([, value]) => value.trim() !== '')
  if (pairs.length === 0) {
    return rows
  }
  return rows.filter((row) =>
    pairs.every(([field, value]) => String(row[field] ?? '').includes(value.trim())),
  )
}

export function listEntries(key: string, filters: Record<string, string> = {}): PageResult {
  const source = listRows(key)
  const rows = key === FLYASH_KEY ? source.map(normalizeFlyashRow) : source
  const matched = filterRows(rows, filters)
  return { items: matched, total: matched.length, page: 1, size: matched.length }
}

// 详情与列表读同一份持久化数据，同一条固化编号不会出现两个状态。
export function getEntry(key: string, id: number): EntryRow | undefined {
  const row = listRows(key).find((item) => Number(item.id) === id)
  return row && key === FLYASH_KEY ? normalizeFlyashRow(row) : row
}

function today(): string {
  return new Date().toISOString().slice(0, 10)
}

// 把检测结论落到环保监控的待复核清单：同一固化编号只占一条，复检覆盖首检。
function pushReviewQueue(row: EntryRow, conclusion: string): void {
  const rows = listRows(EMISSION_KEY)
  const code = String(row['固化编号'] ?? '')
  const index = rows.findIndex(
    (item) => String(item[SOURCE_FIELD] ?? '') === FLYASH_KEY && String(item['监控编号'] ?? '') === code,
  )
  const review: EntryRow = {
    id: index >= 0 ? rows[index].id : Math.max(0, ...rows.map((item) => Number(item.id) || 0)) + 1,
    status: REVIEW_STATUS,
    pending: true,
    abnormal: false,
    监控编号: code,
    监控指标: '飞灰固化浸出毒性（固化批次检测结论）',
    限值要求: '按危险废物鉴别标准复核',
    实测值: conclusion,
    达标判定: '待环保复核',
    监控日期: today(),
    监控人员: String(row['操作人员'] ?? ''),
    [SOURCE_FIELD]: FLYASH_KEY,
  }
  if (index >= 0) {
    const next = [...rows]
    next[index] = review
    saveRows(EMISSION_KEY, next)
  } else {
    saveRows(EMISSION_KEY, [...rows, review])
  }
}

// 判返工即撤回该编号在待复核清单里的结论，复检通过后再按最新结论重报，杜绝报两回。
function pullReviewQueue(row: EntryRow): void {
  const code = String(row['固化编号'] ?? '')
  const rows = listRows(EMISSION_KEY)
  const next = rows.filter(
    (item) =>
      !(String(item[SOURCE_FIELD] ?? '') === FLYASH_KEY && String(item['监控编号'] ?? '') === code),
  )
  if (next.length !== rows.length) {
    saveRows(EMISSION_KEY, next)
  }
}

function runFlyashAction(
  meta: ModuleMeta,
  id: number,
  action: string,
  payload: ActionPayload = {},
): ActionResult {
  const rows = listRows(FLYASH_KEY)
  const index = rows.findIndex((row) => Number(row.id) === id)
  if (index < 0) {
    return { ok: false, message: `没有找到编号为 ${id} 的${meta.entity}` }
  }
  const row = normalizeFlyashRow(rows[index])
  const current = String(row.status)
  const allowed = (FLYASH as Record<string, readonly string[]>)[current]
  if (!allowed || !allowed.includes(action)) {
    return {
      ok: false,
      message: `「${current}」状态的${meta.entity}不能执行「${action}」，请按待固化 → 固化中 → 已检测 → 需返工 → 待复检的顺序流转`,
    }
  }

  const target = meta.actionTargets[action]
  const updated: EntryRow = { ...row, status: target }

  if (action === '确认检测' || action === '确认复检') {
    const conclusion = String(payload.conclusion ?? '').trim()
    if (!conclusion) {
      return { ok: false, message: action === '确认复检' ? '复检必须填写复检结论' : '检测结论还没出，不能确认检测' }
    }
    // 复检结论与首次检测冲突时，以最近一次复检结果为准：直接覆盖检测结果与待复核清单。
    updated['检测结果'] = conclusion
    updated['返工理由'] = ''
    updated.pending = false
    updated.abnormal = false
    saveRows(FLYASH_KEY, [...rows.slice(0, index), updated, ...rows.slice(index + 1)])
    pushReviewQueue(updated, conclusion)
    return {
      ok: true,
      message: `${meta.entity}已${action}，当前状态「${target}」，检测结论已进入环保监控待复核清单`,
    }
  }

  if (action === '要求返工') {
    const reason = String(payload.reason ?? '').trim()
    if (!reason) {
      return { ok: false, message: '退回必须写明返工理由' }
    }
    // 判返工时清空上次填入的检测结论，只保留待复检的中间态入口。
    updated['检测结果'] = ''
    updated['返工理由'] = reason
    updated.pending = true
    updated.abnormal = true
    saveRows(FLYASH_KEY, [...rows.slice(0, index), updated, ...rows.slice(index + 1)])
    pullReviewQueue(updated)
    return { ok: true, message: `${meta.entity}已判返工，当前状态「${target}」，原检测结论已清空，请安排复检` }
  }

  if (action === '归档') {
    updated.pending = false
    updated.abnormal = false
  } else {
    // 提交固化、提交复检：进入中间态，待后续确认。
    updated.pending = true
    updated.abnormal = false
  }
  saveRows(FLYASH_KEY, [...rows.slice(0, index), updated, ...rows.slice(index + 1)])
  return { ok: true, message: `${meta.entity}已${action}，当前状态「${target}」` }
}

export function runAction(key: string, id: number, action: string, payload: ActionPayload = {}): ActionResult {
  const meta = moduleMeta(key)
  if (key === FLYASH_KEY) {
    return runFlyashAction(meta, id, action, payload)
  }
  const target = meta.actionTargets[action]
  if (!target) {
    return { ok: false, message: `${meta.entity}没有登记「${action}」这个动作` }
  }
  const rows = listRows(key)
  const index = rows.findIndex((row) => Number(row.id) === id)
  if (index < 0) {
    return { ok: false, message: `没有找到编号为 ${id} 的${meta.entity}` }
  }
  // 环保待复核清单里由飞灰检测结论生成的记录只供复核查看，不能在监控页被普通动作改状态。
  if (key === EMISSION_KEY && String(rows[index][SOURCE_FIELD] ?? '') === FLYASH_KEY) {
    return { ok: false, message: '该记录来自飞灰固化检测结论，请在飞灰固化处置页处理，不能直接改状态' }
  }
  const current = String(rows[index].status)
  if (current === target) {
    return { ok: false, message: `${meta.entity}已经是「${target}」，不用重复操作` }
  }
  if (current === REVIEW_STATUS) {
    return { ok: false, message: `${meta.entity}处于「${REVIEW_STATUS}」，请先完成复核` }
  }
  const lastStatus = meta.statuses[meta.statuses.length - 1]
  const updated: EntryRow = {
    ...rows[index],
    status: target,
    pending: target !== lastStatus,
    abnormal: NEGATIVE_ACTIONS.some((verb) => action.startsWith(verb)),
  }
  const next = [...rows]
  next[index] = updated
  saveRows(key, next)
  return { ok: true, message: `${meta.entity}已${action}，当前状态「${target}」` }
}

export function resetModule(key: string): PageResult {
  resetRows(key)
  return listEntries(key)
}

export function exportEntries(key: string): { filename: string; content: string } {
  const meta = moduleMeta(key)
  const header = ['编号', ...meta.fields, '当前状态']
  const lines = [header.join(',')]
  for (const row of listEntries(key).items) {
    lines.push([row.id, ...meta.fields.map((field) => row[field] ?? ''), row.status].join(','))
  }
  return { filename: `${meta.name}-清单.csv`, content: `﻿${lines.join('\n')}` }
}

export function downloadEntries(key: string): void {
  const { filename, content } = exportEntries(key)
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  document.body.appendChild(anchor)
  anchor.click()
  document.body.removeChild(anchor)
  URL.revokeObjectURL(url)
}

// 环保监控的待复核清单：飞灰检测/复检结论落在这里，同编号只保留最新一条。
export function reviewQueue(): EntryRow[] {
  return listRows(EMISSION_KEY).filter(
    (row) => String(row.status) === REVIEW_STATUS && String(row[SOURCE_FIELD] ?? '') === FLYASH_KEY,
  )
}

export function loadOverview(): OverviewResult {
  const rows = allRows()
  const modules = [...MODULE_BY_KEY.values()].map((meta) => {
    const entries = rows[meta.key] ?? []
    return {
      name: meta.name,
      created: entries.length,
      pending: entries.filter((row) => row.pending).length,
      abnormal: entries.filter((row) => row.abnormal).length,
    }
  })
  const cards = [
    { label: '业务模块', value: modules.length },
    { label: '登记总量', value: modules.reduce((sum, item) => sum + item.created, 0) },
    { label: '待处理', value: modules.reduce((sum, item) => sum + item.pending, 0) },
    { label: '异常量', value: modules.reduce((sum, item) => sum + item.abnormal, 0) },
  ]
  return { cards, modules }
}
