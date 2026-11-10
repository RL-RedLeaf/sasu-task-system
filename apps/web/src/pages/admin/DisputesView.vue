<script setup lang="ts">
import { onMounted, reactive, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import { confirm, message } from '@/composables/feedback';
import type { FormInstance } from 'ant-design-vue';
import type { Rule } from 'ant-design-vue/es/form';
import type { NormalizedError } from '@/api/http';
import { disputesApi, type DisputeRow } from '@/api/withdrawals';
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

function truncate(text: string, len = 40): string {
  return text.length > len ? `${text.slice(0, len)}…` : text;
}

const router = useRouter();

const columns: TableColumnsType = [
  { title: '发起人', key: 'initiator', width: 130 },
  { title: '角色', key: 'role', width: 80 },
  { title: '被诉方', key: 'respondent', width: 130 },
  { title: '关联任务', key: 'taskId', width: 110 },
  { title: '理由', key: 'reason' },
  { title: '状态', key: 'status', width: 90 },
  { title: '时间', key: 'createdAt', width: 170 },
  { title: '操作', key: 'action', width: 140, fixed: 'right' },
];

const TABS = [
  { status: 'OPEN', label: '待处理' },
  { status: 'RESOLVED', label: '已裁定' },
  { status: 'REJECTED', label: '已驳回' },
];

const roleLabels: Record<string, string> = { STUDENT: '学生', TEACHER: '教师', ADMIN: '管理员' };

const activeStatus = ref('OPEN');
const loading = ref(false);
const items = ref<DisputeRow[]>([]);
const total = ref(0);
const page = ref(1);
const pageSize = ref(20);

async function load(): Promise<void> {
  loading.value = true;
  try {
    const data = await disputesApi.adminList({
      status: activeStatus.value,
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

watch(activeStatus, () => {
  page.value = 1;
  void load();
});

onMounted(() => void load());

// ---------- 详情抽屉 ----------
const drawerOpen = ref(false);
const detail = ref<DisputeRow | null>(null);

function openDetail(row: DisputeRow): void {
  detail.value = row;
  drawerOpen.value = true;
}

function goTask(taskId: string | null): void {
  if (taskId) void router.push(`/teacher/tasks/${taskId}`);
}

// ---------- 裁定 ----------
const resolveOpen = ref(false);
const resolveFormRef = ref<FormInstance>();
const resolveLoading = ref(false);
const resolveTask = ref<DisputeRow | null>(null);
const resolveForm = reactive({ decision: 'PAY_FULL', payPoints: 0, note: '' });

const resolveRules: Record<string, Rule[]> = {
  decision: [{ required: true, message: '请选择裁定结果', trigger: 'change' }],
};

function openResolve(row: DisputeRow): void {
  resolveTask.value = row;
  Object.assign(resolveForm, { decision: 'PAY_FULL', payPoints: 0, note: '' });
  drawerOpen.value = false;
  resolveOpen.value = true;
}

const decisionLabels: Record<string, string> = {
  PAY_FULL: '全额发放',
  PAY_PARTIAL: '部分发放',
  REJECT: '驳回（不发积分）',
};

async function submitResolve(): Promise<void> {
  if (!resolveTask.value) return;
  await resolveFormRef.value?.validate();
  if (resolveForm.decision === 'PAY_PARTIAL') {
    if (!Number.isInteger(resolveForm.payPoints) || resolveForm.payPoints <= 0) {
      message.warning('部分发放需输入大于 0 的整数积分');
      return;
    }
  }
  try {
    await confirm({
      title: '确认裁定',
      content: `确认按「${decisionLabels[resolveForm.decision]}」裁定该仲裁吗？裁定会立即执行并通知双方。`,
      icon: 'warning',
      okText: '确认裁定',
      cancelText: '再想想',
    });
  } catch {
    return;
  }
  resolveLoading.value = true;
  try {
    await disputesApi.resolve(resolveTask.value.id, {
      decision: resolveForm.decision as 'PAY_FULL' | 'PAY_PARTIAL' | 'REJECT',
      payPoints: resolveForm.decision === 'PAY_PARTIAL' ? resolveForm.payPoints : undefined,
      resolutionNote: resolveForm.note.trim() || undefined,
    });
    message.success('裁定完成');
    resolveOpen.value = false;
    void load();
  } catch (e) {
    message.error(errMsg(e));
  } finally {
    resolveLoading.value = false;
  }
}
</script>

<template>
  <PageHeader title="仲裁处理" subtitle="学生/教师发起的仲裁裁定：全额发放、部分发放或驳回" />

  <a-card class="block">
    <a-tabs v-model:active-key="activeStatus">
      <a-tab-pane v-for="tab in TABS" :key="tab.status" :tab="tab.label" />
    </a-tabs>

    <a-table
      :columns="columns"
      :data-source="items"
      :loading="loading"
      :pagination="false"
      row-key="id"
      :scroll="{ x: 940 }"
    >
      <template #bodyCell="{ column, record }">
        <template v-if="column.key === 'initiator'">{{ record.initiator?.name ?? record.initiatorId }}</template>
        <template v-else-if="column.key === 'role'">{{ roleLabels[record.initiatorRole] ?? record.initiatorRole }}</template>
        <template v-else-if="column.key === 'respondent'">{{ record.respondent?.name ?? record.respondentId }}</template>
        <template v-else-if="column.key === 'taskId'">
          <a-button v-if="record.taskId" type="link" class="op-link" @click="goTask(record.taskId)">#{{ record.taskId }}</a-button>
          <span v-else>—</span>
        </template>
        <template v-else-if="column.key === 'reason'">
          <span class="reason">{{ truncate(record.reason) }}</span>
        </template>
        <template v-else-if="column.key === 'status'"><StatusTag :status="record.status" /></template>
        <template v-else-if="column.key === 'createdAt'">{{ fmtTime(record.createdAt) }}</template>
        <template v-else-if="column.key === 'action'">
          <a-button type="link" size="small" class="op-link" @click="openDetail(record as DisputeRow)">详情</a-button>
          <a-button v-if="record.status === 'OPEN'" type="link" size="small" class="op-link op-warning" @click="openResolve(record as DisputeRow)">裁定</a-button>
        </template>
      </template>
      <template #emptyText><EmptyState description="该状态下暂无仲裁" /></template>
    </a-table>

    <div class="pager">
      <AppPagination v-model:page="page" :page-size="pageSize" :total="total" @change="load" />
    </div>
  </a-card>

  <!-- 详情抽屉 -->
  <a-drawer v-model:open="drawerOpen" title="仲裁详情" :width="440">
    <template v-if="detail">
      <a-descriptions :column="1" bordered>
        <a-descriptions-item label="编号">#{{ detail.id }}</a-descriptions-item>
        <a-descriptions-item label="发起人">
          {{ detail.initiator?.name ?? detail.initiatorId }}（{{ roleLabels[detail.initiatorRole] ?? detail.initiatorRole }}）
        </a-descriptions-item>
        <a-descriptions-item label="被诉方">
          {{ detail.respondent?.name ?? detail.respondentId }}（{{ roleLabels[detail.respondent?.role ?? ''] ?? detail.respondent?.role ?? '—' }}）
        </a-descriptions-item>
        <a-descriptions-item label="关联任务">
          <a-button v-if="detail.taskId" type="link" class="op-link" @click="goTask(detail.taskId)">#{{ detail.taskId }}</a-button>
          <span v-else>—</span>
        </a-descriptions-item>
        <a-descriptions-item label="状态"><StatusTag :status="detail.status" /></a-descriptions-item>
        <a-descriptions-item label="发起时间">{{ fmtTime(detail.createdAt) }}</a-descriptions-item>
        <a-descriptions-item label="仲裁理由">{{ detail.reason }}</a-descriptions-item>
        <a-descriptions-item v-if="detail.decision" label="裁定结果">
          {{ decisionLabels[detail.decision] ?? detail.decision }}
          <template v-if="detail.payPoints !== null">（<PointsNum :value="detail.payPoints" suffix="分" />）</template>
        </a-descriptions-item>
        <a-descriptions-item v-if="detail.resolutionNote" label="处理说明">{{ detail.resolutionNote }}</a-descriptions-item>
      </a-descriptions>
      <div v-if="detail.status === 'OPEN'" class="drawer-actions">
        <a-button type="primary" @click="openResolve(detail)">去裁定</a-button>
      </div>
    </template>
  </a-drawer>

  <!-- 裁定对话框 -->
  <a-modal v-model:open="resolveOpen" :title="resolveTask ? `裁定仲裁 #${resolveTask.id}` : '裁定仲裁'" :width="480">
    <a-form ref="resolveFormRef" :model="resolveForm" :rules="resolveRules" :label-col="{ style: { width: '100px' } }">
      <a-form-item label="裁定结果" name="decision">
        <a-radio-group v-model:value="resolveForm.decision">
          <a-radio value="PAY_FULL">全额发放</a-radio>
          <a-radio value="PAY_PARTIAL">部分发放</a-radio>
          <a-radio value="REJECT">驳回</a-radio>
        </a-radio-group>
      </a-form-item>
      <a-form-item v-if="resolveForm.decision === 'PAY_PARTIAL'" label="发放积分">
        <a-input-number v-model:value="resolveForm.payPoints" :min="1" :precision="0" style="width: 200px" />
        <span class="unit">分</span>
      </a-form-item>
      <a-form-item label="处理说明">
        <a-textarea v-model:value="resolveForm.note" :rows="3" placeholder="将通知双方（选填）" />
      </a-form-item>
    </a-form>
    <template #footer>
      <a-button @click="resolveOpen = false">取消</a-button>
      <a-button type="primary" :loading="resolveLoading" @click="submitResolve">确认裁定</a-button>
    </template>
  </a-modal>
</template>

<style scoped>
.block {
  border-radius: var(--sasu-radius-base);
  box-shadow: var(--sasu-shadow-card);
}
.pager {
  margin-top: 12px;
  display: flex;
  justify-content: flex-end;
}
.reason {
  color: var(--sasu-text-secondary);
}
.drawer-actions {
  margin-top: 16px;
}
.unit {
  margin-left: 8px;
  color: var(--sasu-text-secondary);
  font-size: 12px;
}
.op-link {
  padding: 0;
}
.op-warning {
  color: var(--sasu-color-warning);
}
</style>
