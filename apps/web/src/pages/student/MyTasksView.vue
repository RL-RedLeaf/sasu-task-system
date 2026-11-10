<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { message } from '@/composables/feedback';
import { tasksApi, type AssignmentRow } from '@/api/tasks';
import type { NormalizedError } from '@/api/http';
import EmptyState from '@/components/EmptyState.vue';
import PageHeader from '@/components/PageHeader.vue';
import PointsNum from '@/components/PointsNum.vue';
import StatusTag from '@/components/StatusTag.vue';
import AppPagination from '@/components/AppPagination.vue';
import type { TableColumnsType } from 'ant-design-vue';

const PAGE_SIZE = 20;
const router = useRouter();

type MyRow = AssignmentRow & { task: { id: string; title: string; status: string; rewardPerPerson: number | null; category?: { name: string } } };

interface TabItem {
  key: string;
  label: string;
  statuses: string[];
}

const tabs: TabItem[] = [
  { key: 'ALL', label: '全部', statuses: [] },
  { key: 'ACTIVE', label: '进行中', statuses: ['CLAIMED'] },
  { key: 'SUBMITTED', label: '待验收', statuses: ['SUBMITTED'] },
  { key: 'DONE', label: '已完成', statuses: ['ACCEPTED', 'SETTLED'] },
  { key: 'FAILED', label: '未通过', statuses: ['REJECTED', 'FAILED', 'OVERDUE'] },
  { key: 'CANCELLED', label: '已取消', statuses: ['WITHDRAWN', 'CANCELLED_BY_TEACHER'] },
];

const activeTab = ref('ALL');
const items = ref<MyRow[]>([]);
const total = ref(0);
const page = ref(1);
const loading = ref(false);

const columns: TableColumnsType = [
  { title: '任务标题', key: 'title' },
  { title: '分类', key: 'category', width: 120 },
  { title: '单人赏金', key: 'reward', width: 110, align: 'right' },
  { title: '我的状态', key: 'status', width: 100 },
  { title: '接单时间', key: 'claimedAt', width: 170 },
  { title: '', key: 'chevron', width: 60, align: 'right' },
];

function fmtTime(v: string | null | undefined): string {
  return v ? new Date(v).toLocaleString('zh-CN') : '—';
}

async function load(): Promise<void> {
  loading.value = true;
  try {
    const tab = tabs.find((t) => t.key === activeTab.value);
    const params: Record<string, unknown> = { page: page.value, pageSize: PAGE_SIZE };
    if (tab && tab.statuses.length > 0) params.status = tab.statuses.join(',');
    const data = await tasksApi.myAssignments(params);
    items.value = data.items as unknown as MyRow[];
    total.value = data.total;
  } catch (e) {
    message.error((e as NormalizedError).friendlyMessage ?? '加载失败');
  } finally {
    loading.value = false;
  }
}

function onTabChange(): void {
  page.value = 1;
  void load();
}
function openRow(row: MyRow): void {
  void router.push(`/my/tasks/${row.id}`);
}
function customRow(record: MyRow): { onClick: () => void } {
  return { onClick: () => openRow(record) };
}

onMounted(() => {
  void load();
});
</script>

<template>
  <PageHeader title="我的任务" subtitle="接单后按时提交交付物，被驳回时请在重交窗口内重新提交" />
  <a-card class="block">
    <a-tabs v-model:active-key="activeTab" @change="onTabChange">
      <a-tab-pane v-for="t in tabs" :key="t.key" :tab="t.label" />
    </a-tabs>
    <a-spin :spinning="loading">
      <div class="table-area">
        <a-table
          v-if="items.length > 0"
          :columns="columns"
          :data-source="items"
          :pagination="false"
          row-key="id"
          class="click-table"
          :custom-row="customRow"
        >
          <template #bodyCell="{ column, record }">
            <template v-if="column.key === 'title'">
              <span class="row-title">{{ record.task?.title ?? `任务 #${record.taskId}` }}</span>
            </template>
            <template v-else-if="column.key === 'category'">
              {{ record.task?.category?.name ?? '—' }}
            </template>
            <template v-else-if="column.key === 'reward'">
              <PointsNum :value="record.task?.rewardPerPerson ?? 0" suffix="分" />
            </template>
            <template v-else-if="column.key === 'status'">
              <StatusTag :status="record.status" />
            </template>
            <template v-else-if="column.key === 'claimedAt'">
              {{ fmtTime(record.claimedAt) }}
            </template>
            <template v-else-if="column.key === 'chevron'">
              <span class="row-title">›</span>
            </template>
          </template>
        </a-table>
        <EmptyState v-else-if="!loading" description="还没有接过的任务，去任务大厅看看吧">
          <a-button type="primary" @click="router.push('/tasks')">逛逛任务大厅</a-button>
        </EmptyState>
      </div>
    </a-spin>
    <div class="pager">
      <AppPagination v-model:page="page" :page-size="PAGE_SIZE" :total="total" hide-on-single-page @change="load" />
    </div>
  </a-card>
</template>

<style scoped>
.block {
  border-radius: var(--sasu-radius-base);
  box-shadow: var(--sasu-shadow-card);
}
.table-area {
  min-height: 160px;
}
.click-table :deep(.ant-table-row) {
  cursor: pointer;
}
.click-table :deep(.ant-table-tbody > tr.ant-table-row:hover > td) {
  background: var(--sasu-color-primary-light-bg);
}
.row-title {
  font-weight: 600;
}
.pager {
  margin-top: 16px;
  display: flex;
  justify-content: center;
}
</style>
