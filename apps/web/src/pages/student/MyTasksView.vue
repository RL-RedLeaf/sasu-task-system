<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { ElMessage } from 'element-plus';
import { tasksApi, type AssignmentRow } from '@/api/tasks';
import type { NormalizedError } from '@/api/http';
import EmptyState from '@/components/EmptyState.vue';
import PageHeader from '@/components/PageHeader.vue';
import PointsNum from '@/components/PointsNum.vue';
import StatusTag from '@/components/StatusTag.vue';

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
function openRow(row: MyRow): void {
  void router.push(`/my/tasks/${row.id}`);
}

onMounted(() => {
  void load();
});
</script>

<template>
  <PageHeader title="我的任务" subtitle="接单后按时提交交付物，被驳回时请在重交窗口内重新提交" />
  <el-card shadow="never" class="block">
    <el-tabs v-model="activeTab" @tab-change="onTabChange">
      <el-tab-pane v-for="t in tabs" :key="t.key" :label="t.label" :name="t.key" />
    </el-tabs>
    <div v-loading="loading" class="table-area">
      <el-table
        v-if="items.length > 0"
        :data="items"
        class="click-table"
        @row-click="openRow"
      >
        <el-table-column label="任务标题" min-width="220">
          <template #default="{ row }">
            <span class="row-title">{{ row.task?.title ?? `任务 #${row.taskId}` }}</span>
          </template>
        </el-table-column>
        <el-table-column label="分类" width="120">
          <template #default="{ row }">{{ row.task?.category?.name ?? '—' }}</template>
        </el-table-column>
        <el-table-column label="单人赏金" width="110" align="right">
          <template #default="{ row }">
            <PointsNum :value="row.task?.rewardPerPerson ?? 0" suffix="分" />
          </template>
        </el-table-column>
        <el-table-column label="我的状态" width="100">
          <template #default="{ row }">
            <StatusTag :status="row.status" />
          </template>
        </el-table-column>
        <el-table-column label="接单时间" width="170">
          <template #default="{ row }">{{ fmtTime(row.claimedAt) }}</template>
        </el-table-column>
        <el-table-column label="" width="60" align="right">
          <template #default="{ row }">
            <span class="row-title">›</span>
          </template>
        </el-table-column>
      </el-table>
      <EmptyState v-else-if="!loading" description="还没有接过的任务，去任务大厅看看吧">
        <el-button type="primary" @click="router.push('/tasks')">逛逛任务大厅</el-button>
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
.pager {
  margin-top: 16px;
  display: flex;
  justify-content: center;
}
</style>
