<script setup lang="ts">
import { onMounted, ref, watch } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import type { NormalizedError } from '@/api/http';
import { withdrawalsApi, type WithdrawalRow } from '@/api/withdrawals';
import PageHeader from '@/components/PageHeader.vue';
import StatusTag from '@/components/StatusTag.vue';
import EmptyState from '@/components/EmptyState.vue';
import PointsNum from '@/components/PointsNum.vue';

function errMsg(e: unknown): string {
  return (e as NormalizedError).friendlyMessage ?? '操作失败';
}

function fmtTime(value: string): string {
  return value ? new Date(value).toLocaleString('zh-CN') : '—';
}

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
    ElMessage.error(errMsg(e));
  } finally {
    loading.value = false;
  }
}

watch(activeStatus, () => {
  page.value = 1;
  void load();
});

function onPageChange(): void {
  void load();
}

onMounted(() => void load());

// ---------- 通过 ----------
async function approve(row: WithdrawalRow): Promise<void> {
  try {
    await ElMessageBox.confirm(
      `确认通过 ${row.student?.name ?? row.studentId} 的提现申请吗？通过后进入待发放，等待线下现金发放。`,
      '通过提现申请',
      { confirmButtonText: '确认通过', cancelButtonText: '取消', type: 'warning' },
    );
    await withdrawalsApi.approve(row.id);
    ElMessage.success('已通过，进入待发放');
    void load();
  } catch (e) {
    if (e !== 'cancel' && e !== 'close') ElMessage.error(errMsg(e));
  }
}

// ---------- 驳回 ----------
async function reject(row: WithdrawalRow): Promise<void> {
  try {
    const { value } = await ElMessageBox.prompt(
      '驳回后冻结积分将退回学生可用余额，请填写驳回理由（必填，学生可见）。',
      `驳回提现申请 #${row.id}`,
      {
        confirmButtonText: '确认驳回',
        cancelButtonText: '取消',
        inputPlaceholder: '请填写驳回理由',
        inputValidator: (v: string) => (v && v.trim() ? true : '驳回理由不能为空'),
      },
    );
    await withdrawalsApi.reject(row.id, value.trim());
    ElMessage.success('已驳回，积分已退回');
    void load();
  } catch (e) {
    if (e !== 'cancel' && e !== 'close') ElMessage.error(errMsg(e));
  }
}

// ---------- 标记已发放 ----------
async function markPaid(row: WithdrawalRow): Promise<void> {
  try {
    const { value } = await ElMessageBox.prompt(
      '请确认已线下现金发放，填写发放备注（如：现金签收单编号）。',
      `标记已发放 #${row.id}`,
      {
        confirmButtonText: '确认发放',
        cancelButtonText: '取消',
        inputPlaceholder: '发放备注',
        inputValidator: (v: string) => (v && v.trim() ? true : '发放备注不能为空'),
      },
    );
    await withdrawalsApi.pay(row.id, value.trim(), crypto.randomUUID());
    ElMessage.success('已标记发放');
    void load();
  } catch (e) {
    if (e !== 'cancel' && e !== 'close') ElMessage.error(errMsg(e));
  }
}
</script>

<template>
  <PageHeader title="提现审批" subtitle="学生提现申请的审批、驳回与线下发放登记" />

  <el-card shadow="never" class="block">
    <el-tabs v-model="activeStatus">
      <el-tab-pane v-for="tab in TABS" :key="tab.status" :name="tab.status" :label="tab.label" />
    </el-tabs>

    <el-table v-loading="loading" :data="items" stripe>
      <el-table-column label="学生" width="110">
        <template #default="{ row }">{{ row.student?.name ?? '—' }}</template>
      </el-table-column>
      <el-table-column label="学号" width="130">
        <template #default="{ row }">{{ row.student?.username ?? row.studentId }}</template>
      </el-table-column>
      <el-table-column label="班级" width="130">
        <template #default="{ row }">{{ row.student?.className ?? '—' }}</template>
      </el-table-column>
      <el-table-column label="积分" width="100" align="right">
        <template #default="{ row }"><PointsNum :value="row.points" suffix="分" /></template>
      </el-table-column>
      <el-table-column label="现金" width="110" align="right">
        <template #default="{ row }">¥ {{ row.cashAmount }}</template>
      </el-table-column>
      <el-table-column label="汇率" width="100" align="right">
        <template #default="{ row }">{{ row.rate }}</template>
      </el-table-column>
      <el-table-column prop="periodKey" label="申请月" width="100" align="center" />
      <el-table-column label="申请时间" width="170">
        <template #default="{ row }">{{ fmtTime(row.appliedAt) }}</template>
      </el-table-column>
      <el-table-column label="状态" width="90">
        <template #default="{ row }"><StatusTag :status="row.status" /></template>
      </el-table-column>
      <el-table-column label="操作" width="180" fixed="right">
        <template #default="{ row }">
          <template v-if="row.status === 'PENDING'">
            <el-button link type="primary" size="small" @click="approve(row)">通过</el-button>
            <el-button link type="danger" size="small" @click="reject(row)">驳回</el-button>
          </template>
          <el-button v-else-if="row.status === 'APPROVED'" link type="success" size="small" @click="markPaid(row)">
            标记已发放
          </el-button>
          <template v-else-if="row.status === 'REJECTED'">
            <span class="reject-reason">{{ row.rejectReason ?? '—' }}</span>
          </template>
        </template>
      </el-table-column>
      <template #empty><EmptyState description="该状态下暂无申请" /></template>
    </el-table>

    <div class="pager">
      <el-pagination
        v-model:current-page="page"
        v-model:page-size="pageSize"
        :total="total"
        layout="total, prev, pager, next"
        @current-change="onPageChange"
      />
    </div>
  </el-card>
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
</style>
