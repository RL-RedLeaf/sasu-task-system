<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { ElMessage } from 'element-plus';
import { tasksApi, type PageData, type TaskSummary } from '@/api/tasks';
import type { NormalizedError } from '@/api/http';
import EmptyState from '@/components/EmptyState.vue';
import PageHeader from '@/components/PageHeader.vue';
import PointsNum from '@/components/PointsNum.vue';
import StatusTag from '@/components/StatusTag.vue';

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
    ElMessage.error((e as NormalizedError).friendlyMessage ?? '加载失败');
  } finally {
    loading.value = false;
  }
}

function onTabChange(): void {
  page.value = 1;
  void load();
}
function changePage(p: number): void {
  page.value = p;
  void load();
}
function openRow(row: TaskSummary): void {
  void router.push(`/teacher/tasks/${row.id}`);
}

onMounted(() => {
  void load();
});
</script>

<template>
  <PageHeader title="我的任务" subtitle="定价上架后学生才能看到你的任务；在任务详情页验收与关闭" />
  <el-card shadow="never" class="block">
    <template #header>
      <div class="card-header-row">
        <el-tabs v-model="activeTab" class="full-tabs" @tab-change="onTabChange">
          <el-tab-pane v-for="t in tabs" :key="t.key" :label="t.label" :name="t.key" />
        </el-tabs>
        <el-button type="primary" @click="router.push('/tasks/new')">发布任务</el-button>
      </div>
    </template>
    <div v-loading="loading" class="table-area">
      <el-table v-if="items.length > 0" :data="items" class="click-table" @row-click="openRow">
        <el-table-column label="标题" min-width="220" show-overflow-tooltip>
          <template #default="{ row }">
            <span class="row-title">{{ row.title }}</span>
          </template>
        </el-table-column>
        <el-table-column label="分类" width="120">
          <template #default="{ row }">{{ row.category?.name ?? '—' }}</template>
        </el-table-column>
        <el-table-column label="状态" width="100">
          <template #default="{ row }"><StatusTag :status="row.status" /></template>
        </el-table-column>
        <el-table-column label="单人赏金" width="110" align="right">
          <template #default="{ row }">
            <span v-if="row.rewardPerPerson !== null"><PointsNum :value="row.rewardPerPerson ?? 0" suffix="分" /></span>
            <span v-else class="muted">待定价</span>
          </template>
        </el-table-column>
        <el-table-column label="名额" width="110" align="center">
          <template #default="{ row }">{{ row.filledCount }} / {{ row.headcount }}</template>
        </el-table-column>
        <el-table-column label="截止时间" width="170">
          <template #default="{ row }">{{ fmtTime(row.deadlineAt) }}</template>
        </el-table-column>
      </el-table>
      <EmptyState v-else-if="!loading" description="还没有发布过任务">
        <el-button type="primary" @click="router.push('/tasks/new')">发布第一个任务</el-button>
      </EmptyState>
    </div>
    <div class="pager">
      <el-pagination
        v-model:current-page="page"
        :page-size="PAGE_SIZE"
        :total="total"
        layout="total, prev, pager, next"
        background
        hide-on-single-page
        @current-change="changePage"
      />
    </div>
  </el-card>
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
  margin-bottom: -20px;
}
.table-area {
  min-height: 160px;
}
.click-table {
  width: 100%;
  cursor: pointer;
  --el-table-row-hover-bg-color: var(--sasu-color-primary-light-bg);
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
