<script setup lang="ts">
function newIdemKey(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

import { onMounted, reactive, ref } from 'vue';
import { message, prompt } from '@/composables/feedback';
import type { FormInstance } from 'ant-design-vue';
import type { Rule } from 'ant-design-vue/es/form';
import type { NormalizedError } from '@/api/http';
import { pointsApi, type TxRow } from '@/api/points';
import PageHeader from '@/components/PageHeader.vue';
import EmptyState from '@/components/EmptyState.vue';
import PointsNum from '@/components/PointsNum.vue';
import AppPagination from '@/components/AppPagination.vue';
import type { TableColumnsType } from 'ant-design-vue';

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

const violationColumns: TableColumnsType = [
  { title: '不变式编号', dataIndex: 'invariant', key: 'invariant', width: 120 },
  { title: '异常详情', dataIndex: 'detail', key: 'detail' },
];

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
    message.error(errMsg(e));
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

const topupRules: Record<string, Rule[]> = {
  amount: [{ required: true, message: '请输入金额', trigger: 'blur' }],
  reason: [{ required: true, message: '请填写操作原因', trigger: 'blur' }],
};

async function submitTopup(): Promise<void> {
  await topupFormRef.value?.validate();
  if (topupForm.amount <= 0) {
    message.warning('充值金额必须为正数');
    return;
  }
  topupLoading.value = true;
  try {
    await pointsApi.topup(topupForm.amount, topupForm.reason.trim(), newIdemKey());
    message.success(`充值成功，积分池 +${topupForm.amount} 分`);
    topupFormRef.value?.resetFields();
    void loadPool();
  } catch (e) {
    message.error(errMsg(e));
  } finally {
    topupLoading.value = false;
  }
}

const adjustFormRef = ref<FormInstance>();
const adjustLoading = ref(false);
const adjustForm = reactive({ amount: 0, reason: '' });

const adjustRules: Record<string, Rule[]> = {
  amount: [{ required: true, message: '请输入调整金额（正数充值 / 负数核减）', trigger: 'blur' }],
  reason: [{ required: true, message: '请填写操作原因', trigger: 'blur' }],
};

async function submitAdjust(): Promise<void> {
  await adjustFormRef.value?.validate();
  if (adjustForm.amount === 0) {
    message.warning('调整金额不能为 0');
    return;
  }
  adjustLoading.value = true;
  try {
    await pointsApi.adjust(adjustForm.amount, adjustForm.reason.trim(), newIdemKey());
    message.success(`调整成功，积分池 ${adjustForm.amount > 0 ? '+' : ''}${adjustForm.amount} 分`);
    adjustFormRef.value?.resetFields();
    void loadPool();
  } catch (e) {
    message.error(errMsg(e));
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

const userTxColumns: TableColumnsType = [
  { title: '时间', key: 'createdAt', width: 170 },
  { title: '类型', key: 'type', width: 130 },
  { title: '变动', key: 'delta', width: 110, align: 'right' },
  { title: '变动后余额', key: 'balanceAfter', width: 120, align: 'right' },
  { title: '原因', key: 'reason', ellipsis: true },
];

async function queryUser(page?: number): Promise<void> {
  const id = userQuery.userId.trim();
  if (!/^\d+$/.test(id)) {
    message.warning('请输入数字用户 ID');
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
    message.error(errMsg(e));
  } finally {
    userLoading.value = false;
  }
}

// ---------- 全量流水 ----------
const allTxs = reactive({ page: 1, pageSize: 20, type: undefined as string | undefined });
const allLoading = ref(false);
const allItems = ref<TxRow[]>([]);
const allTotal = ref(0);

const allTxColumns: TableColumnsType = [
  { title: '时间', key: 'createdAt', width: 170 },
  { title: '类型', key: 'type', width: 130 },
  { title: '原因', key: 'reason', ellipsis: true },
  { title: '分录', key: 'legs' },
];

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
    message.error(errMsg(e));
  } finally {
    allLoading.value = false;
  }
}

const allTypeOptions = Object.entries(TX_TYPE_LABELS).map(([value, label]) => ({ value, label }));

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
    message.error(errMsg(e));
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
    message.warning('请先输入数字用户 ID');
    return;
  }
  try {
    const value = await prompt({
      title: `调整用户 ${id} 的积分`,
      message: '请输入调整积分（正数发放 / 负数扣减，不能为 0）',
      placeholder: '整数，可为负数',
      validate: (v: string) => (/^-?\d+$/.test(v.trim()) ? true : '请输入整数（可为负数）'),
    });
    const amount = Number(value.trim());
    const reason = (
      await prompt({
        title: '调整原因',
        message: '请填写调整原因（必填）',
        placeholder: '如：纠错补偿、活动奖励',
        validate: (v: string) => (v && v.trim() ? true : '原因不能为空'),
      })
    ).trim();
    await pointsApi.adjustUser(id, amount, reason, newIdemKey());
    message.success('调整成功');
    if (userQueried.value) void queryUser();
  } catch (e) {
    if (e !== 'cancel' && e !== 'close') message.error(errMsg(e));
  }
}
</script>

