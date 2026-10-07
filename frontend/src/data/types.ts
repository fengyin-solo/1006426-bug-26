/** 纯前端数据层的公共类型：与全栈版后端返回的结构保持一致，换回后端时页面不用改。 */

export type FieldValue = string | number | boolean | InspectionRecord[]

export type EntryRow = {
  id: number
  status: string
  pending: boolean
  abnormal: boolean
  [field: string]: FieldValue
}

// 一次检测（首次检测或复检）留下的结论记录，复检排在后面，以最近一次为准。
export type InspectionRecord = {
  round: number
  conclusion: string
  inspector: string
  time: string
}

// 飞灰固化检测结论落到环保监控的待复核清单条目。
export type ReviewItem = {
  id: number
  batchId: number
  固化编号: string
  监控指标: string
  实测值: string
  达标判定: string
  来源: string
  检测结论: string
  检测人员: string
  检测时间: string
  复核状态: string
  [field: string]: string | number
}

export type ModuleMeta = {
  key: string
  name: string
  entity: string
  desc: string
  fields: string[]
  statuses: string[]
  actions: string[]
  actionTargets: Record<string, string>
  metrics: string[]
}

export type PageResult = {
  items: EntryRow[]
  total: number
  page: number
  size: number
}

export type ActionResult = {
  ok: boolean
  message: string
}

export type OverviewResult = {
  cards: { label: string; value: number }[]
  modules: { name: string; created: number; pending: number; abnormal: number }[]
}
