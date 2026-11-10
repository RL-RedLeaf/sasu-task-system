<script setup lang="ts">
function newIdemKey(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

import { onMounted, reactive, ref } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import type { FormInstance, FormRules } from 'element-plus';
import type { NormalizedError } from '@/api/http';
import { pointsApi, type TxRow } from '@/api/points';
import PageHeader from '@/components/PageHeader.vue';
import EmptyState from '@/components/EmptyState.vue';
import PointsNum from '@/components/PointsNum.vue';

function errMsg(e: unknown): string {
  return (e as NormalizedError).friendlyMessage ?? '操作失败';
}

function fmtTime(value: string): string {
  return value ? new Date(value).toLocaleString('zh-CN') : '—';
}

const TX_TYPE_LABELS: Record<string, string> = {
  POOL_TOPUP: '积分池充值',
  POOL_ADJUST_DOWN: '积分池核减',
  ADMIN_GRANT: '管理员发放',
  ADMIN_DEDUCT: '管理员扣减',
  TASK_FREEZE: '任务托管',
  TASK_PAYOUT: '任务发放',
  TASK_REPRICE_TOPUP: '改价补差',
  TASK_ARBITRATION: '仲裁补偿',
  TASK_BONUS: '绩效发放',
  TASK_REFUND: '托管退回',
  VIOLATION_DEDUCT: '违约扣分',
  DEBT_OFFSET: '欠分抵扣',
  WITHDRAW_FREEZE: '提现冻结',
  WITHDRAW_REFUND: '提现退回',
  WITHDRAW_PAID: '提现兑付',
  ARBITRATION_PAY: '仲裁发放',
};

// ---------- 积分池统计 ----------
interface PoolStats {
  poolBalance: number;
  escrowTotal: number;
  userBalanceTotal: number;
  userFrozenTotal: number;
  issuedTotal: number;
  cashoutTotal: number;
}
const pool = ref<PoolStats | null>(null);
const poolLoading = ref(false);

async function loadPool(): Promise<void> {
  poolLoading.value = true;
  try {
    pool.value = await pointsApi.pool();
  } catch (e) {
    ElMessage.error(errMsg(e));
  } finally {
    poolLoading.value = false;
  }
}

const poolCards = [
  { key: 'poolBalance', label: '积分池余额' },
  { key: 'escrowTotal', label: '任务托管中' },
  { key: 'userBalanceTotal', label: '用户可用余额' },
  { key: 'userFrozenTotal', label: '用户冻结中' },
  { key: 'issuedTotal', label: '累计发行' },
  { key: 'cashoutTotal', label: '已兑付（提现）' },
] as const;

// ---------- 充值 / 调整 ----------
const topupFormRef = ref<FormInstance>();
const topupLoading = ref(false);
const topupForm = reactive({ amount: 1000, reason: '' });

const topupRules: FormRules = {
  amount: [{ required: true, message: '请输入金额', trigger: 'blur' }],
  reason: [{ required: true, message: '请填写操作原因', trigger: 'blur' }],
};

async function submitTopup(): Promise<void> {
  await topupFormRef.value?.validate();
  if (topupForm.amount <= 0) {
    ElMessage.warning('充值金额必须为正数');
    return;
  }
  topupLoading.value = true;
  try {
    await pointsApi.topup(topupForm.amount, topupForm.reason.trim(), newIdemKey());
    ElMessage.success(`充值成功，积分池 +${topupForm.amount} 分`);
    topupFormRef.value?.resetFields();
    void loadPool();
  } catch (e) {
    ElMessage.error(errMsg(e));
  } finally {
    topupLoading.value = false;
  }
}

const adjustFormRef = ref<FormInstance>();
const adjustLoading = ref(false);
const adjustForm = reactive({ amount: 0, reason: '' });

const adjustRules: FormRules = {
  amount: [{ required: true, message: '请输入调整金额（正数充值 / 负数核减）', trigger: 'blur' }],
  reason: [{ required: true, message: '请填写操作原因', trigger: 'blur' }],
};

async function submitAdjust(): Promise<void> {
  await adjustFormRef.value?.validate();
  if (adjustForm.amount === 0) {
    ElMessage.warning('调整金额不能为 0');
    return;
  }
  adjustLoading.value = true;
  try {
    await pointsApi.adjust(adjustForm.amount, adjustForm.reason.trim(), newIdemKey());
    ElMessage.success(`调整成功，积分池 ${adjustForm.amount > 0 ? '+' : ''}${adjustForm.amount} 分`);
    adjustFormRef.value?.resetFields();
    void loadPool();
  } catch (e) {
    ElMessage.error(errMsg(e));
  } finally {
    adjustLoading.value = false;
  }
}

// ---------- 学生积分查询 ----------
const userQuery = reactive({ userId: '', page: 1, pageSize: 20 });
const userLoading = ref(false);
const userProfile = ref<{ balance: number; frozen: number; penaltyDebt: number } | null>(null);
const userTxs = ref<TxRow[]>([]);
const userTotal = ref(0);
const userQueried = ref(false);

async function queryUser(page?: number): Promise<void> {
  const id = userQuery.userId.trim();
  if (!/^\d+$/.test(id)) {
    ElMessage.warning('请输入数字用户 ID');
    return;
  }
  if (page) userQuery.page = page;
  userLoading.value = true;
  try {
    const data = await pointsApi.userPoints(id, { page: userQuery.page, pageSize: userQuery.pageSize });
    userProfile.value = { balance: data.balance, frozen: data.frozen, penaltyDebt: data.penaltyDebt };
    userTxs.value = data.items;
    userTotal.value = data.total;
    userQueried.value = true;
  } catch (e) {
    ElMessage.error(errMsg(e));
  } finally {
    userLoading.value = false;
  }
}

// ---------- 全量流水 ----------
const allTxs = reactive({ page: 1, pageSize: 20, type: '' });
const allLoading = ref(false);
const allItems = ref<TxRow[]>([]);
const allTotal = ref(0);

async function loadAllTxs(): Promise<void> {
  allLoading.value = true;
  try {
    const data = await pointsApi.allTransactions({
      page: allTxs.page,
      pageSize: allTxs.pageSize,
      type: allTxs.type || undefined,
    });
    allItems.value = data.items;
    allTotal.value = data.total;
  } catch (e) {
    ElMessage.error(errMsg(e));
  } finally {
    allLoading.value = false;
  }
}

const allTypeOptions = Object.entries(TX_TYPE_LABELS).map(([value, label]) => ({ value, label }));

function onPageChange(): void {
  void loadAllTxs();
}

// ---------- 对账 ----------
interface ReconcileResult {
  ok: boolean;
  violations: { invariant: number; detail: string }[];
}
const reconcile = ref<ReconcileResult | null>(null);
const reconcileLoading = ref(false);

async function loadReconcile(): Promise<void> {
  reconcileLoading.value = true;
  try {
    reconcile.value = await pointsApi.reconcile();
  } catch (e) {
    ElMessage.error(errMsg(e));
  } finally {
    reconcileLoading.value = false;
  }
}

onMounted(() => {
  void loadPool();
  void loadAllTxs();
  void loadReconcile();
});

async function confirmUserAdjust(): Promise<void> {
  const id = userQuery.userId.trim();
  if (!/^\d+$/.test(id)) {
    ElMessage.warning('请先输入数字用户 ID');
    return;
  }
  try {
    const { value } = await ElMessageBox.prompt(
      '请输入调整积分（正数发放 / 负数扣减，不能为 0）',
      `调整用户 ${id} 的积分`,
      {
        confirmButtonText: '下一步',
        cancelButtonText: '取消',
        inputPattern: /^-?\d+$/,
        inputErrorMessage: '请输入整数（可为负数）',
      },
    );
    const amount = Number(value);
    const { value: reason } = await ElMessageBox.prompt('请填写调整原因（必填）', '调整原因', {
      confirmButtonText: '确认调整',
      cancelButtonText: '取消',
      inputPlaceholder: '如：纠错补偿、活动奖励',
      inputValidator: (v: string) => (v && v.trim() ? true : '原因不能为空'),
    });
    await pointsApi.adjustUser(id, amount, reason.trim(), newIdemKey());
    ElMessage.success('调整成功');
    if (userQueried.value) void queryUser();
  } catch (e) {
    if (e !== 'cancel' && e !== 'close') ElMessage.error(errMsg(e));
  }
}
</script>

<template>
  <PageHeader title="积分池管理" subtitle="积分发行与调账、用户积分查询、全量流水与账务对账" />

  <!-- 统计卡 -->
  <el-row v-loading="poolLoading" :gutter="16">
    <el-col v-for="card in poolCards" :key="card.key" :span="4">
      <el-card shadow="never" class="block stat-card">
        <div class="stat-label">{{ card.label }}</div>
        <div class="stat-value"><PointsNum :value="pool?.[card.key] ?? 0" suffix="分" /></div>
      </el-card>
    </el-col>
  </el-row>

  <!-- 充值 / 调整 -->
  <el-row :gutter="16" class="mt16">
    <el-col :span="12">
      <el-card shadow="never" class="block">
        <template #header>积分池充值</template>
        <el-form ref="topupFormRef" :model="topupForm" :rules="topupRules" label-width="90px">
          <el-form-item label="充值金额" prop="amount">
            <el-input-number v-model="topupForm.amount" :min="1" :max="1000000" :precision="0" style="width: 200px" />
            <span class="unit">分</span>
          </el-form-item>
          <el-form-item label="原因" prop="reason">
            <el-input v-model="topupForm.reason" type="textarea" :rows="2" placeholder="必填，如：学期初预算入账" />
          </el-form-item>
          <el-button type="primary" :loading="topupLoading" @click="submitTopup">确认充值</el-button>
        </el-form>
      </el-card>
    </el-col>
    <el-col :span="12">
      <el-card shadow="never" class="block">
        <template #header>积分池调整（正数充值 / 负数核减）</template>
        <el-form ref="adjustFormRef" :model="adjustForm" :rules="adjustRules" label-width="90px">
          <el-form-item label="调整金额" prop="amount">
            <el-input-number v-model="adjustForm.amount" :precision="0" style="width: 200px" />
            <span class="unit">分（可为负数）</span>
          </el-form-item>
          <el-form-item label="原因" prop="reason">
            <el-input v-model="adjustForm.reason" type="textarea" :rows="2" placeholder="必填，将记录到审计日志" />
          </el-form-item>
          <el-button type="warning" :loading="adjustLoading" @click="submitAdjust">确认调整</el-button>
        </el-form>
      </el-card>
    </el-col>
  </el-row>

  <!-- 学生积分查询 -->
  <el-card shadow="never" class="block mt16">
    <template #header>学生积分查询</template>
    <div class="toolbar">
      <el-input v-model="userQuery.userId" placeholder="输入用户 ID（数字）" style="width: 240px" @keyup.enter="queryUser()" />
      <el-button type="primary" :loading="userLoading" @click="queryUser()">查询</el-button>
      <el-button v-if="userQueried" @click="confirmUserAdjust">调整该用户积分</el-button>
    </div>
    <template v-if="userQueried && userProfile">
      <el-descriptions :column="3" border class="mt8">
        <el-descriptions-item label="可用余额"><PointsNum :value="userProfile.balance" suffix="分" /></el-descriptions-item>
        <el-descriptions-item label="冻结中"><PointsNum :value="userProfile.frozen" suffix="分" /></el-descriptions-item>
        <el-descriptions-item label="欠分（违约）"><PointsNum :value="userProfile.penaltyDebt" suffix="分" /></el-descriptions-item>
      </el-descriptions>

      <el-table v-loading="userLoading" :data="userTxs" size="small" stripe class="mt8" max-height="360">
        <el-table-column label="时间" width="170">
          <template #default="{ row }">{{ fmtTime(row.createdAt) }}</template>
        </el-table-column>
        <el-table-column label="类型" width="130">
          <template #default="{ row }">{{ TX_TYPE_LABELS[row.type as string] ?? row.type }}</template>
        </el-table-column>
        <el-table-column label="变动" width="110" align="right">
          <template #default="{ row }">
            <span :class="row.legs?.[0]?.delta >= 0 ? 'ok-text' : 'bad-text'">
              {{ row.legs?.[0]?.delta > 0 ? '+' : '' }}{{ row.legs?.[0]?.delta ?? 0 }}
            </span>
          </template>
        </el-table-column>
        <el-table-column label="变动后余额" width="120" align="right">
          <template #default="{ row }">{{ row.legs?.[0]?.balanceAfter ?? '—' }}</template>
        </el-table-column>
        <el-table-column prop="reason" label="原因" min-width="180">
          <template #default="{ row }">{{ row.reason ?? '—' }}</template>
        </el-table-column>
        <template #empty><EmptyState description="该用户暂无流水" /></template>
      </el-table>
      <div class="pager">
        <el-pagination
          v-model:current-page="userQuery.page"
          :page-size="userQuery.pageSize"
          :total="userTotal"
          layout="total, prev, pager, next"
          @current-change="(p: number) => queryUser(p)"
        />
      </div>
    </template>
  </el-card>

  <!-- 全量流水 -->
  <el-card shadow="never" class="block mt16">
    <template #header>
      <div class="card-header-row">
        <span>全量流水</span>
        <el-select v-model="allTxs.type" placeholder="全部类型" clearable style="width: 180px" @change="allTxs.page = 1; loadAllTxs()">
          <el-option v-for="opt in allTypeOptions" :key="opt.value" :label="opt.label" :value="opt.value" />
        </el-select>
      </div>
    </template>
    <el-table v-loading="allLoading" :data="allItems" stripe>
      <el-table-column label="时间" width="170">
        <template #default="{ row }">{{ fmtTime(row.createdAt) }}</template>
      </el-table-column>
      <el-table-column label="类型" width="130">
        <template #default="{ row }">{{ TX_TYPE_LABELS[row.type as string] ?? row.type }}</template>
      </el-table-column>
      <el-table-column prop="bizKey" label="业务键" min-width="200" show-overflow-tooltip />
      <el-table-column prop="reason" label="原因" min-width="160" show-overflow-tooltip>
        <template #default="{ row }">{{ row.reason ?? '—' }}</template>
      </el-table-column>
      <el-table-column label="分录" min-width="220">
        <template #default="{ row }">
          <div v-for="(leg, i) in row.legs" :key="i" class="leg-line">
            {{ leg.bucket === 'FROZEN' ? '[冻结]' : '' }}{{ leg.delta > 0 ? '+' : '' }}{{ leg.delta }}
            <span class="leg-after">→ {{ leg.balanceAfter }}</span>
          </div>
        </template>
      </el-table-column>
      <template #empty><EmptyState /></template>
    </el-table>
    <div class="pager">
      <el-pagination
        v-model:current-page="allTxs.page"
        v-model:page-size="allTxs.pageSize"
        :total="allTotal"
        layout="total, prev, pager, next"
        @current-change="onPageChange"
      />
    </div>
  </el-card>

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
</template>

<style scoped>
.mt16 {
  margin-top: 16px;
}
.mt8 {
  margin-top: 8px;
}
.block {
  border-radius: var(--sasu-radius-base);
  box-shadow: var(--sasu-shadow-card);
}
.stat-card {
  text-align: left;
}
.stat-label {
  color: var(--sasu-text-secondary);
  font-size: 12px;
}
.stat-value {
  font-size: 20px;
  margin-top: 6px;
}
.toolbar {
  display: flex;
  gap: 8px;
  align-items: center;
}
.card-header-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
}
.pager {
  margin-top: 12px;
  display: flex;
  justify-content: flex-end;
}
.unit {
  margin-left: 8px;
  color: var(--sasu-text-secondary);
  font-size: 12px;
}
.ok-text {
  color: var(--sasu-color-success);
  font-weight: 600;
}
.bad-text {
  color: var(--sasu-color-danger);
  font-weight: 600;
}
.leg-line {
  font-variant-numeric: tabular-nums;
  line-height: 1.6;
}
.leg-after {
  color: var(--sasu-text-secondary);
  font-size: 12px;
  margin-left: 4px;
}
</style>
