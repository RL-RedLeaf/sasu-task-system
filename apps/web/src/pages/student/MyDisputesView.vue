<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue';
import { message } from '@/composables/feedback';
import type { FormInstance } from 'ant-design-vue';
import type { Rule } from 'ant-design-vue/es/form';
import { disputesApi, type DisputeRow } from '@/api/withdrawals';
import type { NormalizedError } from '@/api/http';
import EmptyState from '@/components/EmptyState.vue';
import PageHeader from '@/components/PageHeader.vue';
import PointsNum from '@/components/PointsNum.vue';
import StatusTag from '@/components/StatusTag.vue';
import AppPagination from '@/components/AppPagination.vue';
import type { TableColumnsType } from 'ant-design-vue';

const PAGE_SIZE = 20;

const items = ref<DisputeRow[]>([]);
const total = ref(0);
const page = ref(1);
const loading = ref(false);

const dialogOpen = ref(false);
const submitting = ref(false);
const formRef = ref<FormInstance>();
const form = reactive({ taskId: '', reason: '' });

const decisionLabel: Record<string, string> = {
  PAY_FULL: '全额发放',
  PAY_PARTIAL: '部分发放',
  REJECT: '驳回申请',
};

const columns: TableColumnsType = [
  { title: '关联任务', key: 'taskId', width: 120 },
  { title: '理由', key: 'reason', ellipsis: true },
  { title: '状态', key: 'status', width: 100 },
  { title: '裁定结果', key: 'decision', width: 140 },
  { title: '裁定说明', key: 'resolutionNote', ellipsis: true },
  { title: '发起时间', key: 'createdAt', width: 170 },
];

function fmtTime(v: string | null | undefined): string {
  return v ? new Date(v).toLocaleString('zh-CN') : '—';
}

const rules: Record<string, Rule[]> = {
  taskId: [
    {
      required: true,
      validator: (_r, value: number | string, cb) => {
        const n = Number(value);
        if (!value || !Number.isInteger(n) || n <= 0) cb('请输入要关联的任务 ID（正整数）');
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
        if (n > 0 && n < 10) cb('理由至少 10 字，请写清楚争议经过');
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
    message.error((e as NormalizedError).friendlyMessage ?? '加载失败');
  } finally {
    loading.value = false;
  }
}

function openDialog(): void {
  form.taskId = '';
  form.reason = '';
  dialogOpen.value = true;
}

async function onCreate(): Promise<void> {
  await formRef.value?.validate();
  submitting.value = true;
  try {
    await disputesApi.create({ taskId: Number(form.taskId), reason: form.reason.trim() });
    message.success('仲裁申请已提交，管理员将尽快裁定');
    dialogOpen.value = false;
    page.value = 1;
    await load();
  } catch (e) {
    message.error((e as NormalizedError).friendlyMessage ?? '提交失败');
  } finally {
    submitting.value = false;
  }
}
</script>

<template>
  <PageHeader title="我的仲裁" subtitle="对验收结果不公或教师失联等情况可发起仲裁，由管理员裁定" />
  <a-card class="block">
    <template #title>
      <div class="card-header-row">
        <span>仲裁记录</span>
        <a-button type="primary" size="small" @click="openDialog">发起仲裁</a-button>
      </div>
    </template>
    <a-spin :spinning="loading">
      <div class="table-area">
        <a-table v-if="items.length > 0" :columns="columns" :data-source="items" :pagination="false" row-key="id">
          <template #bodyCell="{ column, record }">
            <template v-if="column.key === 'taskId'">
              <a-button
                v-if="record.taskId"
                type="link"
                class="task-link"
                @click="$router.push(`/tasks/${record.taskId}`)"
              >
                任务 #{{ record.taskId }}
              </a-button>
              <span v-else>—</span>
            </template>
            <template v-else-if="column.key === 'reason'">{{ record.reason }}</template>
            <template v-else-if="column.key === 'status'"><StatusTag :status="record.status" /></template>
            <template v-else-if="column.key === 'decision'">
              <span v-if="record.decision">{{ decisionLabel[record.decision] ?? record.decision }}</span>
              <span v-else class="muted">待裁定</span>
              <template v-if="record.payPoints !== null && record.payPoints !== undefined">
                <span class="muted">（</span><PointsNum :value="record.payPoints" suffix="分" /><span class="muted">）</span>
              </template>
            </template>
            <template v-else-if="column.key === 'resolutionNote'">{{ record.resolutionNote || '—' }}</template>
            <template v-else-if="column.key === 'createdAt'">{{ fmtTime(record.createdAt) }}</template>
          </template>
        </a-table>
        <EmptyState v-else-if="!loading" description="没有仲裁记录" />
      </div>
    </a-spin>
    <div class="pager">
      <AppPagination v-model:page="page" :page-size="PAGE_SIZE" :total="total" hide-on-single-page @change="load" />
    </div>
  </a-card>

  <a-modal v-model:open="dialogOpen" title="发起仲裁" :width="520">
    <a-form ref="formRef" :model="form" :rules="rules" layout="vertical" @submit.prevent="onCreate">
      <a-form-item label="关联任务 ID" name="taskId">
        <a-input v-model:value="form.taskId" class="task-id-input" placeholder="任务列表中的数字 ID，如 12" />
        <div class="field-tip">可在「我的任务」或任务详情页地址中查看任务 ID</div>
      </a-form-item>
      <a-form-item label="仲裁理由（至少 10 字）" name="reason">
        <a-textarea
          v-model:value="form.reason"
          :rows="5"
          :maxlength="500"
          show-count
          placeholder="说明争议经过：验收结果、沟通情况等，管理员将据此裁定"
        />
      </a-form-item>
    </a-form>
    <template #footer>
      <a-button @click="dialogOpen = false">取消</a-button>
      <a-button type="primary" :loading="submitting" @click="onCreate">提交仲裁</a-button>
    </template>
  </a-modal>
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
.task-link {
  padding: 0;
  height: auto;
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
