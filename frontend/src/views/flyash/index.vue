<template>
  <section class="page" data-module="flyash">
    <header class="page-head">
      <div>
        <h2>飞灰固化处置管理</h2>
        <p class="page-desc">维护飞灰固化批次，围绕固化编号、飞灰来源、螯合剂用量、水泥用量做登记、筛选与状态流转。</p>
      </div>
      <div class="page-actions">
        <button class="btn primary" type="button" @click="openCreate">登记飞灰固化批次</button>
        <button class="btn" type="button" @click="exportRows">导出飞灰固化处置清单</button>
      </div>
    </header>

    <div class="stat-row">
      <article v-for="item in stats" :key="item.label" class="stat-card">
        <span class="stat-label">{{ item.label }}</span>
        <strong class="stat-value">{{ item.value }}</strong>
      </article>
    </div>

    <p class="status-legend">
      <span v-for="item in statusSummary" :key="item.status" class="legend-item">
        {{ item.status }}：{{ item.count }}
      </span>
    </p>

    <form class="filter-bar" @submit.prevent="reload">
      <label v-for="field in filterFields" :key="field" class="filter-item">
        <span>{{ field }}</span>
        <input v-model="filters[field]" :placeholder="`按${field}检索`" />
      </label>
      <button class="btn" type="submit">查询</button>
      <button class="btn ghost" type="button" @click="resetFilters">重置条件</button>
    </form>

    <table class="data-table">
      <thead>
        <tr>
          <th v-for="column in columns" :key="column">{{ column }}</th>
          <th>当前状态</th>
          <th>可执行动作</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="row in rows" :key="String(row.id)">
          <td v-for="column in columns" :key="column">
            <button v-if="column === '固化编号'" class="link" type="button" @click="openDetail(row)">
              {{ row[column] || '—' }}
            </button>
            <template v-else>{{ row[column] || '—' }}</template>
          </td>
          <td>{{ row.status }}</td>
          <td class="row-actions">
            <button
              v-for="action in actionsFor(row.status)"
              :key="action"
              class="link"
              type="button"
              @click="runAction(action, row)"
            >
              {{ action }}
            </button>
            <button class="link" type="button" @click="openDetail(row)">查看详情</button>
          </td>
        </tr>
        <tr v-if="!rows.length">
          <td :colspan="columns.length + 2" class="empty-state">暂无飞灰固化处置数据，可先登记飞灰固化批次</td>
        </tr>
      </tbody>
    </table>

    <footer class="page-foot">
      <span>共 {{ total }} 条飞灰固化处置记录</span>
      <span v-if="errorMessage" class="error-text">{{ errorMessage }}</span>
    </footer>

    <div v-if="dialog.action" class="modal-mask" @click.self="closeDialog">
      <div class="modal-card">
        <h3 class="modal-title">{{ dialog.action }}</h3>
        <p class="modal-desc">固化编号：{{ dialog.code }} · 当前状态：{{ dialog.fromStatus }}</p>
        <label v-if="needsConclusion" class="modal-field">
          <span>{{ dialog.action === '确认复检' ? '复检结论' : '检测结论' }}</span>
          <textarea v-model="dialog.conclusion" rows="4" :placeholder="dialog.action === '确认复检' ? '填写最近一次复检结论，将覆盖首次检测结果' : '检测结论出来后再确认，未出结论不能检测'"></textarea>
        </label>
        <label v-if="needsReason" class="modal-field">
          <span>返工理由（必填）</span>
          <textarea v-model="dialog.reason" rows="4" placeholder="退回必须写明理由，原检测结论将被清空"></textarea>
        </label>
        <p v-if="dialog.action === '要求返工'" class="modal-tip">判返工后批次进入「需返工」，检测结论清空；复检须先提交复检进入「待复检」，再确认复检回「已检测」。</p>
        <p v-if="dialog.action === '确认检测' || dialog.action === '确认复检'" class="modal-tip">结论将同步到环保指标监控的待复核清单，同一固化编号只保留最新一条。</p>
        <p v-if="dialog.action === '归档'" class="modal-tip">只有已检测批次可归档；需返工、待复检批次不能归档。</p>
        <p v-if="dialog.error" class="error-text">{{ dialog.error }}</p>
        <div class="modal-actions">
          <button class="btn ghost" type="button" @click="closeDialog">取消</button>
          <button class="btn primary" type="button" @click="confirmDialog">确定</button>
        </div>
      </div>
    </div>

    <div v-if="detail" class="modal-mask" @click.self="closeDetail">
      <div class="modal-card">
        <h3 class="modal-title">批次详情 · {{ detail['固化编号'] }}</h3>
        <dl class="detail-grid">
          <template v-for="column in columns" :key="column">
            <dt>{{ column }}</dt>
            <dd>{{ detail[column] || '—' }}</dd>
          </template>
          <dt>当前状态</dt>
          <dd>{{ detail.status }}</dd>
          <dt>返工理由</dt>
          <dd>{{ detail['返工理由'] || '—' }}</dd>
        </dl>
        <p class="modal-tip">列表与详情读同一份固化状态，不会出现两个状态。</p>
        <div class="modal-actions">
          <button class="btn primary" type="button" @click="closeDetail">关闭</button>
        </div>
      </div>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'

