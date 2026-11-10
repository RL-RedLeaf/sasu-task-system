<script setup lang="ts">
import { onMounted, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import { message, prompt } from '@/composables/feedback';
import type { NormalizedError } from '@/api/http';
import { communityApi } from '@/api/admin';
import PageHeader from '@/components/PageHeader.vue';
import StatusTag from '@/components/StatusTag.vue';
import EmptyState from '@/components/EmptyState.vue';
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
  { title: '举报人', key: 'reporter', width: 130 },
  { title: '类型', key: 'targetType', width: 100 },
  { title: '目标 ID', key: 'targetId', width: 120 },
  { title: '理由', key: 'reason', ellipsis: true },
  { title: '时间', key: 'createdAt', width: 170 },
  { title: '状态', key: 'status', width: 100 },
  { title: '操作', key: 'action', width: 180, fixed: 'right' },
];

const TABS = [
  { status: 'OPEN', label: '待处理' },
  { status: 'HANDLED', label: '已处理' },
  { status: 'DISMISSED', label: '已驳回' },
];

const activeStatus = ref('OPEN');
const loading = ref(false);
interface ReportRow {
  id: string;
  targetType: string;
  targetId: string;
  reason: string;
  status: string;
  createdAt: string;
  reporter: { name: string };
}
const items = ref<ReportRow[]>([]);
const total = ref(0);
const page = ref(1);
const pageSize = ref(20);

async function load(): Promise<void> {
  loading.value = true;
  try {
    const data = await communityApi.adminReports({
      status: activeStatus.value,
      page: page.value,
      pageSize: pageSize.value,
    });
    items.value = data.items as ReportRow[];
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

function goTaskAdmin(targetId: string): void {
  void router.push(`/teacher/tasks/${targetId}`);
}

// ---------- 处理 ----------
async function handleReport(row: ReportRow): Promise<void> {
  const targetHint =
    row.targetType === 'TASK'
      ? `如内容违规，请先到任务管理页对该任务（#${row.targetId}）执行「强制下架」，再回来填写处理备注。`
      : `目标为留言（#${row.targetId}），请确认后填写处理备注。`;
  let note: string;
  try {
    note = (
      await prompt({
        title: `处理举报 #${row.id}`,
        message: `${targetHint} 请填写处理备注（必填）。`,
        placeholder: '处理备注，如：已强制下架该任务',
        validate: (v: string) => (v && v.trim() ? true : '处理备注不能为空'),
      })
    ).trim();
    await communityApi.handleReport(row.id, { note });
    message.success('举报已标记处理');
    void load();
  } catch (e) {
    if (e !== 'cancel' && e !== 'close') message.error(errMsg(e));
  }
}

// ---------- 驳回举报 ----------
async function dismissReport(row: ReportRow): Promise<void> {
  let reason: string;
  try {
    reason = (
      await prompt({
        title: `驳回举报 #${row.id}`,
        message: '确认驳回该举报吗？驳回表示举报内容不成立，请填写理由（必填）。',
        placeholder: '驳回理由',
        validate: (v: string) => (v && v.trim() ? true : '驳回理由不能为空'),
      })
    ).trim();
    await communityApi.handleReport(row.id, { dismiss: true, note: reason });
    message.success('举报已驳回');
    void load();
  } catch (e) {
    if (e !== 'cancel' && e !== 'close') message.error(errMsg(e));
  }
}
</script>

<template>
  <PageHeader title="举报处理" subtitle="对任务/留言违规举报的处理与驳回" />

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
      :scroll="{ x: 1000 }"
    >
      <template #bodyCell="{ column, record }">
        <template v-if="column.key === 'reporter'">{{ record.reporter?.name ?? '—' }}</template>
        <template v-else-if="column.key === 'targetType'">{{ record.targetType === 'TASK' ? '任务' : '留言' }}</template>
        <template v-else-if="column.key === 'targetId'">
          <a-button v-if="record.targetType === 'TASK'" type="link" class="op-link" @click="goTaskAdmin(record.targetId)">
            #{{ record.targetId }}
          </a-button>
          <span v-else>#{{ record.targetId }}</span>
        </template>
        <template v-else-if="column.key === 'reason'">{{ truncate(record.reason) }}</template>
        <template v-else-if="column.key === 'createdAt'">{{ fmtTime(record.createdAt) }}</template>
        <template v-else-if="column.key === 'status'">
          <StatusTag
            :status="record.status === 'HANDLED' ? '已处理' : record.status === 'DISMISSED' ? '已驳回' : record.status"
          />
        </template>
        <template v-else-if="column.key === 'action'">
          <template v-if="record.status === 'OPEN'">
            <a-button type="link" size="small" class="op-link" @click="handleReport(record as ReportRow)">处理</a-button>
            <a-button type="link" size="small" class="op-link op-danger" @click="dismissReport(record as ReportRow)">驳回举报</a-button>
          </template>
        </template>
      </template>
      <template #emptyText><EmptyState description="该状态下暂无举报" /></template>
    </a-table>

    <div class="pager">
      <AppPagination v-model:page="page" :page-size="pageSize" :total="total" @change="load" />
    </div>
  </a-card>
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
.op-link {
  padding: 0;
}
.op-danger {
  color: var(--sasu-color-danger);
}
</style>
