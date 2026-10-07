<template>
  <section class="page" data-module="flyash">
    <header class="page-head">
      <div>
        <h2>飞灰固化处置管理</h2>
        <p class="page-desc">维护飞灰固化批次，围绕固化编号、飞灰来源、螯合剂用量、水泥用量做登记、筛选与状态流转。状态线：待固化 → 固化中 → 已检测，不合格判返工，复检通过后重新进入已检测。</p>
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
          <th v-for="column in dataColumns" :key="column">{{ column }}</th>
          <th>当前状态</th>
          <th>可执行动作</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="row in rows" :key="String(row.id)">
          <td v-for="column in dataColumns" :key="column">
            <button v-if="column === '固化编号'" class="link" type="button" @click="openDetail(row)">
              {{ row[column] || '—' }}
            </button>
            <template v-else>{{ row[column] || '—' }}</template>
          </td>
          <td>{{ row.status }}</td>
          <td class="row-actions">
            <button
              v-for="action in availableActions(row.status)"
              :key="action"
              class="link"
              type="button"
              @click="openAction(action, row)"
            >
              {{ action }}
            </button>
          </td>
        </tr>
        <tr v-if="!rows.length">
          <td :colspan="dataColumns.length + 2" class="empty-state">暂无飞灰固化处置数据，可先登记飞灰固化批次</td>
        </tr>
      </tbody>
    </table>

    <footer class="page-foot">
      <span>共 {{ total }} 条飞灰固化处置记录</span>
      <span v-if="errorMessage" class="error-text">{{ errorMessage }}</span>
    </footer>

    <!-- 登记新批次 -->
    <div v-if="createOpen" class="modal-mask" @click.self="closeCreate">
      <div class="modal">
        <h3>登记飞灰固化批次</h3>
        <label v-for="field in createFields" :key="field" class="modal-field">
          <span>{{ field }}</span>
          <input v-model="createForm[field]" :placeholder="`请输入${field}`" />
        </label>
        <p v-if="createError" class="error-text">{{ createError }}</p>
        <div class="modal-actions">
          <button class="btn ghost" type="button" @click="closeCreate">取消</button>
          <button class="btn primary" type="button" @click="submitCreate">提交登记</button>
        </div>
      </div>
    </div>

    <!-- 检测 / 返工 / 复检 -->
    <div v-if="dialog.action" class="modal-mask" @click.self="closeDialog">
      <div class="modal">
        <h3>{{ dialog.action }} · {{ dialog.row?.['固化编号'] }}</h3>

        <template v-if="dialog.action === '要求返工'">
          <label class="modal-field">
            <span>返工理由（必填）</span>
            <textarea v-model="dialog.reason" rows="3" placeholder="请写明退回返工的理由"></textarea>
          </label>
        </template>
        <template v-else>
          <label class="modal-field">
            <span>{{ dialog.action === '提交复检' ? '复检结论' : '检测结论' }}（必填）</span>
            <textarea v-model="dialog.conclusion" rows="3" placeholder="检测结论没出不能提交；请填写浸出毒性等检测结论"></textarea>
          </label>
          <label class="modal-field">
            <span>检测人员</span>
            <input v-model="dialog.inspector" placeholder="默认取当前值班人员" />
          </label>
        </template>

        <p v-if="dialog.error" class="error-text">{{ dialog.error }}</p>
        <div class="modal-actions">
          <button class="btn ghost" type="button" @click="closeDialog">取消</button>
          <button class="btn primary" type="button" @click="submitDialog">确认</button>
        </div>
      </div>
    </div>

    <!-- 批次详情：与列表读同一份持久化数据，状态不会出现两个版本 -->
    <div v-if="detailRow" class="modal-mask" @click.self="closeDetail">
      <div class="modal modal-wide">
        <h3>批次详情 · {{ detailRow['固化编号'] }}</h3>
        <dl class="detail-grid">
          <div v-for="field in detailFields" :key="field">
            <dt>{{ field }}</dt>
            <dd>{{ detailRow[field] || '—' }}</dd>
          </div>
          <div>
            <dt>当前状态</dt>
            <dd>{{ detailRow.status }}</dd>
          </div>
          <div v-if="String(detailRow['返工理由'] ?? '')">
            <dt>返工理由</dt>
            <dd>{{ detailRow['返工理由'] }}</dd>
          </div>
        </dl>

        <h4 class="detail-sub">检测与复检记录</h4>
        <table v-if="historyOf(detailRow).length" class="data-table">
          <thead>
            <tr><th>轮次</th><th>结论</th><th>检测人员</th><th>时间</th></tr>
          </thead>
          <tbody>
            <tr v-for="record in historyOf(detailRow)" :key="record.round">
              <td>{{ record.round === 1 ? '首次检测' : `第${record.round - 1}次复检` }}</td>
              <td>{{ record.conclusion }}</td>
              <td>{{ record.inspector }}</td>
              <td>{{ record.time }}</td>
            </tr>
          </tbody>
        </table>
        <p v-else class="page-desc">暂无检测结论：检测结论未出前批次不能进入已检测。</p>

        <div class="modal-actions">
          <button class="btn" type="button" @click="closeDetail">关闭</button>
        </div>
      </div>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'

import {
  downloadEntries,
  listEntries,
  moduleMeta,
} from '@/api/local-service'
import {
  createFlyashBatch,
  FLYASH_ACTIONS,
  runFlyashAction,
  type FlyashDraft,
} from '@/api/flyash-service'
import { useSessionStore } from '@/stores/session'
import type { EntryRow, InspectionRecord } from '@/data/types'