import {
  downloadEntries,
  getEntry,
  listEntries,
  moduleMeta,
  runAction as applyAction,
} from '@/api/local-service'
import type { ActionPayload, EntryRow } from '@/data/types'

const meta = moduleMeta('flyash')
// 固化状态是状态列的唯一来源，不再作为普通字段在表格里重复一份。
const columns = ["固化编号", "飞灰来源", "螯合剂用量", "水泥用量", "固化块批次", "检测结果", "操作人员"]
const statuses = ["待固化", "固化中", "已检测", "需返工", "待复检", "已归档"]
// 每个状态下只给它该走的动作，跳过固化中直接检测、已检测退回固化中、返工批次归档都在入口拦住。
const ACTIONS_BY_STATUS: Record<string, string[]> = {
  待固化: ["提交固化"],
  固化中: ["确认检测"],
  已检测: ["要求返工", "归档"],
  需返工: ["提交复检"],
  待复检: ["确认复检"],
  已归档: [],
}
const REASON_ACTIONS = ["要求返工"]
const CONCLUSION_ACTIONS = ["确认检测", "确认复检"]

const needsConclusion = computed(() => CONCLUSION_ACTIONS.includes(dialog.action))
const needsReason = computed(() => REASON_ACTIONS.includes(dialog.action))

const rows = ref<EntryRow[]>([])
const total = ref(0)
const errorMessage = ref('')
const filters = ref<Record<string, string>>({})
const filterFields = columns.slice(0, 3)
const statusSummary = computed(() =>
  statuses.map((status: string) => ({
    status,
    count: rows.value.filter((row) => String(row.status) === status).length,
  })),
)
const stats = computed(() => [
  { label: "待固化批次", value: countByStatus("待固化") },
  { label: "固化中批次", value: countByStatus("固化中") + countByStatus("待复检") },
  { label: "需返工批次", value: countByStatus("需返工") },
])

function countByStatus(status: string): number {
  return rows.value.filter((row) => String(row.status) === status).length
}

function actionsFor(status: string): string[] {
  return ACTIONS_BY_STATUS[status] ?? []
}

const dialog = reactive<{
  action: string
  id: number
  code: string
  fromStatus: string
  conclusion: string
  reason: string
  error: string
}>({ action: '', id: 0, code: '', fromStatus: '', conclusion: '', reason: '', error: '' })

const detail = ref<EntryRow | null>(null)

function resetFilters() {
  filters.value = {}
  reload()
}

function exportRows() {
  downloadEntries(meta.key)
}

function openCreate() {
  errorMessage.value = '飞灰固化批次登记入口尚未接入审批流'
}

function runAction(action: string, row: EntryRow) {
  dialog.action = action
  dialog.id = Number(row.id)
  dialog.code = String(row['固化编号'] ?? '')
  dialog.fromStatus = String(row.status)
  dialog.conclusion = CONCLUSION_ACTIONS.includes(action) ? String(row['检测结果'] ?? '') : ''
  dialog.reason = REASON_ACTIONS.includes(action) ? String(row['返工理由'] ?? '') : ''
  dialog.error = ''
}

function confirmDialog() {
  const payload: ActionPayload = {
    conclusion: dialog.conclusion,
    reason: dialog.reason,
  }
  const result = applyAction(meta.key, dialog.id, dialog.action, payload)
  if (!result.ok) {
    dialog.error = result.message
    errorMessage.value = result.message
    return
  }
  closeDialog()
  reload()
}

function closeDialog() {
  dialog.action = ''
  dialog.error = ''
}

function openDetail(row: EntryRow) {
  detail.value = getEntry(meta.key, Number(row.id)) ?? row
}

function closeDetail() {
  detail.value = null
}

function reload() {
  errorMessage.value = ''
  try {
    const payload = listEntries(meta.key, filters.value)
    rows.value = payload.items
    total.value = payload.total
    if (detail.value) {
      detail.value = getEntry(meta.key, Number(detail.value.id)) ?? null
    }
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '飞灰固化处置列表读取失败'
  }
}

onMounted(reload)
</script>
