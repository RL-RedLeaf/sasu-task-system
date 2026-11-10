<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import { withdrawalsApi, type WithdrawalRow } from '@/api/withdrawals';
import { pointsApi, type MyPoints } from '@/api/points';
import type { NormalizedError } from '@/api/http';
import EmptyState from '@/components/EmptyState.vue';
import PageHeader from '@/components/PageHeader.vue';
import PointsNum from '@/components/PointsNum.vue';
import StatusTag from '@/components/StatusTag.vue';

const PAGE_SIZE = 20;
const MIN_POINTS = 50;

const withdrawEnabled = ref(true);
const checked = ref(false);
const items = ref<WithdrawalRow[]>([]);
const total = ref(0);
const page = ref(1);
const loading = ref(false);
const me = ref<MyPoints | null>(null);

const amount = ref<number>(MIN_POINTS);
const submitting = ref(false);

/** 最近一条记录的汇率（后端快照，DECIMAL 字符串），用于展示预计现金 */
const latestRate = computed(() => {
  const first = items.value[0];
  if (!first) return '';
  return String(first.rate ?? '');
});
const estimatedCash = computed(() => {
  const rateNum = Number(latestRate.value);
  if (!latestRate.value || Number.isNaN(rateNum)) return '';
  return (rateNum * (amount.value || 0)).toFixed(2);
});

function fmtTime(v: string | null | undefined): string {
  return v ? new Date(v).toLocaleString('zh-CN') : '—';
}
function cashText(v: string | number | null | undefined): string {
  return v === null || v === undefined || v === '' ? '—' : `${Number(v).toFixed(2)} 元`;
}

async function load(): Promise<void> {
  loading.value = true;
  try {
    const data = await withdrawalsApi.mine({ page: page.value, pageSize: PAGE_SIZE });
    withdrawEnabled.value = data.withdrawEnabled !== false;
    items.value = data.items;
    total.value = data.total;
  } catch (e) {
    ElMessage.error((e as NormalizedError).friendlyMessage ?? '加载失败');
  } finally {
    loading.value = false;
    checked.value = true;
  }
}

async function loadPoints(): Promise<void> {
  try {
    me.value = await pointsApi.me();
  } catch {
    // 积分信息加载失败不阻塞页面
  }
}

async function onSubmit(): Promise<void> {
  const points = Number(amount.value);
  if (!Number.isInteger(points) || points < MIN_POINTS) {
    ElMessage.warning(`提现最低 ${MIN_POINTS} 积分`);
    return;
  }
  if (me.value && points > me.value.balance) {
    ElMessage.warning('超出可用积分余额');
    return;
  }
  try {
    await ElMessageBox.confirm(
      `申请提现 ${points} 积分${estimatedCash.value ? `（预计 ${estimatedCash.value} 元）` : ''}，提交后积分将被冻结，本月额度将被占用。确认提交？`,
      '提交提现申请',
      { type: 'warning', confirmButtonText: '确认提交', cancelButtonText: '取消' },
    );
  } catch {
    return;
  }
  submitting.value = true;
  try {
    await withdrawalsApi.create(points, crypto.randomUUID());
    ElMessage.success('提现申请已提交，等待管理员审批');
    amount.value = MIN_POINTS;
    await Promise.all([load(), loadPoints()]);
  } catch (e) {
    ElMessage.error((e as NormalizedError).friendlyMessage ?? '提交失败');
  } finally {
    submitting.value = false;
  }
}

async function onWithdrawRecord(row: WithdrawalRow): Promise<void> {
  try {
    await ElMessageBox.confirm(
      '撤回等同驳回：冻结积分将退回可用余额，本月额度释放。确认撤回该申请？',
      '撤回提现申请',
      { type: 'warning', confirmButtonText: '确认撤回', cancelButtonText: '取消' },
    );
  } catch {
    return;
  }
  try {
    await withdrawalsApi.selfWithdraw(row.id);
    ElMessage.success('已撤回，冻结积分已退回可用余额');
    await Promise.all([load(), loadPoints()]);
  } catch (e) {
    ElMessage.error((e as NormalizedError).friendlyMessage ?? '撤回失败');
  }
}

