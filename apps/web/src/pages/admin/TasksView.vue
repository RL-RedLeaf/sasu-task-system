<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import { confirm, message, prompt } from '@/composables/feedback';
import type { FormInstance } from 'ant-design-vue';
import type { Rule } from 'ant-design-vue/es/form';
import type { NormalizedError } from '@/api/http';
import { tasksApi, type TaskSummary } from '@/api/tasks';
import PageHeader from '@/components/PageHeader.vue';
import StatusTag from '@/components/StatusTag.vue';
import EmptyState from '@/components/EmptyState.vue';
import PointsNum from '@/components/PointsNum.vue';
import AppPagination from '@/components/AppPagination.vue';
import type { TableColumnsType } from 'ant-design-vue';

function errMsg(e: unknown): string {
  return (e as NormalizedError).friendlyMessage ?? '操作失败';
}

function fmtTime(value: string): string {
  return value ? new Date(value).toLocaleString('zh-CN') : '—';
}

const router = useRouter();

const columns: TableColumnsType = [
  { title: '标题', key: 'title' },
  { title: '教师', key: 'teacher', width: 110 },
  { title: '分类', key: 'category', width: 110 },
  { title: '状态', key: 'status', width: 90 },
  { title: '赏金（单人）', key: 'reward', width: 120, align: 'right' },
  { title: '名额', key: 'quota', width: 100, align: 'center' },
  { title: '截止时间', key: 'deadlineAt', width: 170 },
  { title: '创建时间', key: 'createdAt', width: 170 },
  { title: '操作', key: 'action', width: 260, fixed: 'right' },
];

const passedColumns: TableColumnsType = [
  { title: '学生', dataIndex: 'student', key: 'student', width: 120 },
  { title: '已发基础分', dataIndex: 'basePaid', key: 'basePaid', width: 110, align: 'right' },
  { title: '通过时间', key: 'acceptedAt' },
];

// ---------- 列表 ----------
const TABS = [
  { status: 'PENDING_REWARD', label: '待定价' },
  { status: 'RECRUITING', label: '招募中' },
  { status: 'FULL', label: '已满' },
  { status: 'CLOSED', label: '已截止' },
  { status: 'SETTLED', label: '已完成' },
  { status: 'CANCELLED', label: '已取消' },
  { status: 'OFFLINE', label: '已下架' },
];

const activeStatus = ref('PENDING_REWARD');
const keyword = ref('');
const loading = ref(false);
const items = ref<TaskSummary[]>([]);
const total = ref(0);
const page = ref(1);
const pageSize = ref(20);

async function load(): Promise<void> {
  loading.value = true;
  try {
    const data = await tasksApi.adminList({
      status: activeStatus.value,
      keyword: keyword.value || undefined,
      page: page.value,
      pageSize: pageSize.value,
    });
    items.value = data.items;
    total.value = data.total;
  } catch (e) {
    message.error(errMsg(e));
  } finally {
    loading.value = false;
  }
}

function onSearch(): void {
  page.value = 1;
  void load();
}

watch(activeStatus, () => {
  page.value = 1;
  void load();
});

function goDetail(id: string): void {
  void router.push(`/teacher/tasks/${id}`);
}

onMounted(() => void load());

/** 已定价且未结算：可改价 / 结算预览 */
function isPricedUnsettled(row: TaskSummary): boolean {
  return row.rewardPerPerson !== null && row.settlementStatus !== 'DONE' && row.status !== 'SETTLED' && row.status !== 'CANCELLED';
}

// ---------- 定价 ----------
const priceOpen = ref(false);
const priceTask = ref<TaskSummary | null>(null);
const priceLoading = ref(false);
const priceForm = reactive({ reward: 1 });

const MAX_REWARD = 500;
const MAX_TOTAL = 10000;

const priceTotal = computed(() => (priceTask.value ? priceForm.reward * priceTask.value.headcount : 0));
const priceValid = computed(() => priceForm.reward >= 1 && priceForm.reward <= MAX_REWARD && priceTotal.value <= MAX_TOTAL);
/** 当前名额下允许的最高单人赏金 */
const maxRewardForHeadcount = computed(() =>
  priceTask.value ? Math.max(1, Math.floor(MAX_TOTAL / priceTask.value.headcount)) : 1,
);
/** 当前赏金下允许的最大名额 */
const maxHeadcountForReward = computed(() =>
  priceForm.reward > 0 ? Math.floor(MAX_TOTAL / priceForm.reward) : 0,
);

