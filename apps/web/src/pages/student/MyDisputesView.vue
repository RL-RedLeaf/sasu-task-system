<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue';
import { ElMessage, type FormInstance, type FormRules } from 'element-plus';
import { disputesApi, type DisputeRow } from '@/api/withdrawals';
import type { NormalizedError } from '@/api/http';
import EmptyState from '@/components/EmptyState.vue';
import PageHeader from '@/components/PageHeader.vue';
import PointsNum from '@/components/PointsNum.vue';
import StatusTag from '@/components/StatusTag.vue';

const PAGE_SIZE = 20;

const items = ref<DisputeRow[]>([]);
const total = ref(0);
const page = ref(1);
const loading = ref(false);

const dialogVisible = ref(false);
const submitting = ref(false);
const formRef = ref<FormInstance>();
const form = reactive({ taskId: '', reason: '' });

const decisionLabel: Record<string, string> = {
  PAY_FULL: '全额发放',
  PAY_PARTIAL: '部分发放',
  REJECT: '驳回申请',
};

function fmtTime(v: string | null | undefined): string {
  return v ? new Date(v).toLocaleString('zh-CN') : '—';
}

const rules: FormRules = {
  taskId: [
    {
      required: true,
      validator: (_r, value: number | string, cb) => {
        const n = Number(value);
        if (!value || !Number.isInteger(n) || n <= 0) cb(new Error('请输入要关联的任务 ID（正整数）'));
        else cb();
      },
      trigger: 'blur',
    },
  ],
  reason: [
    { required: true, message: '请填写仲裁理由', trigger: 'blur' },
    {
      validator: (_r, value: string, cb) => {
        const n = (value ?? '').trim().length;
        if (n > 0 && n < 10) cb(new Error('理由至少 10 字，请写清楚争议经过'));
        else cb();
      },
      trigger: 'blur',
    },
  ],
};

async function load(): Promise<void> {
  loading.value = true;
  try {
    const data = await disputesApi.mine({ page: page.value, pageSize: PAGE_SIZE });
    items.value = data.items;
    total.value = data.total;
  } catch (e) {
    ElMessage.error((e as NormalizedError).friendlyMessage ?? '加载失败');
  } finally {
    loading.value = false;
  }
}

function openDialog(): void {
  form.taskId = '';
  form.reason = '';
  dialogVisible.value = true;
}

async function onCreate(): Promise<void> {
  await formRef.value?.validate();
  submitting.value = true;
  try {
    await disputesApi.create({ taskId: Number(form.taskId), reason: form.reason.trim() });
    ElMessage.success('仲裁申请已提交，管理员将尽快裁定');
    dialogVisible.value = false;
    page.value = 1;
    await load();
  } catch (e) {
    ElMessage.error((e as NormalizedError).friendlyMessage ?? '提交失败');
  } finally {
    submitting.value = false;
  }
}

function changePage(p: number): void {
  page.value = p;
  void load();
}

onMounted(() => {
  void load();
});
</script>

<template>
  <PageHeader title="我的仲裁" subtitle="对验收结果不公或教师失联等情况可发起仲裁，由管理员裁定" />
  <el-card shadow="never" class="block">
    <template #header>
      <div class="card-header-row">
        <span>仲裁记录</span>
        <el-button type="primary" size="small" @click="openDialog">发起仲裁</el-button>
      </div>
    </template>
    <div v-loading="loading" class="table-area">
      <el-table v-if="items.length > 0" :data="items">
        <el-table-column label="关联任务" width="120">
          <template #default="{ row }">
            <el-link
              v-if="row.taskId"
              type="primary"
              :underline="false"
              @click="$router.push(`/tasks/${row.taskId}`)"
            >
              任务 #{{ row.taskId }}
            </el-link>
            <span v-else>—</span>
          </template>
        </el-table-column>
        <el-table-column label="理由" min-width="220" show-overflow-tooltip>
          <template #default="{ row }">{{ row.reason }}</template>
        </el-table-column>
        <el-table-column label="状态" width="100">
          <template #default="{ row }"><StatusTag :status="row.status" /></template>
        </el-table-column>
        <el-table-column label="裁定结果" width="140">
          <template #default="{ row }">
            <span v-if="row.decision">{{ decisionLabel[row.decision] ?? row.decision }}</span>
            <span v-else class="muted">待裁定</span>
            <template v-if="row.payPoints !== null && row.payPoints !== undefined">
              <span class="muted">（</span><PointsNum :value="row.payPoints" suffix="分" /><span class="muted">）</span>
            </template>
          </template>
        </el-table-column>
        <el-table-column label="裁定说明" min-width="160" show-overflow-tooltip>
          <template #default="{ row }">{{ row.resolutionNote || '—' }}</template>
        </el-table-column>
        <el-table-column label="发起时间" width="170">
          <template #default="{ row }">{{ fmtTime(row.createdAt) }}</template>
        </el-table-column>
      </el-table>
      <EmptyState v-else-if="!loading" description="没有仲裁记录" />
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

  <el-dialog v-model="dialogVisible" title="发起仲裁" width="520px">
    <el-form ref="formRef" :model="form" :rules="rules" label-position="top" @submit.prevent="onCreate">
      <el-form-item label="关联任务 ID" prop="taskId">
        <el-input v-model="form.taskId" class="task-id-input" placeholder="任务列表中的数字 ID，如 12" />
        <div class="field-tip">可在「我的任务」或任务详情页地址中查看任务 ID</div>
      </el-form-item>
      <el-form-item label="仲裁理由（至少 10 字）" prop="reason">
        <el-input
          v-model="form.reason"
          type="textarea"
          :rows="5"
          maxlength="500"
          show-word-limit
          placeholder="说明争议经过：验收结果、沟通情况等，管理员将据此裁定"
        />
      </el-form-item>
    </el-form>
    <template #footer>
      <el-button @click="dialogVisible = false">取消</el-button>
      <el-button type="primary" :loading="submitting" @click="onCreate">提交仲裁</el-button>
    </template>
  </el-dialog>
</template>

<style scoped>
.block {
  border-radius: var(--sasu-radius-base);
  box-shadow: var(--sasu-shadow-card);
}
.card-header-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.table-area {
  min-height: 160px;
}
.muted {
  color: var(--sasu-text-secondary);
}
.task-id-input {
  width: 220px;
}
.field-tip {
  color: var(--sasu-text-secondary);
  font-size: 12px;
  margin-top: 4px;
}
.pager {
  margin-top: 16px;
  display: flex;
  justify-content: center;
}
</style>
