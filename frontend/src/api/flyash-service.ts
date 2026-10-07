import { listReviews, listRows, saveReviews, saveRows } from '@/data/local-store'
import type { ActionResult, EntryRow, InspectionRecord, ReviewItem } from '@/data/types'

// 飞灰固化状态线：待固化 → 固化中 → 已检测 →（不合格）需返工 →（复检）已检测。
// 这里是唯一能改飞灰批次状态的地方，每次流转都校验「当前状态」而不是只认动作名。
export const FLYASH_KEY = 'flyash'
export const FLYASH_STATUSES = ['待固化', '固化中', '已检测', '需返工'] as const

export const FLYASH_ACTIONS = {
  submit: '提交固化',
  inspect: '确认检测',
  rework: '要求返工',
  reinspect: '提交复检',
} as const

export type FlyashPayload = {
  conclusion?: string
  reason?: string
  inspector?: string
}

export type FlyashDraft = {
  固化编号: string
  飞灰来源: string
  螯合剂用量: string
  水泥用量: string
  固化块批次: string
  操作人员: string
}

function nowText(): string {
  const pad = (value: number) => String(value).padStart(2, '0')
  const d = new Date()
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function inspectionHistory(row: EntryRow): InspectionRecord[] {
  const records = row['检测记录']
  return Array.isArray(records) ? (records as InspectionRecord[]) : []
}

function findBatch(rows: EntryRow[], id: number): number {
  return rows.findIndex((row) => Number(row.id) === id)
}

function persist(rows: EntryRow[], index: number, next: EntryRow): void {
  const updated = [...rows]
  updated[index] = next
  saveRows(FLYASH_KEY, updated)
}

// 同一固化编号在待复核清单里只保留一条：复检结论覆盖首次检测结论。
function upsertReview(next: EntryRow, record: InspectionRecord, source: string): void {
  const items = listReviews()
  const code = String(next['固化编号'] ?? '')
  const existing = items.findIndex((item) => item.固化编号 === code)
  const review: ReviewItem = {
    id: existing >= 0 ? items[existing].id : items.reduce((max, item) => Math.max(max, item.id), 0) + 1,
    batchId: Number(next.id),
    固化编号: code,
    监控指标: '飞灰固化物浸出毒性',
    实测值: '',
    达标判定: '',
    来源: source,
    检测结论: record.conclusion,
    检测人员: record.inspector,
    检测时间: record.time,
    复核状态: '待复核',
  }
  if (existing >= 0) {
    items[existing] = review
  } else {
    items.push(review)
  }
  saveReviews(items)
}

// 判返工：这条固化编号还没复核通过，检测结论要从待复核清单撤下。
function removeReview(code: string): void {
  saveReviews(listReviews().filter((item) => item.固化编号 !== code))
}

// 待复核清单是 flyash 检测结论的投影，读的时候顺手对账，保证两边永远是同一份状态。
export function reconcileReviews(): ReviewItem[] {
  const items = listReviews()
  const rows = listRows(FLYASH_KEY)
  const valid = items.filter((item) => {
    const row = rows.find((entry) => Number(entry.id) === item.batchId)
    if (!row || String(row.status) !== '已检测') {
      return false
    }
    const history = inspectionHistory(row)
    const latest = history[history.length - 1]
    return Boolean(latest) && latest.conclusion === item.检测结论 && latest.time === item.检测时间
  })
  if (valid.length !== items.length) {
    saveReviews(valid)
  }
  return valid
}

// 登记新批次：同一条固化编号不许报两回。
export function createFlyashBatch(draft: FlyashDraft): ActionResult {
  const code = draft.固化编号.trim()
  if (!code) {
    return { ok: false, message: '固化编号不能为空' }
  }
  const rows = listRows(FLYASH_KEY)
  if (rows.some((row) => String(row['固化编号'] ?? '').trim() === code)) {
    return { ok: false, message: `固化编号「${code}」已登记过，同一条固化编号不许重复报送` }
  }
  const id = rows.reduce((max, row) => Math.max(max, Number(row.id)), 0) + 1
  const row: EntryRow = {
    id,
    status: '待固化',
    pending: true,
    abnormal: false,
    固化编号: code,
    飞灰来源: draft.飞灰来源.trim(),
    螯合剂用量: draft.螯合剂用量.trim(),
    水泥用量: draft.水泥用量.trim(),
    固化块批次: draft.固化块批次.trim(),
    检测结果: '',
    操作人员: draft.操作人员.trim() || '值班管理员',
    // 「固化状态」这个业务字段与 status 始终保持一致，列表、详情读到的就是同一条状态。
    固化状态: '待固化',
    返工理由: '',
    检测记录: [],
  }
  saveRows(FLYASH_KEY, [...rows, row])
  return { ok: true, message: `飞灰固化批次「${code}」已登记，当前状态「待固化」` }
}

export function runFlyashAction(id: number, action: string, payload: FlyashPayload = {}): ActionResult {
  const rows = listRows(FLYASH_KEY)
  const index = findBatch(rows, id)
  if (index < 0) {
    return { ok: false, message: `没有找到编号为 ${id} 的飞灰固化批次` }
  }
  const current = rows[index]
  const status = String(current.status)

  if (action === FLYASH_ACTIONS.submit) {
    if (status !== '待固化') {
      return { ok: false, message: `当前是「${status}」，只有待固化的批次才能提交固化，不能跳过固化步骤` }
    }
    const next: EntryRow = { ...current, status: '固化中', pending: true, abnormal: false, 固化状态: '固化中' }
    persist(rows, index, next)
    return { ok: true, message: `批次已提交固化，当前状态「固化中」` }
  }

  if (action === FLYASH_ACTIONS.inspect) {
    // 待固化直接检测要拦住：必须先落在「固化中」这个中间态。
    if (status === '待固化') {
      return { ok: false, message: '批次还在待固化，必须先提交固化进入「固化中」，不能跳过固化直接检测' }
    }
    if (status === '已检测') {
      return { ok: false, message: '批次已经检测完成，已检测的批次不能再回到固化中或重复检测' }
    }
    if (status === '需返工') {
      return { ok: false, message: '批次已判定返工，必须先走「提交复检」并通过复检，不能直接重新检测' }
    }
    const conclusion = (payload.conclusion ?? '').trim()
    if (!conclusion) {
      return { ok: false, message: '检测结论还没出，不能确认检测：请先填写检测结论' }
    }
    const record: InspectionRecord = {
      round: 1,
      conclusion,
      inspector: (payload.inspector ?? '').trim() || String(current['操作人员'] ?? '值班管理员'),
      time: nowText(),
    }
    const next: EntryRow = {
      ...current,
      status: '已检测',
      pending: false,
      abnormal: false,
      检测结果: conclusion,
      固化状态: '已检测',
      返工理由: '',
      检测记录: [record],
    }
    persist(rows, index, next)
    upsertReview(next, record, '首次检测')
    return { ok: true, message: '检测结论已登记，当前状态「已检测」，结论已转入环保监控待复核清单' }
  }

  if (action === FLYASH_ACTIONS.rework) {
    if (status !== '已检测') {
      return { ok: false, message: `当前是「${status}」，只有已检测的批次能判定返工` }
    }
    const reason = (payload.reason ?? '').trim()
    if (!reason) {
      return { ok: false, message: '退回必须写明返工理由，不能无理由把批次退回' }
    }
    const next: EntryRow = {
      ...current,
      status: '需返工',
      pending: true,
      abnormal: true,
      // 判返工清空上次填的检测结论，只留下「需返工·待复检」这个中间态。
      检测结果: '',
      固化状态: '需返工',
      返工理由: reason,
    }
    persist(rows, index, next)
    removeReview(String(next['固化编号'] ?? ''))
    return { ok: true, message: '已判定返工，上次检测结论已清空，等待复检' }
  }

  if (action === FLYASH_ACTIONS.reinspect) {
    if (status !== '需返工') {
      return { ok: false, message: `当前是「${status}」，只有需返工的批次才能提交复检` }
    }
    const conclusion = (payload.conclusion ?? '').trim()
    if (!conclusion) {
      return { ok: false, message: '复检必须填写复检结论' }
    }
    const history = inspectionHistory(current)
    const record: InspectionRecord = {
      round: history.length + 1,
      conclusion,
      inspector: (payload.inspector ?? '').trim() || String(current['操作人员'] ?? '值班管理员'),
      time: nowText(),
    }
    const next: EntryRow = {
      ...current,
      status: '已检测',
      pending: false,
      abnormal: false,
      检测结果: conclusion,
      固化状态: '已检测',
      返工理由: '',
      检测记录: [...history, record],
    }
    persist(rows, index, next)
    // 复检结论与首次检测冲突时，待复核清单按固化编号覆盖，以最近一次复检结果为准。
    upsertReview(next, record, record.round === 1 ? '首次检测' : `第${record.round - 1}次复检`)
    return { ok: true, message: '复检结论已登记，当前状态「已检测」，最新复检结论已转入待复核清单' }
  }

  return { ok: false, message: `飞灰固化批次没有登记「${action}」这个动作` }
}
