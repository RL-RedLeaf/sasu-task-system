<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { message } from '@/composables/feedback';
import { tasksApi, type PageData, type TaskSummary } from '@/api/tasks';
import type { NormalizedError } from '@/api/http';
import EmptyState from '@/components/EmptyState.vue';
import PageHeader from '@/components/PageHeader.vue';
import PointsNum from '@/components/PointsNum.vue';
import StatusTag from '@/components/StatusTag.vue';
import AppPagination from '@/components/AppPagination.vue';
import type { TableColumnsType } from 'ant-design-vue';

const PAGE_SIZE = 20;
const router = useRouter();

interface TabItem {
  key: string;
  label: string;
  status?: string;
}
const tabs: TabItem[] = [
  { key: 'ALL', label: '全部' },
  { key: 'PENDING_REWARD', label: '待定价', status: 'PENDING_REWARD' },
  { key: 'RECRUITING', label: '招募中', status: 'RECRUITING' },
  { key: 'FULL', label: '已满', status: 'FULL' },
  { key: 'CLOSED', label: '已截止', status: 'CLOSED' },
  { key: 'SETTLED', label: '已完成', status: 'SETTLED' },
  { key: 'CANCELLED', label: '已取消', status: 'CANCELLED' },
];

const activeTab = ref('ALL');
const items = ref<TaskSummary[]>([]);
const total = ref(0);
const page = ref(1);
const loading = ref(false);

const columns: TableColumnsType = [
  { title: '标题', key: 'title', ellipsis: true },
  { title: '分类', key: 'category', width: 120 },
  { title: '状态', key: 'status', width: 100 },
  { title: '单人赏金', key: 'reward', width: 110, align: 'right' },
  { title: '名额', key: 'quota', width: 110, align: 'center' },
  { title: '截止时间', key: 'deadlineAt', width: 170 },
];

function fmtTime(v: string | null | undefined): string {
  return v ? new Date(v).toLocaleString('zh-CN') : '—';
}

async function load(): Promise<void> {
  loading.value = true;
  try {
    const tab = tabs.find((t) => t.key === activeTab.value);
    const params: Record<string, unknown> = { page: page.value, pageSize: PAGE_SIZE };
    if (tab?.status) params.status = tab.status;
    const data: PageData<TaskSummary> = await tasksApi.myTasks(params);
    items.value = data.items;
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
function openRow(row: TaskSummary): void {
  void router.push(`/teacher/tasks/${row.id}`);
}
function customRow(record: TaskSummary): { onClick: () => void } {
  return { onClick: () => openRow(record) };
}

onMounted(() => {
  void load();
});
</script>

<template>
  <PageHeader title="我的任务" subtitle="定价上架后学生才能看到你的任务；在任务详情页验收与关闭" />
  <a-card class="block">
    <template #title>
      <div class="card-header-row">
        <a-tabs v-model:active-key="activeTab" class="full-tabs" @change="onTabChange">
          <a-tab-pane v-for="t in tabs" :key="t.key" :tab="t.label" />
        </a-tabs>
        <a-button type="primary" @click="router.push('/tasks/new')">发布任务</a-button>
      </div>
    </template>
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
              <span class="row-title">{{ record.title }}</span>
            </template>
            <template v-else-if="column.key === 'category'">{{ record.category?.name ?? '—' }}</template>
            <template v-else-if="column.key === 'status'"><StatusTag :status="record.status" /></template>
            <template v-else-if="column.key === 'reward'">
              <span v-if="record.rewardPerPerson !== null"><PointsNum class="num" :value="record.rewardPerPerson ?? 0" suffix="分" /></span>
              <span v-else class="muted">待定价</span>
            </template>
            <template v-else-if="column.key === 'quota'">{{ record.filledCount }} / {{ record.headcount }}</template>
            <template v-else-if="column.key === 'deadlineAt'">{{ fmtTime(record.deadlineAt) }}</template>
          </template>
        </a-table>
        <EmptyState v-else-if="!loading" description="还没有发布过任务">
          <a-button type="primary" @click="router.push('/tasks/new')">发布第一个任务</a-button>
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
.card-header-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
}
.full-tabs {
  flex: 1;
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
.muted {
  color: var(--sasu-text-secondary);
}
.pager {
  margin-top: 16px;
  display: flex;
  justify-content: center;
}
</style>
