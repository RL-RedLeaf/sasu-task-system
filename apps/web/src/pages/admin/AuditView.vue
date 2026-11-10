<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue';
import { message } from '@/composables/feedback';
import { labelOf } from '@sasu/shared';
import type { NormalizedError } from '@/api/http';
import { auditApi, type AuditRow } from '@/api/admin';
import PageHeader from '@/components/PageHeader.vue';
import EmptyState from '@/components/EmptyState.vue';
import AppPagination from '@/components/AppPagination.vue';
import type { TableColumnsType } from 'ant-design-vue';

function errMsg(e: unknown): string {
  return (e as NormalizedError).friendlyMessage ?? '操作失败';
}

function auditActionText(action: string): string {
  return labelOf.auditAction(action);
}

function fmtTime(value: string): string {
  return value ? new Date(value).toLocaleString('zh-CN') : '—';
}

const roleLabels: Record<string, string> = { STUDENT: '学生', TEACHER: '教师', ADMIN: '管理员', SYSTEM: '系统' };

const columns: TableColumnsType = [
  { title: '时间', key: 'createdAt', width: 170 },
  { title: '操作人 ID', key: 'actorId', width: 110, align: 'center' },
  { title: '角色', key: 'actorRole', width: 90 },
  { title: '动作', key: 'action' },
  { title: '目标类型', key: 'targetType', width: 140 },
  { title: '目标 ID', key: 'targetId', width: 110, align: 'center' },
  { title: '原因', key: 'reason', ellipsis: true },
  { title: 'IP', key: 'ip', width: 140 },
];

const loading = ref(false);
const items = ref<AuditRow[]>([]);
const total = ref(0);
const page = ref(1);
const pageSize = ref(20);
const filters = reactive({ action: '', actorRole: '' });

const roleOptions = [
  { label: '学生', value: 'STUDENT' },
  { label: '教师', value: 'TEACHER' },
  { label: '管理员', value: 'ADMIN' },
  { label: '系统', value: 'SYSTEM' },
];

async function load(): Promise<void> {
  loading.value = true;
  try {
    const data = await auditApi.list({
      action: filters.action || undefined,
      actorRole: filters.actorRole || undefined,
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

function onSearch(): void {
  page.value = 1;
  void load();
}

onMounted(() => void load());
</script>

<template>
  <PageHeader title="审计日志" subtitle="管理员与系统的关键操作留痕，可按动作/角色筛选" />

  <a-card class="block">
    <div class="toolbar">
      <a-input
        v-model:value="filters.action"
        placeholder="动作 action，如 USER_DISABLE、TASK_PRICE"
        allow-clear
        style="width: 260px"
        @keyup.enter="onSearch"
      />
      <a-select
        v-model:value="filters.actorRole"
        placeholder="操作人角色"
        allow-clear
        style="width: 140px"
        :options="roleOptions"
      />
      <a-button type="primary" @click="onSearch">查询</a-button>
    </div>

    <a-table
      :columns="columns"
      :data-source="items"
      :loading="loading"
      :pagination="false"
      row-key="id"
      :scroll="{ x: 1100 }"
    >
      <template #bodyCell="{ column, record }">
        <template v-if="column.key === 'createdAt'">{{ fmtTime(record.createdAt) }}</template>
        <template v-else-if="column.key === 'actorRole'">{{ roleLabels[record.actorRole] ?? record.actorRole }}</template>
        <template v-else-if="column.key === 'action'">{{ auditActionText(record.action) }}</template>
        <template v-else-if="column.key === 'targetId'">{{ record.targetId ?? '—' }}</template>
        <template v-else-if="column.key === 'reason'">{{ record.reason ?? '—' }}</template>
        <template v-else-if="column.key === 'ip'">{{ record.ip ?? '—' }}</template>
      </template>
      <template #emptyText><EmptyState description="暂无审计日志" /></template>
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
.toolbar {
  display: flex;
  gap: 8px;
  align-items: center;
  margin-bottom: 12px;
}
.pager {
  margin-top: 12px;
  display: flex;
  justify-content: flex-end;
}
.mono {
  font-family: 'SFMono-Regular', Consolas, 'Liberation Mono', monospace;
  font-size: 13px;
}
</style>