function changePage(p: number): void {
  page.value = p;
  void load();
}

onMounted(() => {
  void load();
  void loadPoints();
});
</script>

<template>
  <PageHeader title="申请提现" subtitle="积分兑换现金，每人每自然月可申请 1 次" />

  <template v-if="withdrawEnabled">
    <el-card shadow="never" class="block">
      <template #header>
        <div class="card-header-row">
          <span>提现申请</span>
          <span class="balance">可用积分：<PointsNum :value="me?.balance ?? 0" suffix="分" /></span>
        </div>
      </template>
      <el-alert
        class="hint"
        type="info"
        show-icon
        :closable="false"
        title="最低提现 50 积分；每人每自然月 1 次（待审批/待发放/已发放均占用当月额度）"
      />
      <el-form label-position="top" @submit.prevent="onSubmit">
        <el-form-item label="提现积分">
          <el-input-number
            v-model="amount"
            :min="MIN_POINTS"
            :step="10"
            :precision="0"
            controls-position="right"
            class="amount-input"
          />
          <span class="tip">整数积分，当前积分将全部冻结至审批完成</span>
        </el-form-item>
        <el-form-item v-if="estimatedCash" label="预计现金">
          <span class="cash"><PointsNum :value="estimatedCash" suffix="元" /></span>
          <span class="tip">按最新汇率 {{ latestRate }} 计，实际以管理员发放为准</span>
        </el-form-item>
        <el-button type="primary" :loading="submitting" @click="onSubmit">提交提现申请</el-button>
      </el-form>
    </el-card>

    <el-card shadow="never" class="block" header="我的提现记录">
      <div v-loading="loading" class="table-area">
        <el-table v-if="items.length > 0" :data="items">
          <el-table-column label="积分" width="110" align="right">
            <template #default="{ row }"><PointsNum :value="row.points" suffix="分" /></template>
          </el-table-column>
          <el-table-column label="预计现金" width="120" align="right">
            <template #default="{ row }">{{ cashText(row.cashAmount) }}</template>
          </el-table-column>
          <el-table-column label="状态" width="100">
            <template #default="{ row }"><StatusTag :status="row.status" /></template>
          </el-table-column>
          <el-table-column label="申请时间" width="170">
            <template #default="{ row }">{{ fmtTime(row.appliedAt) }}</template>
          </el-table-column>
          <el-table-column label="驳回原因" min-width="160" show-overflow-tooltip>
            <template #default="{ row }">{{ row.rejectReason || '—' }}</template>
          </el-table-column>
          <el-table-column label="操作" width="100">
            <template #default="{ row }">
              <el-button
                v-if="row.status === 'PENDING'"
                size="small"
                type="warning"
                plain
                @click="onWithdrawRecord(row as WithdrawalRow)"
              >
                撤回
              </el-button>
              <span v-else class="muted">—</span>
            </template>
          </el-table-column>
        </el-table>
        <EmptyState v-else-if="!loading" description="还没有提现记录" />
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

  <el-card v-else-if="checked" shadow="never" class="block">
    <EmptyState description="提现功能未开放，如有疑问请联系管理员" />
  </el-card>
</template>

<style scoped>
.block {
  border-radius: var(--sasu-radius-base);
  box-shadow: var(--sasu-shadow-card);
  margin-bottom: 16px;
}
.card-header-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.balance {
  color: var(--sasu-text-secondary);
  font-size: 13px;
}
.hint {
  margin-bottom: 16px;
}
.amount-input {
  width: 220px;
}
.cash {
  color: var(--sasu-color-success);
  font-size: 16px;
}
.tip {
  margin-left: 12px;
  color: var(--sasu-text-secondary);
  font-size: 12px;
}
.muted {
  color: var(--sasu-text-secondary);
}
.table-area {
  min-height: 120px;
}
.pager {
  margin-top: 16px;
  display: flex;
  justify-content: center;
}
</style>
