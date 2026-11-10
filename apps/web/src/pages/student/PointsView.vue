<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { ElMessage } from 'element-plus';
import { pointsApi, type MyPoints, type TxRow } from '@/api/points';
import type { NormalizedError } from '@/api/http';
import EmptyState from '@/components/EmptyState.vue';
import PageHeader from '@/components/PageHeader.vue';
import PointsNum from '@/components/PointsNum.vue';

const PAGE_SIZE = 20;

const me = ref<MyPoints | null>(null);
const items = ref<TxRow[]>([]);
const total = ref(0);
const page = ref(1);
const loading = ref(false);

/** 交易类型中文（PRD §9.2.1） */
const typeLabel: Record<string, string> = {
  POOL_TOPUP: '积分池充值',
  POOL_ADJUST_DOWN: '积分池调减',
  ADMIN_GRANT: '管理员发放',
  ADMIN_DEDUCT: '管理员扣减',
  TASK_FREEZE: '任务托管划转',
  TASK_PAYOUT: '验收发放',
  TASK_REPRICE_TOPUP: '改价补差',
  TASK_ARBITRATION: '仲裁补偿',
  TASK_BONUS: '剩余份额再分配',
  TASK_REFUND: '任务退回',
  VIOLATION_DEDUCT: '违约扣分',
  DEBT_OFFSET: '欠分抵扣',
  WITHDRAW_FREEZE: '提现冻结',
  WITHDRAW_REFUND: '提现解冻',
  WITHDRAW_PAID: '提现发放',
  ARBITRATION_PAY: '仲裁发放',
};

const hasDebt = computed(() => (me.value?.penaltyDebt ?? 0) > 0);

function fmtTime(v: string | null | undefined): string {
  return v ? new Date(v).toLocaleString('zh-CN') : '—';
}
function typeText(row: TxRow): string {
  return typeLabel[row.type] ?? row.type;
}
/** 用户视角的变动 = 该用户账户分录之和（提现场景有 AVAILABLE/FROZEN 两腿，和为 0） */
function deltaOf(row: TxRow): number {
  return (row.legs ?? []).reduce((sum, l) => sum + (l.delta ?? 0), 0);
}
/** 余额快照：优先取可用分录的余额，否则取最后一腿 */
function balanceOf(row: TxRow): number {
  const legs = row.legs ?? [];
  if (legs.length === 0) return 0;
  const avail = legs.find((l) => l.bucket === 'AVAILABLE');
  return (avail ?? legs[legs.length - 1]).balanceAfter;
}

async function loadMe(): Promise<void> {
  try {
    me.value = await pointsApi.me();
  } catch (e) {
    ElMessage.error((e as NormalizedError).friendlyMessage ?? '加载失败');
  }
}

async function load(): Promise<void> {
  loading.value = true;
  try {
    const data = await pointsApi.myTransactions({ page: page.value, pageSize: PAGE_SIZE });
    items.value = data.items;
    total.value = data.total;
  } catch (e) {
    ElMessage.error((e as NormalizedError).friendlyMessage ?? '加载失败');
  } finally {
    loading.value = false;
  }
}

function changePage(p: number): void {
  page.value = p;
  void load();
}

onMounted(() => {
  void loadMe();
  void load();
});
</script>

<template>
  <PageHeader title="我的积分" subtitle="积分由验收发放，可用于提现（每自然月 1 次）" />
  <div class="stat-cards">
    <el-card shadow="never" class="stat-card">
      <div class="stat-label">可用积分</div>
      <div class="stat-value"><PointsNum :value="me?.balance ?? 0" suffix="分" /></div>
    </el-card>
    <el-card shadow="never" class="stat-card">
      <div class="stat-label">冻结中</div>
      <div class="stat-value"><PointsNum :value="me?.frozen ?? 0" suffix="分" /></div>
      <div class="stat-sub">提现审批期间冻结</div>
    </el-card>
    <el-card shadow="never" class="stat-card" :class="{ debt: hasDebt }">
      <div class="stat-label">欠分</div>
      <div class="stat-value" :style="hasDebt ? { color: 'var(--sasu-color-danger)' } : {}">
        <PointsNum :value="me?.penaltyDebt ?? 0" suffix="分" />
      </div>
      <div v-if="hasDebt" class="stat-sub debt-text">欠分将从未来收入优先抵扣</div>
      <div v-else class="stat-sub">违约金未扣足时产生</div>
    </el-card>
    <el-card shadow="never" class="stat-card">
      <div class="stat-label">累计获得</div>
      <div class="stat-value earned"><PointsNum :value="me?.totalEarned ?? 0" suffix="分" /></div>
      <div class="stat-sub">只统计正向入账</div>
    </el-card>
  </div>

  <el-card shadow="never" class="block" header="积分流水">
    <div v-loading="loading" class="table-area">
      <el-table v-if="items.length > 0" :data="items">
        <el-table-column label="类型" width="140">
          <template #default="{ row }">{{ typeText(row) }}</template>
        </el-table-column>
        <el-table-column label="原因" min-width="200" show-overflow-tooltip>
          <template #default="{ row }">{{ row.reason || '—' }}</template>
        </el-table-column>
        <el-table-column label="变动" width="110" align="right">
          <template #default="{ row }">
            <span :style="{ color: deltaOf(row) > 0 ? 'var(--sasu-color-success)' : deltaOf(row) < 0 ? 'var(--sasu-color-danger)' : 'var(--sasu-text-secondary)' }">
              {{ deltaOf(row) > 0 ? '+' : '' }}{{ deltaOf(row) }}
            </span>
          </template>
        </el-table-column>
        <el-table-column label="余额快照" width="110" align="right">
          <template #default="{ row }"><PointsNum :value="balanceOf(row)" /></template>
        </el-table-column>
        <el-table-column label="时间" width="170">
          <template #default="{ row }">{{ fmtTime(row.createdAt) }}</template>
        </el-table-column>
      </el-table>
      <EmptyState v-else-if="!loading" description="还没有积分流水，完成一个任务就会有第一笔收入" />
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
.stat-cards {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
  gap: 12px;
  margin-bottom: 16px;
}
.stat-card {
  border-radius: var(--sasu-radius-base);
  box-shadow: var(--sasu-shadow-card);
}
.stat-label {
  color: var(--sasu-text-secondary);
  font-size: 13px;
}
.stat-value {
  margin-top: 6px;
  font-size: 24px;
}
.stat-value.earned {
  color: var(--sasu-color-success);
}
.stat-sub {
  margin-top: 4px;
  color: var(--sasu-text-secondary);
  font-size: 12px;
}
.stat-card.debt {
  border: 1px solid var(--sasu-color-danger);
}
.debt-text {
  color: var(--sasu-color-danger);
}
.block {
  border-radius: var(--sasu-radius-base);
  box-shadow: var(--sasu-shadow-card);
}
.table-area {
  min-height: 160px;
}
.pager {
  margin-top: 16px;
  display: flex;
  justify-content: center;
}
</style>