const session = useSessionStore()
const meta = moduleMeta('flyash')
// 「固化状态」是与 status 同步的冗余字段，列表只展示独立的「当前状态」一列，避免同一状态读成两份。
const dataColumns = ["固化编号", "飞灰来源", "螯合剂用量", "水泥用量", "固化块批次", "检测结果", "操作人员"]
const detailFields = ["固化编号", "飞灰来源", "螯合剂用量", "水泥用量", "固化块批次", "检测结果", "操作人员", "固化状态"]
const createFields: (keyof FlyashDraft)[] = ["固化编号", "飞灰来源", "螯合剂用量", "水泥用量", "固化块批次"]

// 每个状态只暴露合法的下一步动作，按钮级先挡一道，服务层再按来源状态硬校验。
const NEXT_ACTIONS: Record<string, string[]> = {
  待固化: [FLYASH_ACTIONS.submit],
  固化中: [FLYASH_ACTIONS.inspect, FLYASH_ACTIONS.rework],
  已检测: [FLYASH_ACTIONS.rework],
  需返工: [FLYASH_ACTIONS.reinspect],
}

const rows = ref<EntryRow[]>([])
const total = ref(0)
const errorMessage = ref('')
const filters = ref<Record<string, string>>({})
const filterFields = dataColumns.slice(0, 3)
const statuses = ["待固化", "固化中", "已检测", "需返工"]

const stats = computed(() => [
  { label: '待固化批次', value: rows.value.filter((row) => row.status === '待固化').length },
  { label: '固化中批次', value: rows.value.filter((row) => row.status === '固化中').length },
  { label: '需返工批次', value: rows.value.filter((row) => row.status === '需返工').length },
])
const statusSummary = computed(() =>
  statuses.map((status: string) => ({
    status,
    count: rows.value.filter((row) => String(row.status) === status).length,
  })),
)

function availableActions(status: string): string[] {
  return NEXT_ACTIONS[status] ?? []
}

function historyOf(row: EntryRow): InspectionRecord[] {
  const records = row['检测记录']
  return Array.isArray(records) ? (records as InspectionRecord[]) : []
}

function resetFilters() {
  filters.value = {}
  reload()
}

function exportRows() {
  downloadEntries(meta.key)
}

// ---- 登记 ----
const createOpen = ref(false)
const createError = ref('')
const createForm = reactive<FlyashDraft>({
  固化编号: '',
  飞灰来源: '',
  螯合剂用量: '',
  水泥用量: '',
  固化块批次: '',
  操作人员: '',
})

function openCreate() {
  Object.assign(createForm, {
    固化编号: '',
    飞灰来源: '',
    螯合剂用量: '',
    水泥用量: '',
    固化块批次: '',
    操作人员: session.operator,
  })
  createError.value = ''
  createOpen.value = true
}

function closeCreate() {
  createOpen.value = false
}

function submitCreate() {
  const result = createFlyashBatch(createForm)
  if (!result.ok) {
    createError.value = result.message
    return
  }
  createOpen.value = false
  reload()
}

// ---- 检测 / 返工 / 复检 ----
const dialog = reactive<{
  action: string
  row: EntryRow | null
  conclusion: string
  reason: string
  inspector: string
  error: string
}>({
  action: '',
  row: null,
  conclusion: '',
  reason: '',
  inspector: '',
  error: '',
})

function openAction(action: string, row: EntryRow) {
  dialog.action = action
  dialog.row = row
  dialog.conclusion = ''
  dialog.reason = ''
  dialog.inspector = String(row['操作人员'] ?? session.operator)
  dialog.error = ''
}

function closeDialog() {
  dialog.action = ''
  dialog.row = null
}

function submitDialog() {
  if (!dialog.row) {
    return
  }
  const result = runFlyashAction(Number(dialog.row.id), dialog.action, {
    conclusion: dialog.conclusion,
    reason: dialog.reason,
    inspector: dialog.inspector,
  })
  if (!result.ok) {
    dialog.error = result.message
    return
  }
  closeDialog()
  reload()
}

// ---- 详情 ----
const detailRow = ref<EntryRow | null>(null)

function openDetail(row: EntryRow) {
  // 从同一份列表数据读取，列表、详情永远是同一条状态。
  detailRow.value = rows.value.find((item) => Number(item.id) === Number(row.id)) ?? row
}

function closeDetail() {
  detailRow.value = null
}

function reload() {
  errorMessage.value = ''
  try {
    const payload = listEntries(meta.key, filters.value)
    rows.value = payload.items
    total.value = payload.total
    if (detailRow.value) {
      detailRow.value = payload.items.find((row) => Number(row.id) === Number(detailRow.value?.id)) ?? null
    }
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '飞灰固化处置列表读取失败'
  }
}

onMounted(reload)
</script>

<style scoped>
.modal-mask {
  position: fixed;
  inset: 0;
  background: rgba(15, 23, 42, 0.45);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 20;
}
.modal {
  background: #fff;
  border-radius: 10px;
  padding: 18px 20px;
  width: 420px;
  max-height: 86vh;
  overflow: auto;
}
.modal-wide { width: 720px; }
.modal h3 { margin: 0 0 14px; font-size: 16px; }
.modal-field { display: block; margin-bottom: 12px; }
.modal-field span { display: block; font-size: 12px; color: var(--muted); margin-bottom: 4px; }
.modal-field input,
.modal-field textarea {
  width: 100%;
  border: 1px solid var(--border);
  border-radius: 6px;
  padding: 6px 8px;
  font: inherit;
}
.modal-actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 8px; }
.detail-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 8px 18px;
  margin: 0 0 12px;
  font-size: 13px;
}
.detail-grid dt { color: var(--muted); font-size: 12px; }
.detail-grid dd { margin: 2px 0 0; }
.detail-sub { font-size: 14px; margin: 14px 0 6px; }
</style>
