<script setup lang="ts">
import { onMounted, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import { ElMessage, ElMessageBox } from 'element-plus';
import type { NormalizedError } from '@/api/http';
import { communityApi } from '@/api/admin';
import PageHeader from '@/components/PageHeader.vue';
import StatusTag from '@/components/StatusTag.vue';
import EmptyState from '@/components/EmptyState.vue';

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
  { status: 'HANDLED', label: '已处理' },
  { status: 'DISMISSED', label: '已驳回' },
];

const activeStatus = ref('OPEN');
const loading = ref(false);
interface ReportRow {
  id: string;
  targetType: string;
  targetId: string;
  reason: string;
  status: string;
  createdAt: string;
  reporter: { name: string };
}
const items = ref<ReportRow[]>([]);
const total = ref(0);
const page = ref(1);
const pageSize = ref(20);

async function load(): Promise<void> {
  loading.value = true;
  try {
    const data = await communityApi.adminReports({
      status: activeStatus.value,
      page: page.value,
      pageSize: pageSize.value,
    });
    items.value = data.items as ReportRow[];
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

function goTaskAdmin(targetId: string): void {
  void router.push(`/teacher/tasks/${targetId}`);
}

// ---------- 处理 ----------
async function handleReport(row: ReportRow): Promise<void> {
  const targetHint =
    row.targetType === 'TASK'
      ? `如内容违规，请先到任务管理页对该任务（#${row.targetId}）执行「强制下架」，再回来填写处理备注。`
      : `目标为留言（#${row.targetId}），请确认后填写处理备注。`;
  try {
    const { value } = await ElMessageBox.prompt(
      `${targetHint} 请填写处理备注（必填）。`,
      `处理举报 #${row.id}`,
      {
        confirmButtonText: '确认处理',
        cancelButtonText: '取消',
        inputPlaceholder: '处理备注，如：已强制下架该任务',
        inputValidator: (v: string) => (v && v.trim() ? true : '处理备注不能为空'),
      },
    );
    await communityApi.handleReport(row.id, { note: value.trim() });
    ElMessage.success('举报已标记处理');
    void load();
  } catch (e) {
    if (e !== 'cancel' && e !== 'close') ElMessage.error(errMsg(e));
  }
}

// ---------- 驳回举报 ----------
async function dismissReport(row: ReportRow): Promise<void> {
  try {
    const { value } = await ElMessageBox.prompt(
      '确认驳回该举报吗？驳回表示举报内容不成立，请填写理由（必填）。',
      `驳回举报 #${row.id}`,
      {
        confirmButtonText: '确认驳回',
        cancelButtonText: '取消',
        inputPlaceholder: '驳回理由',
        inputValidator: (v: string) => (v && v.trim() ? true : '驳回理由不能为空'),
      },
    );
    await communityApi.handleReport(row.id, { dismiss: true, note: value.trim() });
    ElMessage.success('举报已驳回');
    void load();
  } catch (e) {
    if (e !== 'cancel' && e !== 'close') ElMessage.error(errMsg(e));
  }
}
</script>

<template>
  <PageHeader title="举报处理" subtitle="对任务/留言违规举报的处理与驳回" />

  <el-card shadow="never" class="block">
    <el-tabs v-model="activeStatus">
      <el-tab-pane v-for="tab in TABS" :key="tab.status" :name="tab.status" :label="tab.label" />
    </el-tabs>

    <el-table v-loading="loading" :data="items" stripe>
      <el-table-column label="举报人" width="130">
        <template #default="{ row }">{{ row.reporter?.name ?? '—' }}</template>
      </el-table-column>
      <el-table-column label="类型" width="100">
        <template #default="{ row }">{{ row.targetType === 'TASK' ? '任务' : '留言' }}</template>
      </el-table-column>
      <el-table-column label="目标 ID" width="120">
        <template #default="{ row }">
          <el-link v-if="row.targetType === 'TASK'" type="primary" :underline="false" @click="goTaskAdmin(row.targetId)">
            #{{ row.targetId }}
          </el-link>
          <span v-else>#{{ row.targetId }}</span>
        </template>
      </el-table-column>
      <el-table-column label="理由" min-width="220" show-overflow-tooltip>
        <template #default="{ row }">{{ truncate(row.reason) }}</template>
      </el-table-column>
      <el-table-column label="时间" width="170">
        <template #default="{ row }">{{ fmtTime(row.createdAt) }}</template>
      </el-table-column>
      <el-table-column label="状态" width="100">
        <template #default="{ row }">
          <StatusTag
            :status="row.status === 'HANDLED' ? '已处理' : row.status === 'DISMISSED' ? '已驳回' : row.status"
          />
        </template>
      </el-table-column>
      <el-table-column label="操作" width="180" fixed="right">
        <template #default="{ row }">
          <template v-if="row.status === 'OPEN'">
            <el-button link type="primary" size="small" @click="handleReport(row as ReportRow)">处理</el-button>
            <el-button link type="danger" size="small" @click="dismissReport(row as ReportRow)">驳回举报</el-button>
          </template>
        </template>
      </el-table-column>
      <template #empty><EmptyState description="该状态下暂无举报" /></template>
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
</style>
