<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { ElMessage } from 'element-plus';
import type { NormalizedError } from '@/api/http';
import { pointsApi } from '@/api/points';
import { statsApi } from '@/api/admin';
import { tasksApi } from '@/api/tasks';
import PageHeader from '@/components/PageHeader.vue';
import PointsNum from '@/components/PointsNum.vue';

const router = useRouter();

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

interface ReconcileResult {
  ok: boolean;
  violations: { invariant: number; detail: string }[];
}
const reconcile = ref<ReconcileResult | null>(null);
const reconcileLoading = ref(false);

const statCards = computed(() => {
  const o = overview.value;
  return [
    { label: '待定价任务', value: o?.pendingReward ?? 0, to: '/admin/tasks' },
    { label: '待审批提现', value: o?.withdrawalsPending ?? 0, to: '/admin/withdrawals' },
    { label: '待处理仲裁', value: o?.disputesOpen ?? 0, to: '/admin/disputes' },
    { label: '待处理举报', value: o?.reportsOpen ?? 0, to: '/admin/reports' },
  ];
});

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

async function loadOverview(): Promise<void> {
  loading.value = true;
  try {
    overview.value = await statsApi.overview();
  } catch (e) {
    ElMessage.error((e as NormalizedError).friendlyMessage ?? '操作失败');
  } finally {
    loading.value = false;
  }
}

async function loadReconcile(): Promise<void> {
  reconcileLoading.value = true;
  try {
    reconcile.value = await pointsApi.reconcile();
  } catch (e) {
    ElMessage.error((e as NormalizedError).friendlyMessage ?? '操作失败');
  } finally {
    reconcileLoading.value = false;
  }
}

const jobs = [
  { key: 'close', label: '关闭到期任务', desc: '将已过截止时间且仍有空位的任务关闭' },
  { key: 'settle', label: '结算到期任务', desc: '对已截止且全部验收的任务执行结算发放' },
  { key: 'reminders', label: '发送提醒', desc: '任务截止提醒与教师验收超时提醒' },
  { key: 'cleanup', label: '清理通知', desc: '清理已读的历史站内通知' },
];
const jobRunning = ref<string | null>(null);

async function runJob(job: string): Promise<void> {
  jobRunning.value = job;
  try {
    await tasksApi.runJob(job);
    ElMessage.success('作业执行成功');
  } catch (e) {
    ElMessage.error((e as NormalizedError).friendlyMessage ?? '操作失败');
  } finally {
    jobRunning.value = null;
  }
}

function goPage(path: string): void {
  void router.push(path);
}

onMounted(() => {
  void loadOverview();
  void loadReconcile();
});
</script>

