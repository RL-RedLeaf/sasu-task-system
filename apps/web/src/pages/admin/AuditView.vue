<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue';
import { ElMessage } from 'element-plus';
import type { NormalizedError } from '@/api/http';
import { auditApi, type AuditRow } from '@/api/admin';
import PageHeader from '@/components/PageHeader.vue';
import EmptyState from '@/components/EmptyState.vue';

function errMsg(e: unknown): string {
  return (e as NormalizedError).friendlyMessage ?? '操作失败';
}

function fmtTime(value: string): string {
  return value ? new Date(value).toLocaleString('zh-CN') : '—';
}

const roleLabels: Record<string, string> = { STUDENT: '学生', TEACHER: '教师', ADMIN: '管理员', SYSTEM: '系统' };

const loading = ref(false);
const items = ref<AuditRow[]>([]);
const total = ref(0);
const page = ref(1);
const pageSize = ref(20);
const filters = reactive({ action: '', actorRole: '' });

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
    ElMessage.error(errMsg(e));
  } finally {
    loading.value = false;
  }
}

function onSearch(): void {
  page.value = 1;
  void load();
}

function onPageChange(): void {
  void load();
}

onMounted(() => void load());
</script>

<template>
  <PageHeader title="审计日志" subtitle="管理员与系统的关键操作留痕，可按动作/角色筛选" />

  <el-card shadow="never" class="block">
    <div class="toolbar">
      <el-input
        v-model="filters.action"
        placeholder="动作 action，如 USER_DISABLE、TASK_PRICE"
        clearable
        style="width: 260px"
        @keyup.enter="onSearch"
      />
      <el-select v-model="filters.actorRole" placeholder="操作人角色" clearable style="width: 140px">
        <el-option label="学生" value="STUDENT" />
        <el-option label="教师" value="TEACHER" />
        <el-option label="管理员" value="ADMIN" />
        <el-option label="系统" value="SYSTEM" />
      </el-select>
      <el-button type="primary" @click="onSearch">查询</el-button>
    </div>

    <el-table v-loading="loading" :data="items" stripe>
      <el-table-column label="时间" width="170">
        <template #default="{ row }">{{ fmtTime(row.createdAt) }}</template>
      </el-table-column>
      <el-table-column label="操作人 ID" width="110" align="center">
        <template #default="{ row }">{{ row.actorId }}</template>
      </el-table-column>
      <el-table-column label="角色" width="90">
        <template #default="{ row }">{{ roleLabels[row.actorRole] ?? row.actorRole }}</template>
      </el-table-column>
      <el-table-column label="动作" min-width="180">
        <template #default="{ row }">
          <span class="mono">{{ row.action }}</span>
        </template>
      </el-table-column>
      <el-table-column label="目标类型" width="140">
        <template #default="{ row }">{{ row.targetType }}</template>
      </el-table-column>
      <el-table-column label="目标 ID" width="110" align="center">
        <template #default="{ row }">{{ row.targetId ?? '—' }}</template>
      </el-table-column>
      <el-table-column label="原因" min-width="200" show-overflow-tooltip>
        <template #default="{ row }">{{ row.reason ?? '—' }}</template>
      </el-table-column>
      <el-table-column label="IP" width="140">
        <template #default="{ row }">{{ row.ip ?? '—' }}</template>
      </el-table-column>
      <template #empty><EmptyState description="暂无审计日志" /></template>
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
