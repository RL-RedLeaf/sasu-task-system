<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { confirm, message } from '@/composables/feedback';
import { withdrawalsApi, type WithdrawalRow } from '@/api/withdrawals';
import { pointsApi, type MyPoints } from '@/api/points';
import type { NormalizedError } from '@/api/http';
import EmptyState from '@/components/EmptyState.vue';
import PageHeader from '@/components/PageHeader.vue';
import PointsNum from '@/components/PointsNum.vue';
import StatusTag from '@/components/StatusTag.vue';
import AppPagination from '@/components/AppPagination.vue';
import type { TableColumnsType } from 'ant-design-vue';

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

const columns: TableColumnsType = [
  { title: '积分', key: 'points', width: 110, align: 'right' },
  { title: '预计现金', key: 'cash', width: 120, align: 'right' },
  { title: '状态', key: 'status', width: 100 },
  { title: '申请时间', key: 'appliedAt', width: 170 },
  { title: '驳回原因', key: 'rejectReason', ellipsis: true },
  { title: '操作', key: 'action', width: 100 },
];

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
    message.error((e as NormalizedError).friendlyMessage ?? '加载失败');
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
    message.warning(`提现最低 ${MIN_POINTS} 积分`);
    return;
  }
  if (me.value && points > me.value.balance) {
    message.warning('超出可用积分余额');
    return;
  }
  try {
    await confirm({
      title: '提交提现申请',
      content: `申请提现 ${points} 积分${estimatedCash.value ? `（预计 ${estimatedCash.value} 元）` : ''}，提交后积分将被冻结，本月额度将被占用。确认提交？`,
      icon: 'warning',
      okText: '确认提交',
    });
  } catch {
    return;
  }
  submitting.value = true;
  try {
    await withdrawalsApi.create(points, crypto.randomUUID());
    message.success('提现申请已提交，等待管理员审批');
    amount.value = MIN_POINTS;
    await Promise.all([load(), loadPoints()]);
  } catch (e) {
    message.error((e as NormalizedError).friendlyMessage ?? '提交失败');
  } finally {
    submitting.value = false;
  }
}

async function onWithdrawRecord(row: WithdrawalRow): Promise<void> {
  try {
    await confirm({
      title: '撤回提现申请',
      content: '撤回等同驳回：冻结积分将退回可用余额，本月额度释放。确认撤回该申请？',
      icon: 'warning',
      okText: '确认撤回',
    });
  } catch {
    return;
  }
  try {
    await withdrawalsApi.selfWithdraw(row.id);
    message.success('已撤回，冻结积分已退回可用余额');
    await Promise.all([load(), loadPoints()]);
  } catch (e) {
    message.error((e as NormalizedError).friendlyMessage ?? '撤回失败');
  }
}

onMounted(() => {
  void load();
  void loadPoints();
});
</script>

<template>
  <PageHeader title="申请提现" subtitle="积分兑换现金，每人每自然月可申请 1 次" />

  <template v-if="withdrawEnabled">
    <a-card class="block">
      <template #title>
        <div class="card-header-row">
          <span>提现申请</span>
          <span class="balance">可用积分：<PointsNum :value="me?.balance ?? 0" suffix="分" /></span>
        </div>
      </template>
      <a-alert
        class="hint"
        type="info"
        show-icon
        message="最低提现 50 积分；每人每自然月 1 次（待审批/待发放/已发放均占用当月额度）"
      />
      <a-form layout="vertical" @submit.prevent="onSubmit">
        <a-form-item label="提现积分">
          <a-input-number
            v-model:value="amount"
            :min="MIN_POINTS"
            :step="10"
            :precision="0"
            class="amount-input"
          />
          <span class="tip">整数积分，当前积分将全部冻结至审批完成</span>
        </a-form-item>
        <a-form-item v-if="estimatedCash" label="预计现金">
          <span class="cash"><PointsNum :value="estimatedCash" suffix="元" /></span>
          <span class="tip">按最新汇率 {{ latestRate }} 计，实际以管理员发放为准</span>
        </a-form-item>
        <a-button type="primary" :loading="submitting" @click="onSubmit">提交提现申请</a-button>
      </a-form>
    </a-card>

    <a-card class="block" title="我的提现记录">
      <a-spin :spinning="loading">
        <div class="table-area">
          <a-table v-if="items.length > 0" :columns="columns" :data-source="items" :pagination="false" row-key="id">
            <template #bodyCell="{ column, record }">
              <template v-if="column.key === 'points'">
                <PointsNum class="num" :value="record.points" suffix="分" />
              </template>
              <template v-else-if="column.key === 'cash'">{{ cashText(record.cashAmount) }}</template>
              <template v-else-if="column.key === 'status'"><StatusTag :status="record.status" /></template>
              <template v-else-if="column.key === 'appliedAt'">{{ fmtTime(record.appliedAt) }}</template>
              <template v-else-if="column.key === 'rejectReason'">{{ record.rejectReason || '—' }}</template>
              <template v-else-if="column.key === 'action'">
                <a-button
                  v-if="record.status === 'PENDING'"
                  size="small"
                  @click="onWithdrawRecord(record as WithdrawalRow)"
                >
                  撤回
                </a-button>
                <span v-else class="muted">—</span>
              </template>
            </template>
          </a-table>
          <EmptyState v-else-if="!loading" description="还没有提现记录" />
        </div>
      </a-spin>
      <div class="pager">
        <AppPagination v-model:page="page" :page-size="PAGE_SIZE" :total="total" hide-on-single-page @change="load" />
      </div>
    </a-card>
  </template>

  <a-card v-else-if="checked" class="block">
    <EmptyState description="提现功能未开放，如有疑问请联系管理员" />
  </a-card>
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
