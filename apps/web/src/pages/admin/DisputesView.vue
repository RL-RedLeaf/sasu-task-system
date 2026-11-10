<script setup lang="ts">
import { onMounted, reactive, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import { ElMessage, ElMessageBox } from 'element-plus';
import type { FormInstance, FormRules } from 'element-plus';
import type { NormalizedError } from '@/api/http';
import { disputesApi, type DisputeRow } from '@/api/withdrawals';
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

function truncate(text: string, len = 40): string {
  return text.length > len ? `${text.slice(0, len)}…` : text;
}

const router = useRouter();

const TABS = [
  { status: 'OPEN', label: '待处理' },
  { status: 'RESOLVED', label: '已裁定' },
  { status: 'REJECTED', label: '已驳回' },
];

const roleLabels: Record<string, string> = { STUDENT: '学生', TEACHER: '教师', ADMIN: '管理员' };

const activeStatus = ref('OPEN');
const loading = ref(false);
const items = ref<DisputeRow[]>([]);
const total = ref(0);
const page = ref(1);
const pageSize = ref(20);

async function load(): Promise<void> {
  loading.value = true;
  try {
    const data = await disputesApi.adminList({
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

// ---------- 详情抽屉 ----------
const drawerVisible = ref(false);
const detail = ref<DisputeRow | null>(null);

function openDetail(row: DisputeRow): void {
  detail.value = row;
  drawerVisible.value = true;
}

function goTask(taskId: string | null): void {
  if (taskId) void router.push(`/teacher/tasks/${taskId}`);
}

// ---------- 裁定 ----------
const resolveVisible = ref(false);
const resolveFormRef = ref<FormInstance>();
const resolveLoading = ref(false);
const resolveTask = ref<DisputeRow | null>(null);
const resolveForm = reactive({ decision: 'PAY_FULL', payPoints: 0, note: '' });

const resolveRules: FormRules = {
  decision: [{ required: true, message: '请选择裁定结果', trigger: 'change' }],
};

function openResolve(row: DisputeRow): void {
  resolveTask.value = row;
  Object.assign(resolveForm, { decision: 'PAY_FULL', payPoints: 0, note: '' });
  drawerVisible.value = false;
  resolveVisible.value = true;
}

const decisionLabels: Record<string, string> = {
  PAY_FULL: '全额发放',
  PAY_PARTIAL: '部分发放',
  REJECT: '驳回（不发积分）',
};

async function submitResolve(): Promise<void> {
  if (!resolveTask.value) return;
  await resolveFormRef.value?.validate();
  if (resolveForm.decision === 'PAY_PARTIAL') {
    if (!Number.isInteger(resolveForm.payPoints) || resolveForm.payPoints <= 0) {
      ElMessage.warning('部分发放需输入大于 0 的整数积分');
      return;
    }
  }
  try {
    await ElMessageBox.confirm(
      `确认按「${decisionLabels[resolveForm.decision]}」裁定该仲裁吗？裁定会立即执行并通知双方。`,
      '确认裁定',
      { confirmButtonText: '确认裁定', cancelButtonText: '再想想', type: 'warning' },
    );
  } catch {
    return;
  }
  resolveLoading.value = true;
  try {
    await disputesApi.resolve(resolveTask.value.id, {
      decision: resolveForm.decision as 'PAY_FULL' | 'PAY_PARTIAL' | 'REJECT',
      payPoints: resolveForm.decision === 'PAY_PARTIAL' ? resolveForm.payPoints : undefined,
      resolutionNote: resolveForm.note.trim() || undefined,
    });
    ElMessage.success('裁定完成');
    resolveVisible.value = false;
    void load();
  } catch (e) {
    ElMessage.error(errMsg(e));
  } finally {
    resolveLoading.value = false;
  }
}
</script>

<template>
  <PageHeader title="仲裁处理" subtitle="学生/教师发起的仲裁裁定：全额发放、部分发放或驳回" />

  <el-card shadow="never" class="block">
    <el-tabs v-model="activeStatus">
      <el-tab-pane v-for="tab in TABS" :key="tab.status" :name="tab.status" :label="tab.label" />
    </el-tabs>

    <el-table v-loading="loading" :data="items" stripe>
      <el-table-column label="发起人" width="130">
        <template #default="{ row }">{{ row.initiator?.name ?? row.initiatorId }}</template>
      </el-table-column>
      <el-table-column label="角色" width="80">
        <template #default="{ row }">{{ roleLabels[row.initiatorRole] ?? row.initiatorRole }}</template>
      </el-table-column>
      <el-table-column label="被诉方" width="130">
        <template #default="{ row }">{{ row.respondent?.name ?? row.respondentId }}</template>
      </el-table-column>
      <el-table-column label="关联任务" width="110">
        <template #default="{ row }">
          <el-link v-if="row.taskId" type="primary" :underline="false" @click="goTask(row.taskId)">#{{ row.taskId }}</el-link>
          <span v-else>—</span>
        </template>
      </el-table-column>
      <el-table-column label="理由" min-width="200">
        <template #default="{ row }">
          <span class="reason">{{ truncate(row.reason) }}</span>
        </template>
      </el-table-column>
      <el-table-column label="状态" width="90">
        <template #default="{ row }"><StatusTag :status="row.status" /></template>
      </el-table-column>
      <el-table-column label="时间" width="170">
        <template #default="{ row }">{{ fmtTime(row.createdAt) }}</template>
      </el-table-column>
      <el-table-column label="操作" width="140" fixed="right">
        <template #default="{ row }">
          <el-button link type="primary" size="small" @click="openDetail(row)">详情</el-button>
          <el-button v-if="row.status === 'OPEN'" link type="warning" size="small" @click="openResolve(row)">裁定</el-button>
        </template>
      </el-table-column>
      <template #empty><EmptyState description="该状态下暂无仲裁" /></template>
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

  <!-- 详情抽屉 -->
  <el-drawer v-model="drawerVisible" title="仲裁详情" size="440px">
    <template v-if="detail">
      <el-descriptions :column="1" border>
        <el-descriptions-item label="编号">#{{ detail.id }}</el-descriptions-item>
        <el-descriptions-item label="发起人">
          {{ detail.initiator?.name ?? detail.initiatorId }}（{{ roleLabels[detail.initiatorRole] ?? detail.initiatorRole }}）
        </el-descriptions-item>
        <el-descriptions-item label="被诉方">
          {{ detail.respondent?.name ?? detail.respondentId }}（{{ roleLabels[detail.respondent?.role ?? ''] ?? detail.respondent?.role ?? '—' }}）
        </el-descriptions-item>
        <el-descriptions-item label="关联任务">
          <el-link v-if="detail.taskId" type="primary" :underline="false" @click="goTask(detail.taskId)">#{{ detail.taskId }}</el-link>
          <span v-else>—</span>
        </el-descriptions-item>
        <el-descriptions-item label="状态"><StatusTag :status="detail.status" /></el-descriptions-item>
        <el-descriptions-item label="发起时间">{{ fmtTime(detail.createdAt) }}</el-descriptions-item>
        <el-descriptions-item label="仲裁理由">{{ detail.reason }}</el-descriptions-item>
        <el-descriptions-item v-if="detail.decision" label="裁定结果">
          {{ decisionLabels[detail.decision] ?? detail.decision }}
          <template v-if="detail.payPoints !== null">（<PointsNum :value="detail.payPoints" suffix="分" />）</template>
        </el-descriptions-item>
        <el-descriptions-item v-if="detail.resolutionNote" label="处理说明">{{ detail.resolutionNote }}</el-descriptions-item>
      </el-descriptions>
      <div v-if="detail.status === 'OPEN'" class="drawer-actions">
        <el-button type="primary" @click="openResolve(detail)">去裁定</el-button>
      </div>
    </template>
  </el-drawer>

  <!-- 裁定对话框 -->
  <el-dialog v-model="resolveVisible" :title="resolveTask ? `裁定仲裁 #${resolveTask.id}` : '裁定仲裁'" width="480px">
    <el-form ref="resolveFormRef" :model="resolveForm" :rules="resolveRules" label-width="100px">
      <el-form-item label="裁定结果" prop="decision">
        <el-radio-group v-model="resolveForm.decision">
          <el-radio value="PAY_FULL">全额发放</el-radio>
          <el-radio value="PAY_PARTIAL">部分发放</el-radio>
          <el-radio value="REJECT">驳回</el-radio>
        </el-radio-group>
      </el-form-item>
      <el-form-item v-if="resolveForm.decision === 'PAY_PARTIAL'" label="发放积分">
        <el-input-number v-model="resolveForm.payPoints" :min="1" :precision="0" style="width: 200px" />
        <span class="unit">分</span>
      </el-form-item>
      <el-form-item label="处理说明">
        <el-input v-model="resolveForm.note" type="textarea" :rows="3" placeholder="将通知双方（选填）" />
      </el-form-item>
    </el-form>
    <template #footer>
      <el-button @click="resolveVisible = false">取消</el-button>
      <el-button type="primary" :loading="resolveLoading" @click="submitResolve">确认裁定</el-button>
    </template>
  </el-dialog>
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
.reason {
  color: var(--sasu-text-secondary);
}
.drawer-actions {
  margin-top: 16px;
}
.unit {
  margin-left: 8px;
  color: var(--sasu-text-secondary);
  font-size: 12px;
}
</style>
