<script setup lang="ts">
import { onBeforeUnmount, onMounted, reactive, ref } from 'vue';
import { useRouter } from 'vue-router';
import { ElMessage } from 'element-plus';
import { categoriesApi, type CategoryRow } from '@/api/admin';
import { tasksApi, type PageData, type TaskSummary } from '@/api/tasks';
import type { NormalizedError } from '@/api/http';
import EmptyState from '@/components/EmptyState.vue';
import PageHeader from '@/components/PageHeader.vue';
import PointsNum from '@/components/PointsNum.vue';
import StatusTag from '@/components/StatusTag.vue';

const PAGE_SIZE = 20;
const router = useRouter();

const categories = ref<CategoryRow[]>([]);
const items = ref<TaskSummary[]>([]);
const total = ref(0);
const page = ref(1);
const loading = ref(false);
const filters = reactive({
  categoryId: undefined as number | undefined,
  status: undefined as string | undefined,
  minReward: undefined as number | undefined,
  maxReward: undefined as number | undefined,
  keyword: '',
  orderBy: 'latest',
});

const statusOptions = [
  { value: 'RECRUITING', label: '招募中' },
  { value: 'FULL', label: '已满' },
  { value: 'CLOSED', label: '已截止' },
  { value: 'SETTLED', label: '已完成' },
  { value: 'CANCELLED', label: '已取消' },
  { value: 'OFFLINE', label: '已下架' },
];
const sortOptions = [
  { value: 'latest', label: '最新发布' },
  { value: 'deadline', label: '即将截止' },
  { value: 'reward', label: '赏金最高' },
];

/** 倒计时用响应式时钟（30s 刷新一次） */
const now = ref(Date.now());
let timer: ReturnType<typeof setInterval> | null = null;

function remainingText(deadline: string | null | undefined): string {
  if (!deadline) return '';
  const diff = new Date(deadline).getTime() - now.value;
  if (diff <= 0) return '已截止';
  const days = Math.floor(diff / 86_400_000);
  const hours = Math.floor((diff % 86_400_000) / 3_600_000);
  const minutes = Math.floor((diff % 3_600_000) / 60_000);
  if (days > 0) return `剩余 ${days} 天 ${hours} 小时`;
  if (hours > 0) return `剩余 ${hours} 小时 ${minutes} 分钟`;
  return `剩余 ${minutes} 分钟`;
}
function isUrgent(deadline: string | null | undefined): boolean {
  if (!deadline) return false;
  const diff = new Date(deadline).getTime() - now.value;
  return diff > 0 && diff < 24 * 3_600_000;
}

function buildParams(): Record<string, unknown> {
  const params: Record<string, unknown> = {
    page: page.value,
    pageSize: PAGE_SIZE,
    orderBy: filters.orderBy,
  };
  if (filters.categoryId) params.categoryId = filters.categoryId;
  if (filters.status) params.status = filters.status;
  if (filters.minReward !== undefined && filters.minReward !== null) params.minReward = filters.minReward;
  if (filters.maxReward !== undefined && filters.maxReward !== null) params.maxReward = filters.maxReward;
  const kw = filters.keyword.trim();
  if (kw) params.keyword = kw;
  return params;
}

async function load(): Promise<void> {
  loading.value = true;
  try {
    const data: PageData<TaskSummary> = await tasksApi.hall(buildParams());
    items.value = data.items;
    total.value = data.total;
  } catch (e) {
    ElMessage.error((e as NormalizedError).friendlyMessage ?? '加载失败');
  } finally {
    loading.value = false;
  }
}

function search(): void {
  page.value = 1;
  void load();
}
function reset(): void {
  filters.categoryId = undefined;
  filters.status = undefined;
  filters.minReward = undefined;
  filters.maxReward = undefined;
  filters.keyword = '';
  filters.orderBy = 'latest';
  search();
}
function changePage(p: number): void {
  page.value = p;
  void load();
}
function openDetail(id: string): void {
  void router.push(`/tasks/${id}`);
}

onMounted(async () => {
  timer = setInterval(() => {
    now.value = Date.now();
  }, 30_000);
  try {
    const r = await categoriesApi.list();
    categories.value = r.items;
  } catch {
    // 分类加载失败不阻塞大厅
  }
  await load();
});
onBeforeUnmount(() => {
  if (timer) clearInterval(timer);
});
</script>