function openPrice(row: TaskSummary): void {
  priceTask.value = row;
  priceForm.reward = Math.min(MAX_REWARD, Math.max(1, Math.floor(MAX_TOTAL / row.headcount)));
  priceOpen.value = true;
}

async function submitPrice(): Promise<void> {
  if (!priceTask.value || !priceValid.value) return;
  priceLoading.value = true;
  try {
    const res = await tasksApi.price(priceTask.value.id, priceForm.reward);
    message.success(`定价成功，总额 ${res.totalAmount} 分`);
    priceOpen.value = false;
    void load();
  } catch (e) {
    message.error(errMsg(e));
  } finally {
    priceLoading.value = false;
  }
}

// ---------- 改价 ----------
const repriceOpen = ref(false);
const repriceTask = ref<TaskSummary | null>(null);
const repriceFormRef = ref<FormInstance>();
const repriceLoading = ref(false);
const repriceForm = reactive({ reward: 1, reason: '' });

const repriceRules: Record<string, Rule[]> = {
  reward: [{ required: true, message: '请输入新赏金', trigger: 'blur' }],
  reason: [{ required: true, message: '请填写改价原因', trigger: 'blur' }],
};

const repriceValid = computed(() => repriceForm.reward >= 1 && repriceForm.reward <= MAX_REWARD);

function openReprice(row: TaskSummary): void {
  repriceTask.value = row;
  repriceForm.reward = row.rewardPerPerson ?? 1;
  repriceForm.reason = '';
  repriceOpen.value = true;
}

async function submitReprice(): Promise<void> {
  if (!repriceTask.value) return;
  await repriceFormRef.value?.validate();
  if (!repriceValid.value) {
    message.warning('单人赏金需在 1-500 分之间');
    return;
  }
  repriceLoading.value = true;
  try {
    const res = await tasksApi.reprice(repriceTask.value.id, repriceForm.reward, repriceForm.reason.trim());
    message.success(res.topupPaid > 0 ? `改价成功，已向已通过学生补差 ${res.topupPaid} 分` : '改价成功，无需补差');
    repriceOpen.value = false;
    void load();
  } catch (e) {
    message.error(errMsg(e));
  } finally {
    repriceLoading.value = false;
  }
}

// ---------- 强制下架 / 强制取消 ----------
async function forceAction(row: TaskSummary, kind: 'offline' | 'cancel'): Promise<void> {
  const isOffline = kind === 'offline';
  let reason: string;
  try {
    reason = (
      await prompt({
        title: isOffline ? `强制下架 #${row.id} ${row.title}` : `强制取消 #${row.id} ${row.title}`,
        message: isOffline
          ? '强制下架会将任务转为已截止（结算时按仅退回处理），请填写原因（必填）。'
          : '强制取消会作废任务并将托管积分退回积分池，请填写原因（必填）。',
        placeholder: '请填写操作原因',
        validate: (v: string) => (v && v.trim() ? true : '原因不能为空'),
      })
    ).trim();
    if (isOffline) await tasksApi.forceOffline(row.id, reason);
    else await tasksApi.forceCancel(row.id, reason);
    message.success(isOffline ? '已强制下架' : '已强制取消');
    void load();
  } catch (e) {
    if (e !== 'cancel' && e !== 'close') message.error(errMsg(e));
  }
}

// ---------- 结算预览 ----------
interface PreviewRow {
  escrowBalance: number;
  acceptedCount: number;
  settlementMode: string;
  perPerson: number;
  remainderRecipients: number;
  refundToPool: number;
  passed: { assignmentId: string; student: string; basePaid: number; acceptedAt: string | null }[];
}
const previewOpen = ref(false);
const previewLoading = ref(false);
const preview = ref<PreviewRow | null>(null);
const previewTask = ref<TaskSummary | null>(null);

async function openPreview(row: TaskSummary): Promise<void> {
  previewTask.value = row;
  preview.value = null;
  previewOpen.value = true;
  previewLoading.value = true;
  try {
    preview.value = (await tasksApi.settlementPreview(row.id)) as unknown as PreviewRow;
  } catch (e) {
    message.error(errMsg(e));
  } finally {
    previewLoading.value = false;
  }
}
</script>

