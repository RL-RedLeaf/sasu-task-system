<script setup lang="ts">
import { onMounted, ref, watch } from 'vue';
import { confirm, message, prompt } from '@/composables/feedback';
import type { NormalizedError } from '@/api/http';
import { withdrawalsApi, type WithdrawalRow } from '@/api/withdrawals';
import PageHeader from '@/components/PageHeader.vue';
import StatusTag from '@/components/StatusTag.vue';
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

const columns: TableColumnsType = [
  { title: '学生', key: 'student', width: 100 },
  { title: '学号', key: 'username', width: 120 },
  { title: '班级', key: 'className', width: 120 },
  { title: '积分', key: 'points', width: 90, align: 'right' },
  { title: '现金', key: 'cash', width: 100, align: 'right' },
  { title: '汇率', dataIndex: 'rate', key: 'rate', width: 90, align: 'right' },
  { title: '申请月', dataIndex: 'periodKey', key: 'periodKey', width: 90, align: 'center' },
  { title: '申请时间', key: 'appliedAt', width: 160 },
  { title: '状态', key: 'status', width: 80 },
  { title: '操作', key: 'action', width: 170, fixed: 'right' },
];

const TABS = [
  { status: 'PENDING', label: '待审批' },
  { status: 'APPROVED', label: '待发放' },
  { status: 'PAID', label: '已发放' },
  { status: 'REJECTED', label: '已驳回' },
];

const activeStatus = ref('PENDING');
const loading = ref(false);
const items = ref<WithdrawalRow[]>([]);
const total = ref(0);
const page = ref(1);
const pageSize = ref(20);

async function load(): Promise<void> {
  loading.value = true;
  try {
    const data = await withdrawalsApi.adminList({
      status: activeStatus.value,
      page: page.value,
      pageSize: pageSize.value,
    });
    items.value = data.items;
    total.value = data.total;
  } catch (e) {
    message.error(errMsg(e));
  } finally {
    loading.value = false;
  }
}

watch(activeStatus, () => {
  page.value = 1;
  void load();
});

onMounted(() => void load());

// ---------- 通过 ----------
async function approve(row: WithdrawalRow): Promise<void> {
  try {
    await confirm({
      title: '通过提现申请',
      content: `确认通过 ${row.student?.name ?? row.studentId} 的提现申请吗？通过后进入待发放，等待线下现金发放。`,
      icon: 'warning',
      okText: '确认通过',
    });
    await withdrawalsApi.approve(row.id);
    message.success('已通过，进入待发放');
    void load();
  } catch (e) {
    if (e !== 'cancel' && e !== 'close') message.error(errMsg(e));
  }
}

// ---------- 驳回 ----------
async function reject(row: WithdrawalRow): Promise<void> {
  let reason: string;
  try {
    reason = (
      await prompt({
        title: `驳回提现申请 #${row.id}`,
        message: '驳回后冻结积分将退回学生可用余额，请填写驳回理由（必填，学生可见）。',
        placeholder: '请填写驳回理由',
        validate: (v: string) => (v && v.trim() ? true : '驳回理由不能为空'),
      })
    ).trim();
    await withdrawalsApi.reject(row.id, reason);
    message.success('已驳回，积分已退回');
    void load();
  } catch (e) {
    if (e !== 'cancel' && e !== 'close') message.error(errMsg(e));
  }
}

// ---------- 标记已发放 ----------
async function markPaid(row: WithdrawalRow): Promise<void> {
  let note: string;
  try {
    note = (
      await prompt({
        title: `标记已发放 #${row.id}`,
        message: '请确认已线下现金发放，填写发放备注（如：现金签收单编号）。',
        placeholder: '发放备注',
        validate: (v: string) => (v && v.trim() ? true : '发放备注不能为空'),
      })
    ).trim();
    await withdrawalsApi.pay(row.id, note, crypto.randomUUID());
    message.success('已标记发放');
    void load();
  } catch (e) {
    if (e !== 'cancel' && e !== 'close') message.error(errMsg(e));
  }
}
</script>

<template>
  <PageHeader title="提现审批" subtitle="学生提现申请的审批、驳回与线下发放登记" />

  <a-card class="block">
    <a-tabs v-model:active-key="activeStatus">
      <a-tab-pane v-for="tab in TABS" :key="tab.status" :tab="tab.label" />
    </a-tabs>

    <a-table
      :columns="columns"
      :data-source="items"
      :loading="loading"
      :pagination="false"
      row-key="id"
      :scroll="{ x: 1020 }"
    >
      <template #bodyCell="{ column, record }">
        <template v-if="column.key === 'student'">{{ record.student?.name ?? '—' }}</template>
        <template v-else-if="column.key === 'username'">{{ record.student?.username ?? record.studentId }}</template>
        <template v-else-if="column.key === 'className'">{{ record.student?.className ?? '—' }}</template>
        <template v-else-if="column.key === 'points'"><PointsNum class="num" :value="record.points" suffix="分" /></template>
        <template v-else-if="column.key === 'cash'">¥ {{ record.cashAmount }}</template>
        <template v-else-if="column.key === 'appliedAt'">{{ fmtTime(record.appliedAt) }}</template>
        <template v-else-if="column.key === 'status'"><StatusTag :status="record.status" /></template>
        <template v-else-if="column.key === 'action'">
          <template v-if="record.status === 'PENDING'">
            <a-button type="link" size="small" class="op-link" @click="approve(record as WithdrawalRow)">通过</a-button>
            <a-button type="link" size="small" class="op-link op-danger" @click="reject(record as WithdrawalRow)">驳回</a-button>
          </template>
          <a-button v-else-if="record.status === 'APPROVED'" type="link" size="small" class="op-link op-success" @click="markPaid(record as WithdrawalRow)">
            标记已发放
          </a-button>
          <template v-else-if="record.status === 'REJECTED'">
            <span class="reject-reason">{{ record.rejectReason ?? '—' }}</span>
          </template>
        </template>
      </template>
      <template #emptyText><EmptyState description="该状态下暂无申请" /></template>
    </a-table>

    <div class="pager">
      <AppPagination v-model:page="page" :page-size="pageSize" :total="total" @change="load" />
    </div>
  </a-card>
</template>

<style scoped>
.block {
  border-radius: var(--sasu-radius-base);
  box-shadow: var(--sasu-shadow-card);
}
.pager {
  margin-top: 12px;
  display: flex;
  justify-content: flex-end;
}
.reject-reason {
  color: var(--sasu-text-secondary);
  font-size: 12px;
}
.op-link {
  padding: 0;
}
.op-danger {
  color: var(--sasu-color-danger);
}
.op-success {
  color: var(--sasu-color-success);
}
</style>
