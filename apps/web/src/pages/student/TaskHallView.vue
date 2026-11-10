<script setup lang="ts">
import { onBeforeUnmount, onMounted, reactive, ref } from 'vue';
import { useRouter } from 'vue-router';
import { ElMessage } from 'element-plus';
import { Clock, Location, User, Search, Refresh, Coin } from '@element-plus/icons-vue';
import { categoriesApi, type CategoryRow } from '@/api/admin';
import { tasksApi, type PageData, type TaskSummary } from '@/api/tasks';
import type { NormalizedError } from '@/api/http';
import EmptyState from '@/components/EmptyState.vue';
import StatusTag from '@/components/StatusTag.vue';
import { useAuthStore } from '@/stores/auth';
import { pointsApi } from '@/api/points';

const auth = useAuthStore();
const myPoints = ref<{ balance: number } | null>(null);

const PAGE_SIZE = 20;

function teacherLabel(name?: string): string {
  if (!name) return '—';
  return name.endsWith('老师') ? name : name + '老师';
}

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

function quotaPercent(t: TaskSummary): number {
  const filled = t.headcount - (t.remaining ?? t.headcount - t.filledCount);
  if (t.headcount <= 0) return 0;
  return Math.min(100, Math.round((filled / t.headcount) * 100));
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
  if (auth.role === 'STUDENT') {
    pointsApi.me().then((r) => (myPoints.value = r)).catch(() => undefined);
  }
  await load();
});
onBeforeUnmount(() => {
  if (timer) clearInterval(timer);
});
</script>

<template>
  <section class="hall-hero">
    <div class="hero-text">
      <h2>任务大厅</h2>
      <p>先到先得接单，按时提交交付物，验收通过即刻获得积分</p>
    </div>
    <div v-if="auth.role === 'STUDENT' && myPoints" class="hero-chip">
      <el-icon><Coin /></el-icon>
      <span>我的可用积分</span>
      <b class="num">{{ myPoints.balance }}</b>
    </div>
  </section>

  <el-card shadow="never" class="filter-card">
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
        <span class="range-label">赏金</span>
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
        :prefix-icon="Search"
        @keyup.enter="search"
        @clear="search"
      />
      <el-button type="primary" :icon="Search" @click="search">搜索</el-button>
      <el-button :icon="Refresh" @click="reset">重置</el-button>
    </div>
  </el-card>

  <div v-loading="loading" class="list-area">
    <div v-if="items.length > 0" class="cards">
      <article v-for="t in items" :key="t.id" class="task-card" @click="openDetail(t.id)">
        <header class="card-head">
          <span class="cat">{{ t.category?.name ?? '未分类' }}</span>
          <StatusTag :status="t.status" />
        </header>
        <h3 class="title">{{ t.title }}</h3>
        <div class="meta">
          <span class="meta-item"><el-icon><User /></el-icon>{{ teacherLabel(t.teacher?.name) }}</span>
          <span v-if="t.location" class="meta-item"><el-icon><Location /></el-icon>{{ t.location }}</span>
        </div>
        <div class="quota-line">
          <div class="quota-bar">
            <div class="quota-fill" :style="{ width: quotaPercent(t) + '%' }" />
          </div>
          <span class="quota-text">
            已报 <b>{{ t.headcount - (t.remaining ?? t.headcount - t.filledCount) }}</b> / {{ t.headcount }} 人
          </span>
        </div>
        <footer class="card-foot">
          <div class="reward">
            <span class="reward-num num">{{ t.rewardPerPerson ?? '—' }}</span>
            <span class="reward-unit">积分/人</span>
          </div>
          <span class="deadline" :class="{ urgent: isUrgent(t.deadlineAt) }">
            <el-icon><Clock /></el-icon>
            {{ remainingText(t.deadlineAt) }}
          </span>
        </footer>
      </article>
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
.hall-hero {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 20px 24px;
  margin-bottom: 16px;
  border-radius: var(--sasu-radius-base);
  background: linear-gradient(135deg, var(--sasu-color-primary-light-bg) 0%, #ffffff 70%);
  border: 1px solid #f3d9da;
}
.hall-hero h2 {
  margin: 0 0 4px;
  font-size: 22px;
  color: var(--sasu-text-primary);
}
.hall-hero p {
  margin: 0;
  color: var(--sasu-text-secondary);
  font-size: 13px;
}
.hero-chip {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 16px;
  background: #fff;
  border: 1px solid var(--sasu-border);
  border-radius: 999px;
  color: var(--sasu-text-secondary);
  font-size: 13px;
  white-space: nowrap;
}
.hero-chip .el-icon {
  color: var(--sasu-color-primary);
}
.hero-chip b {
  font-size: 18px;
  color: var(--sasu-color-primary);
}
.filter-card {
  margin-bottom: 16px;
  border-radius: var(--sasu-radius-base);
  box-shadow: var(--sasu-shadow-card);
}
.filter-bar {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}
.w-category {
  width: 140px;
}
.w-status {
  width: 118px;
}
.w-sort {
  width: 118px;
}
.w-keyword {
  width: 230px;
}
.w-num {
  width: 90px;
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
  gap: 16px;
}
.task-card {
  display: flex;
  flex-direction: column;
  padding: 18px 20px;
  background: var(--sasu-bg-card);
  border: 1px solid var(--sasu-border);
  border-radius: 10px;
  box-shadow: var(--sasu-shadow-card);
  cursor: pointer;
  transition:
    transform 0.18s ease,
    box-shadow 0.18s ease,
    border-color 0.18s ease;
}
.task-card:hover {
  transform: translateY(-2px);
  border-color: #eec3c5;
  box-shadow: 0 6px 16px rgba(180, 35, 42, 0.1);
}
.card-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}
.cat {
  font-size: 12px;
  color: var(--sasu-text-secondary);
  background: var(--sasu-color-secondary-bg);
  padding: 2px 10px;
  border-radius: 999px;
}
.title {
  margin: 10px 0 8px;
  font-size: 16px;
  line-height: 1.4;
  color: var(--sasu-text-primary);
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
.meta {
  display: flex;
  align-items: center;
  gap: 14px;
  flex-wrap: wrap;
}
.meta-item {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  color: var(--sasu-text-secondary);
  font-size: 13px;
}
.meta-item .el-icon {
  font-size: 14px;
}
.quota-line {
  margin-top: 12px;
  display: flex;
  align-items: center;
  gap: 10px;
}
.quota-bar {
  flex: 1;
  height: 6px;
  border-radius: 999px;
  background: var(--sasu-border);
  overflow: hidden;
}
.quota-fill {
  height: 100%;
  border-radius: 999px;
  background: linear-gradient(90deg, var(--sasu-color-primary), #d96c5f);
  transition: width 0.3s ease;
}
.quota-text {
  font-size: 12px;
  color: var(--sasu-text-secondary);
  white-space: nowrap;
}
.quota-text b {
  color: var(--sasu-text-primary);
}
.card-foot {
  margin-top: 14px;
  padding-top: 12px;
  border-top: 1px solid var(--sasu-border);
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.reward-num {
  font-size: 20px;
  color: var(--sasu-color-primary);
}
.reward-unit {
  margin-left: 4px;
  font-size: 12px;
  color: var(--sasu-text-secondary);
}
.deadline {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 12px;
  color: var(--sasu-text-secondary);
}
.deadline.urgent {
  color: var(--sasu-color-danger);
  background: var(--sasu-color-primary-light-bg);
  padding: 2px 10px;
  border-radius: 999px;
}
.pager {
  margin-top: 16px;
  display: flex;
  justify-content: center;
}
</style>