<template>
  <PageHeader title="任务管理" subtitle="全部任务的定价、改价与强制处理；点击标题查看详情" />

  <a-card class="block">
    <a-tabs v-model:active-key="activeStatus">
      <a-tab-pane v-for="tab in TABS" :key="tab.status" :tab="tab.label" />
    </a-tabs>

    <div class="toolbar">
      <a-input
        v-model:value="keyword"
        placeholder="按任务标题 / 教师姓名搜索"
        allow-clear
        style="width: 260px"
        @keyup.enter="onSearch"
      />
      <a-button type="primary" @click="onSearch">搜索</a-button>
    </div>

    <a-table
      :columns="columns"
      :data-source="items"
      :loading="loading"
      :pagination="false"
      row-key="id"
      :scroll="{ x: 1200 }"
    >
      <template #bodyCell="{ column, record }">
        <template v-if="column.key === 'title'">
          <a-button type="link" class="op-link" @click="goDetail(record.id)">#{{ record.id }} {{ record.title }}</a-button>
        </template>
        <template v-else-if="column.key === 'teacher'">{{ record.teacher?.name ?? '—' }}</template>
        <template v-else-if="column.key === 'category'">{{ record.category?.name ?? '—' }}</template>
        <template v-else-if="column.key === 'status'"><StatusTag :status="record.status" /></template>
        <template v-else-if="column.key === 'reward'">
          <PointsNum v-if="record.rewardPerPerson !== null" class="num" :value="record.rewardPerPerson" suffix="分" />
          <span v-else>—</span>
        </template>
        <template v-else-if="column.key === 'quota'">{{ record.filledCount }}/{{ record.headcount }}</template>
        <template v-else-if="column.key === 'deadlineAt'">{{ fmtTime(record.deadlineAt) }}</template>
        <template v-else-if="column.key === 'createdAt'">{{ fmtTime(record.createdAt) }}</template>
        <template v-else-if="column.key === 'action'">
          <a-button v-if="record.status === 'PENDING_REWARD'" type="link" size="small" class="op-link" @click="openPrice(record as TaskSummary)">定价</a-button>
          <a-button v-if="isPricedUnsettled(record as TaskSummary)" type="link" size="small" class="op-link" @click="openReprice(record as TaskSummary)">改价</a-button>
          <a-button v-if="isPricedUnsettled(record as TaskSummary)" type="link" size="small" class="op-link" @click="openPreview(record as TaskSummary)">结算预览</a-button>
          <a-button
            v-if="record.status === 'PENDING_REWARD' || (record.status === 'CLOSED' && record.settlementStatus !== 'DONE')"
            type="link"
            size="small"
            class="op-link op-warning"
            @click="forceAction(record as TaskSummary, 'offline')"
          >
            强制下架
          </a-button>
          <a-button
            v-if="record.status === 'PENDING_REWARD' || (record.status === 'CLOSED' && record.settlementStatus !== 'DONE')"
            type="link"
            size="small"
            class="op-link op-danger"
            @click="forceAction(record as TaskSummary, 'cancel')"
          >
            强制取消
          </a-button>
        </template>
      </template>
      <template #emptyText><EmptyState description="该状态下暂无任务" /></template>
    </a-table>

    <div class="pager">
      <AppPagination v-model:page="page" :page-size="pageSize" :total="total" @change="load" />
    </div>
  </a-card>

  <!-- 定价对话框 -->
  <a-modal v-model:open="priceOpen" :title="priceTask ? `定价 #${priceTask.id} ${priceTask.title}` : '定价'" :width="480">
    <template v-if="priceTask">
      <a-alert
        type="info"
        class="mb8"
        :message="`名额 ${priceTask.headcount} 个；单人赏金 1-500 分，总额不超过 ${MAX_TOTAL} 分`"
      />
      <a-form :label-col="{ style: { width: '100px' } }">
        <a-form-item label="单人赏金">
          <a-input-number v-model:value="priceForm.reward" :min="1" :max="MAX_REWARD" :precision="0" />
          <span class="unit">分</span>
        </a-form-item>
        <a-form-item label="总额">
          <span class="total-num"><PointsNum :value="priceTotal" suffix="分" /></span>
          <span class="formula">（{{ priceForm.reward }} × {{ priceTask.headcount }} 名额）</span>
        </a-form-item>
      </a-form>
      <a-alert
        v-if="!priceValid"
        type="warning"
        :message="`总额超限：当前名额下单人赏金最高 ${maxRewardForHeadcount} 分；或 ${priceForm.reward} 分时最多 ${maxHeadcountForReward} 个名额`"
        show-icon
      />
    </template>
    <template #footer>
      <a-button @click="priceOpen = false">取消</a-button>
      <a-button type="primary" :disabled="!priceValid" :loading="priceLoading" @click="submitPrice">确认定价</a-button>
    </template>
  </a-modal>

  <!-- 改价对话框 -->
  <a-modal v-model:open="repriceOpen" :title="repriceTask ? `改价 #${repriceTask.id} ${repriceTask.title}` : '改价'" :width="480">
    <template v-if="repriceTask">
      <a-alert
        type="info"
        class="mb8"
        :message="`当前赏金 ${repriceTask.rewardPerPerson} 分/人，名额 ${repriceTask.headcount} 个`"
      />
      <a-alert
        v-if="(repriceTask.acceptedCount ?? 0) > 0"
        type="warning"
        show-icon
        class="mb8"
        message="已有学生通过验收，改价只能维持或调高；调高后系统会立即向已通过学生补差。"
      />
      <a-form ref="repriceFormRef" :model="repriceForm" :rules="repriceRules" :label-col="{ style: { width: '100px' } }">
        <a-form-item label="新赏金" name="reward">
          <a-input-number v-model:value="repriceForm.reward" :min="1" :max="MAX_REWARD" :precision="0" />
          <span class="unit">分 / 人</span>
        </a-form-item>
        <a-form-item label="改价原因" name="reason">
          <a-input v-model:value="repriceForm.reason" placeholder="必填，将记录到审计日志" />
        </a-form-item>
      </a-form>
    </template>
    <template #footer>
      <a-button @click="repriceOpen = false">取消</a-button>
      <a-button type="primary" :loading="repriceLoading" @click="submitReprice">确认改价</a-button>
    </template>
  </a-modal>

  <!-- 结算预览对话框 -->
  <a-modal v-model:open="previewOpen" :title="previewTask ? `结算预览 #${previewTask.id} ${previewTask.title}` : '结算预览'" :width="560">
    <a-spin :spinning="previewLoading">
      <template v-if="preview">
        <a-descriptions :column="2" bordered>
          <a-descriptions-item label="托管余额"><PointsNum :value="preview.escrowBalance" suffix="分" /></a-descriptions-item>
          <a-descriptions-item label="通过人数">{{ preview.acceptedCount }} 人</a-descriptions-item>
          <a-descriptions-item label="每人可得"><PointsNum :value="preview.perPerson" suffix="分" /></a-descriptions-item>
          <a-descriptions-item label="余数（发给第一名）">{{ preview.remainderRecipients }} 分</a-descriptions-item>
          <a-descriptions-item label="退池金额">
            <PointsNum :value="preview.refundToPool" suffix="分" />
          </a-descriptions-item>
          <a-descriptions-item label="结算模式">
            {{ preview.settlementMode === 'REFUND_ONLY' ? '仅退回（不发放）' : '正常结算' }}
          </a-descriptions-item>
        </a-descriptions>
        <h4 class="sec-title">通过名单</h4>
        <a-empty v-if="preview.passed.length === 0" description="暂无通过验收的学生" />
        <a-table v-else :columns="passedColumns" :data-source="preview.passed" :pagination="false" size="small" :scroll="{ y: 240 }" row-key="assignmentId">
          <template #bodyCell="{ column, record }">
            <template v-if="column.key === 'acceptedAt'">
              {{ record.acceptedAt ? new Date(record.acceptedAt).toLocaleString('zh-CN') : '—' }}
            </template>
          </template>
        </a-table>
      </template>
    </a-spin>
    <template #footer>
      <a-button @click="previewOpen = false">关闭</a-button>
    </template>
  </a-modal>
</template>

<style scoped>
.block {
  border-radius: var(--sasu-radius-base);
  box-shadow: var(--sasu-shadow-card);
}
.toolbar {
  display: flex;
  gap: 8px;
  align-items: center;
  margin-bottom: 12px;
}
.pager {
  margin-top: 12px;
  display: flex;
  justify-content: flex-end;
}
.mb8 {
  margin-bottom: 8px;
}
.unit {
  margin-left: 8px;
  color: var(--sasu-text-secondary);
  font-size: 13px;
}
.formula {
  margin-left: 8px;
  color: var(--sasu-text-secondary);
  font-size: 12px;
}
.total-num {
  font-size: 18px;
}
.sec-title {
  margin: 16px 0 8px;
  font-size: 14px;
}
.op-link {
  padding: 0;
}
.op-warning {
  color: var(--sasu-color-warning);
}
.op-danger {
  color: var(--sasu-color-danger);
}
</style>
