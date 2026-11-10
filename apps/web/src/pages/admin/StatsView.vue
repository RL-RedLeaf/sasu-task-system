<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { message } from '@/composables/feedback';
import type { NormalizedError } from '@/api/http';
import { statsApi } from '@/api/admin';
import PageHeader from '@/components/PageHeader.vue';
import PointsNum from '@/components/PointsNum.vue';

function errMsg(e: unknown): string {
  return (e as NormalizedError).friendlyMessage ?? '操作失败';
}

interface Overview {
  tasksByStatus: Record<string, number>;
  usersByRole: Record<string, number>;
  pendingReward: number;
  paidBaseTotal: number;
  paidBonusTotal: number;
  refundedTotal: number;
  violationTotal: number;
  withdrawalsPending: number;
  disputesOpen: number;
  reportsOpen: number;
  completionRate: number;
}

const overview = ref<Overview | null>(null);
const loading = ref(false);

async function load(): Promise<void> {
  loading.value = true;
  try {
    overview.value = await statsApi.overview();
  } catch (e) {
    message.error(errMsg(e));
  } finally {
    loading.value = false;
  }
}

onMounted(() => void load());

const taskStatusLabels: Record<string, string> = {
  PENDING_REWARD: '待定价',
  RECRUITING: '招募中',
  FULL: '已满',
  OFFLINE: '已下架',
  CLOSED: '已截止',
  SETTLED: '已完成',
  CANCELLED: '已取消',
};

const taskStatusRows = computed(() => {
  const map = overview.value?.tasksByStatus ?? {};
  const max = Math.max(...Object.values(map), 1);
  return Object.entries(map).map(([status, count]) => ({
    status,
    label: taskStatusLabels[status] ?? status,
    count,
    percent: Math.round((count / max) * 1000) / 10,
  }));
});

const roleLabels: Record<string, string> = { STUDENT: '学生', TEACHER: '教师', ADMIN: '管理员' };
const userRoleRows = computed(() => {
  const map = overview.value?.usersByRole ?? {};
  const total = Object.values(map).reduce((a, b) => a + b, 0) || 1;
  return Object.entries(map).map(([role, count]) => ({
    role,
    label: roleLabels[role] ?? role,
    count,
    percent: Math.round((count / total) * 1000) / 10,
  }));
});

const completionRate = computed(() => Math.round((overview.value?.completionRate ?? 0) * 1000) / 10);
const paidTotal = computed(() => (overview.value?.paidBaseTotal ?? 0) + (overview.value?.paidBonusTotal ?? 0));
</script>

<template>
  <div class="page-top">
    <PageHeader title="平台统计" subtitle="任务、用户与积分的关键指标一览" />
    <a :href="statsApi.exportUrl" class="export-btn">
      <a-button type="primary">导出统计报表（xlsx）</a-button>
    </a>
  </div>

  <a-spin :spinning="loading">
    <a-row :gutter="16">
      <a-col :span="6">
        <a-card class="block">
          <div class="stat-label">任务总数</div>
          <div class="stat-value"><PointsNum :value="taskStatusRows.reduce((a, b) => a + b.count, 0)" /></div>
          <div class="stat-sub">其中待定价 {{ overview?.pendingReward ?? 0 }} 个</div>
        </a-card>
      </a-col>
      <a-col :span="6">
        <a-card class="block">
          <div class="stat-label">用户总数</div>
          <div class="stat-value"><PointsNum :value="userRoleRows.reduce((a, b) => a + b.count, 0)" /></div>
          <div class="stat-sub">学生 {{ userRoleRows.find((r) => r.role === 'STUDENT')?.count ?? 0 }} / 教师 {{ userRoleRows.find((r) => r.role === 'TEACHER')?.count ?? 0 }}</div>
        </a-card>
      </a-col>
      <a-col :span="6">
        <a-card class="block">
          <div class="stat-label">任务完成率（近 30 天）</div>
          <div class="stat-value">{{ completionRate }}<span class="pct">%</span></div>
          <div class="stat-sub">待审批提现 {{ overview?.withdrawalsPending ?? 0 }} / 待处理仲裁 {{ overview?.disputesOpen ?? 0 }}</div>
        </a-card>
      </a-col>
      <a-col :span="6">
        <a-card class="block">
          <div class="stat-label">累计发放积分</div>
          <div class="stat-value"><PointsNum :value="paidTotal" suffix="分" /></div>
          <div class="stat-sub">基础 {{ overview?.paidBaseTotal ?? 0 }} + 绩效 {{ overview?.paidBonusTotal ?? 0 }}</div>
        </a-card>
      </a-col>
    </a-row>

    <a-row :gutter="16" class="mt16 dash-row">
      <a-col :span="12">
        <a-card class="block" title="任务状态分布">
          <div v-for="row in taskStatusRows" :key="row.status" class="dist-row">
            <span class="dist-label">{{ row.label }}</span>
            <a-progress
              class="dist-bar"
              :percent="row.percent"
              :stroke-width="14"
              :show-info="false"
              stroke-color="var(--sasu-color-primary)"
            />
            <span class="dist-count"><PointsNum :value="row.count" /></span>
          </div>
          <p class="tip">
            退回积分池累计 <b><PointsNum :value="overview?.refundedTotal ?? 0" suffix="分" /></b>，违约扣分合计
            <b><PointsNum :value="overview?.violationTotal ?? 0" suffix="分" /></b>
          </p>
        </a-card>
      </a-col>
      <a-col :span="12">
        <a-card class="block" title="用户角色分布">
          <div v-for="row in userRoleRows" :key="row.role" class="dist-row">
            <span class="dist-label">{{ row.label }}</span>
            <a-progress
              class="dist-bar"
              :percent="row.percent"
              :stroke-width="14"
              :show-info="false"
              stroke-color="var(--sasu-color-secondary)"
            />
            <span class="dist-count"><PointsNum :value="row.count" /></span>
          </div>
          <p class="tip">完成率按已结算任务占应结算任务比例统计（近 30 天）</p>
        </a-card>
      </a-col>
    </a-row>
  </a-spin>
</template>

<style scoped>
.page-top {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  margin-bottom: 16px;
}
.export-btn {
  text-decoration: none;
}
.mt16 {
  margin-top: 16px;
}
.block {
  border-radius: var(--sasu-radius-base);
  box-shadow: var(--sasu-shadow-card);
  height: 100%;
}
.dash-row :deep(.ant-col) {
  display: flex;
  flex-direction: column;
}
.dash-row .block {
  flex: 1;
}
.stat-label {
  color: var(--sasu-text-secondary);
  font-size: 13px;
}
.stat-value {
  font-size: 26px;
  font-weight: 600;
  margin-top: 6px;
}
.stat-value .pct {
  font-size: 16px;
  font-weight: 400;
  margin-left: 2px;
}
.stat-sub {
  margin-top: 6px;
  color: var(--sasu-text-secondary);
  font-size: 12px;
}
.dist-row {
  display: flex;
  align-items: center;
  padding: 6px 0;
}
.dist-label {
  width: 72px;
  flex-shrink: 0;
}
.dist-bar {
  flex: 1;
}
.dist-count {
  width: 48px;
  text-align: right;
  flex-shrink: 0;
}
.tip {
  color: var(--sasu-text-secondary);
  font-size: 12px;
  margin-top: 12px;
}
</style>