<template>
  <PageHeader title="任务大厅" subtitle="先到先得接单，按时提交交付物，验收通过即刻获得积分" />
  <el-card shadow="never" class="block filter-card">
    <div class="filter-bar">
      <el-select
        v-model="filters.categoryId"
        placeholder="全部分类"
        clearable
        filterable
        class="w-category"
        @change="search"
      >
        <el-option v-for="c in categories" :key="c.id" :label="c.name" :value="Number(c.id)" />
      </el-select>
      <el-select v-model="filters.status" placeholder="全部状态" clearable class="w-status" @change="search">
        <el-option v-for="s in statusOptions" :key="s.value" :label="s.label" :value="s.value" />
      </el-select>
      <div class="reward-range">
        <span class="range-label">赏金区间</span>
        <el-input-number
          v-model="filters.minReward"
          :min="1"
          :max="9999"
          :controls="false"
          placeholder="最低"
          class="w-num"
        />
        <span class="range-sep">—</span>
        <el-input-number
          v-model="filters.maxReward"
          :min="1"
          :max="9999"
          :controls="false"
          placeholder="最高"
          class="w-num"
        />
      </div>
      <el-select v-model="filters.orderBy" class="w-sort" @change="search">
        <el-option v-for="s in sortOptions" :key="s.value" :label="s.label" :value="s.value" />
      </el-select>
      <el-input
        v-model="filters.keyword"
        placeholder="搜索任务标题 / 描述"
        clearable
        class="w-keyword"
        @keyup.enter="search"
        @clear="search"
      />
      <el-button type="primary" @click="search">搜索</el-button>
      <el-button @click="reset">重置</el-button>
    </div>
  </el-card>

  <div v-loading="loading" class="list-area">
    <div v-if="items.length > 0" class="cards">
      <el-card
        v-for="t in items"
        :key="t.id"
        shadow="never"
        class="task-card"
        @click="openDetail(t.id)"
      >
        <div class="card-top">
          <span class="title" :title="t.title">{{ t.title }}</span>
          <StatusTag :status="t.status" />
        </div>
        <div class="card-meta">
          <el-tag size="small" effect="plain" type="info">{{ t.category?.name ?? '未分类' }}</el-tag>
          <span class="teacher">{{ t.teacher?.name ?? '—' }} 老师</span>
        </div>
        <div class="card-info">
          <span class="reward"><PointsNum :value="t.rewardPerPerson ?? 0" suffix="分/人" /></span>
          <span class="quota">
            剩余名额
            <b :class="{ none: (t.remaining ?? 0) <= 0 }">{{ t.remaining ?? Math.max(0, t.headcount - t.filledCount) }}</b>
            / {{ t.headcount }}
          </span>
        </div>
        <div class="card-bottom">
          <span class="deadline" :style="isUrgent(t.deadlineAt) ? { color: 'var(--sasu-color-danger)' } : {}">
            {{ remainingText(t.deadlineAt) }}
          </span>
          <el-link type="primary" :underline="false" @click.stop="openDetail(t.id)">查看详情 →</el-link>
        </div>
      </el-card>
    </div>
    <EmptyState v-else-if="!loading" description="暂无符合条件的任务，换个筛选条件试试" />
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
</template>

<style scoped>
.block {
  border-radius: var(--sasu-radius-base);
  box-shadow: var(--sasu-shadow-card);
}
.filter-card {
  margin-bottom: 16px;
}
.filter-bar {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}
.w-category {
  width: 150px;
}
.w-status {
  width: 120px;
}
.w-sort {
  width: 120px;
}
.w-keyword {
  width: 220px;
}
.w-num {
  width: 100px;
}
.reward-range {
  display: flex;
  align-items: center;
  gap: 6px;
}
.range-label {
  color: var(--sasu-text-secondary);
  font-size: 13px;
  white-space: nowrap;
}
.range-sep {
  color: var(--sasu-text-secondary);
}
.list-area {
  min-height: 200px;
}
.cards {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
  gap: 12px;
}
.task-card {
  border-radius: var(--sasu-radius-base);
  box-shadow: var(--sasu-shadow-card);
  cursor: pointer;
  transition: box-shadow 0.2s;
}
.task-card:hover {
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
}
.card-top {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 8px;
}
.title {
  font-size: 15px;
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
}
.card-meta {
  margin-top: 8px;
  display: flex;
  align-items: center;
  gap: 10px;
}
.teacher {
  color: var(--sasu-text-secondary);
  font-size: 13px;
}
.card-info {
  margin-top: 10px;
  display: flex;
  align-items: baseline;
  justify-content: space-between;
}
.reward {
  font-size: 15px;
  color: var(--sasu-color-primary);
}
.quota {
  color: var(--sasu-text-secondary);
  font-size: 13px;
}
.quota b.none {
  color: var(--sasu-color-danger);
}
.card-bottom {
  margin-top: 10px;
  padding-top: 8px;
  border-top: 1px solid var(--sasu-border);
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.deadline {
  font-size: 13px;
  color: var(--sasu-text-secondary);
}
.pager {
  margin-top: 16px;
  display: flex;
  justify-content: center;
}
</style>