<template>
  <PageHeader title="积分池管理" subtitle="积分发行与调账、用户积分查询、全量流水与账务对账" />

  <!-- 统计卡 -->
  <a-spin :spinning="poolLoading">
    <a-row :gutter="16">
      <a-col v-for="card in poolCards" :key="card.key" :span="4">
        <a-card class="block stat-card">
          <div class="stat-label">{{ card.label }}</div>
          <div class="stat-value"><PointsNum :value="pool?.[card.key] ?? 0" suffix="分" /></div>
        </a-card>
      </a-col>
    </a-row>
  </a-spin>

  <!-- 充值 / 调整 -->
  <a-row :gutter="16" class="mt16">
    <a-col :span="12">
      <a-card class="block" title="积分池充值">
        <a-form ref="topupFormRef" :model="topupForm" :rules="topupRules" :label-col="{ style: { width: '90px' } }">
          <a-form-item label="充值金额" name="amount">
            <a-input-number v-model:value="topupForm.amount" :min="1" :max="1000000" :precision="0" style="width: 200px" />
            <span class="unit">分</span>
          </a-form-item>
          <a-form-item label="原因" name="reason">
            <a-textarea v-model:value="topupForm.reason" :rows="2" placeholder="必填，如：学期初预算入账" />
          </a-form-item>
          <a-button type="primary" :loading="topupLoading" @click="submitTopup">确认充值</a-button>
        </a-form>
      </a-card>
    </a-col>
    <a-col :span="12">
      <a-card class="block" title="积分池调整（正数充值 / 负数核减）">
        <a-form ref="adjustFormRef" :model="adjustForm" :rules="adjustRules" :label-col="{ style: { width: '90px' } }">
          <a-form-item label="调整金额" name="amount">
            <a-input-number v-model:value="adjustForm.amount" :precision="0" style="width: 200px" />
            <span class="unit">分（可为负数）</span>
          </a-form-item>
          <a-form-item label="原因" name="reason">
            <a-textarea v-model:value="adjustForm.reason" :rows="2" placeholder="必填，将记录到审计日志" />
          </a-form-item>
          <a-button :loading="adjustLoading" @click="submitAdjust">确认调整</a-button>
        </a-form>
      </a-card>
    </a-col>
  </a-row>

  <!-- 学生积分查询 -->
  <a-card class="block mt16" title="学生积分查询">
    <div class="toolbar">
      <a-input v-model:value="userQuery.userId" placeholder="输入用户 ID（数字）" style="width: 240px" @keyup.enter="queryUser()" />
      <a-button type="primary" :loading="userLoading" @click="queryUser()">查询</a-button>
      <a-button v-if="userQueried" @click="confirmUserAdjust">调整该用户积分</a-button>
    </div>
    <template v-if="userQueried && userProfile">
      <a-descriptions :column="3" bordered class="mt8">
        <a-descriptions-item label="可用余额"><PointsNum :value="userProfile.balance" suffix="分" /></a-descriptions-item>
        <a-descriptions-item label="冻结中"><PointsNum :value="userProfile.frozen" suffix="分" /></a-descriptions-item>
        <a-descriptions-item label="欠分（违约）"><PointsNum :value="userProfile.penaltyDebt" suffix="分" /></a-descriptions-item>
      </a-descriptions>

      <a-table
        :columns="userTxColumns"
        :data-source="userTxs"
        :loading="userLoading"
        size="small"
        :pagination="false"
        class="mt8"
        :scroll="{ y: 360 }"
        row-key="id"
      >
        <template #bodyCell="{ column, record }">
          <template v-if="column.key === 'createdAt'">{{ fmtTime(record.createdAt) }}</template>
          <template v-else-if="column.key === 'type'">{{ TX_TYPE_LABELS[record.type as string] ?? record.type }}</template>
          <template v-else-if="column.key === 'delta'">
            <span class="num" :class="record.legs?.[0]?.delta >= 0 ? 'ok-text' : 'bad-text'">
              {{ record.legs?.[0]?.delta > 0 ? '+' : '' }}{{ record.legs?.[0]?.delta ?? 0 }}
            </span>
          </template>
          <template v-else-if="column.key === 'balanceAfter'">
            <span class="num">{{ record.legs?.[0]?.balanceAfter ?? '—' }}</span>
          </template>
          <template v-else-if="column.key === 'reason'">{{ record.reason ?? '—' }}</template>
        </template>
        <template #emptyText><EmptyState description="该用户暂无流水" /></template>
      </a-table>
      <div class="pager">
        <AppPagination
          v-model:page="userQuery.page"
          :page-size="userQuery.pageSize"
          :total="userTotal"
          @change="(p: number) => queryUser(p)"
        />
      </div>
    </template>
  </a-card>

  <!-- 全量流水 -->
  <a-card class="block mt16">
    <template #title>
      <div class="card-header-row">
        <span>全量流水</span>
        <a-select
          v-model:value="allTxs.type"
          placeholder="全部类型"
          allow-clear
          style="width: 180px"
          :options="allTypeOptions"
          @change="allTxs.page = 1; loadAllTxs()"
        />
      </div>
    </template>
    <a-table
      :columns="allTxColumns"
      :data-source="allItems"
      :loading="allLoading"
      :pagination="false"
      row-key="id"
    >
      <template #bodyCell="{ column, record }">
        <template v-if="column.key === 'createdAt'">{{ fmtTime(record.createdAt) }}</template>
        <template v-else-if="column.key === 'type'">{{ TX_TYPE_LABELS[record.type as string] ?? record.type }}</template>
        <template v-else-if="column.key === 'reason'">{{ record.reason || '—' }}</template>
        <template v-else-if="column.key === 'legs'">
          <div v-for="(leg, i) in record.legs" :key="i" class="leg-line">
            {{ leg.bucket === 'FROZEN' ? '[冻结]' : '' }}{{ leg.delta > 0 ? '+' : '' }}{{ leg.delta }}
            <span class="leg-after">→ {{ leg.balanceAfter }}</span>
          </div>
        </template>
      </template>
      <template #emptyText><EmptyState /></template>
    </a-table>
    <div class="pager">
      <AppPagination v-model:page="allTxs.page" :page-size="allTxs.pageSize" :total="allTotal" @change="loadAllTxs" />
    </div>
  </a-card>

  <!-- 对账 -->
  <a-card class="block mt16">
    <template #title>
      <div class="card-header-row">
        <span>积分账务对账</span>
        <a-button size="small" :loading="reconcileLoading" @click="loadReconcile">重新对账</a-button>
      </div>
    </template>
    <template v-if="reconcile">
      <a-result
        v-if="reconcile.ok"
        status="success"
        title="账务全部一致"
        sub-title="积分池、托管、用户账户与流水全部满足守恒不变式"
      />
      <template v-else>
        <a-alert type="error" message="对账发现异常，以下不变式被破坏" show-icon />
        <a-table :columns="violationColumns" :data-source="reconcile.violations" :pagination="false" class="mt8" row-key="invariant" />
      </template>
    </template>
  </a-card>
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