<template>
  <PageHeader title="管理端仪表盘" subtitle="待办概览、账务对账与运维工具" />
  <div v-loading="loading">
    <!-- 待办统计卡 -->
    <el-row :gutter="16">
      <el-col v-for="card in statCards" :key="card.label" :span="6">
        <div class="stat-card" :class="{ alert: card.value > 0 }" @click="goPage(card.to)">
          <div class="stat-value" :class="{ danger: card.value > 0 }">
            <PointsNum :value="card.value" />
          </div>
          <div class="stat-label">{{ card.label }}</div>
          <div v-if="card.value > 0" class="stat-tip">点击前往处理</div>
        </div>
      </el-col>
    </el-row>

    <el-row :gutter="16" class="mt16">
      <el-col :span="12">
        <el-card shadow="never" class="block">
          <template #header>任务状态分布</template>
          <el-empty v-if="taskStatusRows.length === 0" description="暂无任务" :image-size="80" />
          <div v-for="row in taskStatusRows" :key="row.status" class="dist-row">
            <span class="dist-label">{{ row.label }}</span>
            <el-progress
              class="dist-bar"
              :percentage="row.percent"
              :stroke-width="14"
              :show-text="false"
            />
            <span class="dist-count"><PointsNum :value="row.count" /></span>
          </div>
        </el-card>
      </el-col>
      <el-col :span="12">
        <el-card shadow="never" class="block">
          <template #header>用户角色分布</template>
          <div v-for="row in userRoleRows" :key="row.role" class="dist-row">
            <span class="dist-label">{{ row.label }}</span>
            <el-progress
              class="dist-bar"
              :percentage="row.percent"
              :stroke-width="14"
              :show-text="false"
            />
            <span class="dist-count"><PointsNum :value="row.count" /></span>
          </div>
        </el-card>
      </el-col>
    </el-row>

    <el-row :gutter="16" class="mt16">
      <el-col :span="8">
        <el-card shadow="never" class="block">
          <template #header>完成率</template>
          <div class="rate-box">
            <el-progress type="circle" :percentage="completionRate" :width="120" />
            <p class="tip">已结算任务 / 应结算任务（近 30 天）</p>
          </div>
        </el-card>
      </el-col>
      <el-col :span="8">
        <el-card shadow="never" class="block">
          <template #header>累计发放 / 退回</template>
          <div class="row"><span>基础发放</span><b><PointsNum :value="overview?.paidBaseTotal ?? 0" suffix="分" /></b></div>
          <div class="row"><span>绩效发放</span><b><PointsNum :value="overview?.paidBonusTotal ?? 0" suffix="分" /></b></div>
          <div class="row"><span>退回积分池</span><b><PointsNum :value="overview?.refundedTotal ?? 0" suffix="分" /></b></div>
          <div class="row"><span>违约扣分合计</span><b><PointsNum :value="overview?.violationTotal ?? 0" suffix="分" /></b></div>
        </el-card>
      </el-col>
      <el-col :span="8">
        <el-card shadow="never" class="block">
          <template #header>运维工具（手动触发定时作业）</template>
          <div v-for="job in jobs" :key="job.key" class="job-row">
            <div class="job-info">
              <b>{{ job.label }}</b>
              <p class="tip">{{ job.desc }}</p>
            </div>
            <el-button
              size="small"
              type="primary"
              plain
              :loading="jobRunning === job.key"
              @click="runJob(job.key)"
            >
              执行
            </el-button>
          </div>
        </el-card>
      </el-col>
    </el-row>

    <!-- 对账 -->
    <el-card shadow="never" class="block mt16">
      <template #header>
        <div class="card-header-row">
          <span>积分账务对账</span>
          <el-button size="small" :loading="reconcileLoading" @click="loadReconcile">重新对账</el-button>
        </div>
      </template>
      <template v-if="reconcile">
        <el-result
          v-if="reconcile.ok"
          icon="success"
          title="账务全部一致"
          sub-title="积分池、托管、用户账户与流水全部满足守恒不变式"
        />
        <template v-else>
          <el-alert type="error" :closable="false" title="对账发现异常，以下不变式被破坏" show-icon />
          <el-table :data="reconcile.violations" class="mt8">
            <el-table-column prop="invariant" label="不变式编号" width="120" />
            <el-table-column prop="detail" label="异常详情" />
          </el-table>
        </template>
      </template>
    </el-card>
  </div>
</template>

<style scoped>
.mt16 {
  margin-top: 16px;
}
.mt8 {
  margin-top: 8px;
}
.stat-card {
  background: var(--sasu-bg-card);
  border-radius: var(--sasu-radius-base);
  box-shadow: var(--sasu-shadow-card);
  padding: 20px;
  cursor: pointer;
  transition: box-shadow 0.2s;
}
.stat-card:hover {
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
}
.stat-card.alert {
  background: var(--sasu-color-primary-light-bg);
}
.stat-value {
  font-size: 28px;
}
.stat-value.danger {
  color: var(--sasu-color-primary);
}
.stat-label {
  margin-top: 6px;
  color: var(--sasu-text-secondary);
}
.stat-tip {
  margin-top: 4px;
  font-size: 12px;
  color: var(--sasu-color-primary);
}
.block {
  border-radius: var(--sasu-radius-base);
  box-shadow: var(--sasu-shadow-card);
  height: 100%;
}
/* 同一行内的卡片等高：el-col 变 flex，卡片撑满列高 */
.equal-row > .el-col {
  display: flex;
  flex-direction: column;
}
.equal-row > .el-col > .el-card {
  flex: 1;
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
.rate-box {
  text-align: center;
  padding: 8px 0;
}
.tip {
  color: var(--sasu-text-secondary);
  font-size: 12px;
  margin: 8px 0 0;
}
.row {
  display: flex;
  justify-content: space-between;
  padding: 8px 0;
}
.card-header-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
}
.job-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 0;
  border-bottom: 1px solid var(--sasu-border);
}
.job-row:last-child {
  border-bottom: none;
}
.job-info b {
  font-size: 13px;
}
.job-info .tip {
  margin-top: 2px;
}
</style>
