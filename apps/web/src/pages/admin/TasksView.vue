<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import { ElMessage, ElMessageBox } from 'element-plus';
import type { FormInstance, FormRules } from 'element-plus';
import type { NormalizedError } from '@/api/http';
import { tasksApi, type TaskSummary } from '@/api/tasks';
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

const router = useRouter();

// ---------- 列表 ----------
const TABS = [
  { status: 'PENDING_REWARD', label: '待定价' },
  { status: 'RECRUITING', label: '招募中' },
  { status: 'FULL', label: '已满' },
  { status: 'CLOSED', label: '已截止' },
  { status: 'SETTLED', label: '已完成' },
  { status: 'CANCELLED', label: '已取消' },
  { status: 'OFFLINE', label: '已下架' },
];

const activeStatus = ref('PENDING_REWARD');
const keyword = ref('');
const loading = ref(false);
const items = ref<TaskSummary[]>([]);
const total = ref(0);
const page = ref(1);
const pageSize = ref(20);

async function load(): Promise<void> {
  loading.value = true;
  try {
    const data = await tasksApi.adminList({
      status: activeStatus.value,
      keyword: keyword.value || undefined,
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

watch(activeStatus, () => {
  page.value = 1;
  void load();
});

function onPageChange(): void {
  void load();
}

function goDetail(id: string): void {
  void router.push(`/teacher/tasks/${id}`);
}

onMounted(() => void load());

/** 已定价且未结算：可改价 / 结算预览 */
function isPricedUnsettled(row: TaskSummary): boolean {
  return row.rewardPerPerson !== null && row.settlementStatus !== 'DONE' && row.status !== 'SETTLED' && row.status !== 'CANCELLED';
}

// ---------- 定价 ----------
const priceVisible = ref(false);
const priceTask = ref<TaskSummary | null>(null);
const priceLoading = ref(false);
const priceForm = reactive({ reward: 1 });

const MAX_REWARD = 500;
const MAX_TOTAL = 10000;

const priceTotal = computed(() => (priceTask.value ? priceForm.reward * priceTask.value.headcount : 0));
const priceValid = computed(() => priceForm.reward >= 1 && priceForm.reward <= MAX_REWARD && priceTotal.value <= MAX_TOTAL);
/** 当前名额下允许的最高单人赏金 */
const maxRewardForHeadcount = computed(() =>
  priceTask.value ? Math.max(1, Math.floor(MAX_TOTAL / priceTask.value.headcount)) : 1,
);
/** 当前赏金下允许的最大名额 */
const maxHeadcountForReward = computed(() =>
  priceForm.reward > 0 ? Math.floor(MAX_TOTAL / priceForm.reward) : 0,
);

function openPrice(row: TaskSummary): void {
  priceTask.value = row;
  priceForm.reward = Math.min(MAX_REWARD, Math.max(1, Math.floor(MAX_TOTAL / row.headcount)));
  priceVisible.value = true;
}

async function submitPrice(): Promise<void> {
  if (!priceTask.value || !priceValid.value) return;
  priceLoading.value = true;
  try {
    const res = await tasksApi.price(priceTask.value.id, priceForm.reward);
    ElMessage.success(`定价成功，总额 ${res.totalAmount} 分`);
    priceVisible.value = false;
    void load();
  } catch (e) {
    ElMessage.error(errMsg(e));
  } finally {
    priceLoading.value = false;
  }
}

// ---------- 改价 ----------
const repriceVisible = ref(false);
const repriceTask = ref<TaskSummary | null>(null);
const repriceFormRef = ref<FormInstance>();
const repriceLoading = ref(false);
const repriceForm = reactive({ reward: 1, reason: '' });

const repriceRules: FormRules = {
  reward: [{ required: true, message: '请输入新赏金', trigger: 'blur' }],
  reason: [{ required: true, message: '请填写改价原因', trigger: 'blur' }],
};

const repriceValid = computed(() => repriceForm.reward >= 1 && repriceForm.reward <= MAX_REWARD);

function openReprice(row: TaskSummary): void {
  repriceTask.value = row;
  repriceForm.reward = row.rewardPerPerson ?? 1;
  repriceForm.reason = '';
  repriceVisible.value = true;
}

async function submitReprice(): Promise<void> {
  if (!repriceTask.value) return;
  await repriceFormRef.value?.validate();
  if (!repriceValid.value) {
    ElMessage.warning('单人赏金需在 1-500 分之间');
    return;
  }
  repriceLoading.value = true;
  try {
    const res = await tasksApi.reprice(repriceTask.value.id, repriceForm.reward, repriceForm.reason.trim());
    ElMessage.success(res.topupPaid > 0 ? `改价成功，已向已通过学生补差 ${res.topupPaid} 分` : '改价成功，无需补差');
    repriceVisible.value = false;
    void load();
  } catch (e) {
    ElMessage.error(errMsg(e));
  } finally {
    repriceLoading.value = false;
  }
}

// ---------- 强制下架 / 强制取消 ----------
async function forceAction(row: TaskSummary, kind: 'offline' | 'cancel'): Promise<void> {
  const isOffline = kind === 'offline';
  try {
    const { value } = await ElMessageBox.prompt(
      isOffline
        ? '强制下架会将任务转为已截止（结算时按仅退回处理），请填写原因（必填）。'
        : '强制取消会作废任务并将托管积分退回积分池，请填写原因（必填）。',
      isOffline ? `强制下架 #${row.id} ${row.title}` : `强制取消 #${row.id} ${row.title}`,
      {
        confirmButtonText: isOffline ? '确认下架' : '确认取消',
        cancelButtonText: '取消',
        inputPlaceholder: '请填写操作原因',
        inputValidator: (v: string) => (v && v.trim() ? true : '原因不能为空'),
      },
    );
    if (isOffline) await tasksApi.forceOffline(row.id, value.trim());
    else await tasksApi.forceCancel(row.id, value.trim());
    ElMessage.success(isOffline ? '已强制下架' : '已强制取消');
    void load();
  } catch (e) {
    if (e !== 'cancel' && e !== 'close') ElMessage.error(errMsg(e));
  }
}

// ---------- 结算预览 ----------
interface PreviewRow {
  escrowBalance: number;
  acceptedCount: number;
  settlementMode: string;
  perPerson: number;
  remainderRecipients: number;
  refundToPool: number;
  passed: { assignmentId: string; student: string; basePaid: number; acceptedAt: string | null }[];
}
const previewVisible = ref(false);
const previewLoading = ref(false);
const preview = ref<PreviewRow | null>(null);
const previewTask = ref<TaskSummary | null>(null);

async function openPreview(row: TaskSummary): Promise<void> {
  previewTask.value = row;
  preview.value = null;
  previewVisible.value = true;
  previewLoading.value = true;
  try {
    preview.value = (await tasksApi.settlementPreview(row.id)) as unknown as PreviewRow;
  } catch (e) {
    ElMessage.error(errMsg(e));
  } finally {
    previewLoading.value = false;
  }
}
</script>

<template>
  <PageHeader title="任务管理" subtitle="全部任务的定价、改价与强制处理；点击标题查看详情" />

  <el-card shadow="never" class="block">
    <el-tabs v-model="activeStatus">
      <el-tab-pane v-for="tab in TABS" :key="tab.status" :name="tab.status" :label="tab.label" />
    </el-tabs>

    <div class="toolbar">
      <el-input
        v-model="keyword"
        placeholder="按任务标题 / 教师姓名搜索"
        clearable
        style="width: 260px"
        @keyup.enter="onSearch"
      />
      <el-button type="primary" @click="onSearch">搜索</el-button>
    </div>

    <el-table v-loading="loading" :data="items" stripe>
      <el-table-column label="标题" min-width="220">
        <template #default="{ row }">
          <el-link type="primary" :underline="false" @click="goDetail(row.id)">#{{ row.id }} {{ row.title }}</el-link>
        </template>
      </el-table-column>
      <el-table-column label="教师" width="110">
        <template #default="{ row }">{{ row.teacher?.name ?? '—' }}</template>
      </el-table-column>
      <el-table-column label="分类" width="110">
        <template #default="{ row }">{{ row.category?.name ?? '—' }}</template>
      </el-table-column>
      <el-table-column label="状态" width="90">
        <template #default="{ row }"><StatusTag :status="row.status" /></template>
      </el-table-column>
      <el-table-column label="赏金（单人）" width="120" align="right">
        <template #default="{ row }">
          <PointsNum v-if="row.rewardPerPerson !== null" :value="row.rewardPerPerson" suffix="分" />
          <span v-else>—</span>
        </template>
      </el-table-column>
      <el-table-column label="名额" width="100" align="center">
        <template #default="{ row }">{{ row.filledCount }}/{{ row.headcount }}</template>
      </el-table-column>
      <el-table-column label="截止时间" width="170">
        <template #default="{ row }">{{ fmtTime(row.deadlineAt) }}</template>
      </el-table-column>
      <el-table-column label="创建时间" width="170">
        <template #default="{ row }">{{ fmtTime(row.createdAt) }}</template>
      </el-table-column>
      <el-table-column label="操作" width="260" fixed="right">
        <template #default="{ row }">
          <el-button v-if="row.status === 'PENDING_REWARD'" link type="primary" size="small" @click="openPrice(row)">定价</el-button>
          <el-button v-if="isPricedUnsettled(row)" link type="primary" size="small" @click="openReprice(row)">改价</el-button>
          <el-button v-if="isPricedUnsettled(row)" link size="small" @click="openPreview(row)">结算预览</el-button>
          <el-button
            v-if="row.status === 'PENDING_REWARD' || (row.status === 'CLOSED' && row.settlementStatus !== 'DONE')"
            link
            type="warning"
            size="small"
            @click="forceAction(row, 'offline')"
          >
            强制下架
          </el-button>
          <el-button
            v-if="row.status === 'PENDING_REWARD' || (row.status === 'CLOSED' && row.settlementStatus !== 'DONE')"
            link
            type="danger"
            size="small"
            @click="forceAction(row, 'cancel')"
          >
            强制取消
          </el-button>
        </template>
      </el-table-column>
      <template #empty><EmptyState description="该状态下暂无任务" /></template>
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

  <!-- 定价对话框 -->
  <el-dialog v-model="priceVisible" :title="priceTask ? `定价 #${priceTask.id} ${priceTask.title}` : '定价'" width="480px">
    <template v-if="priceTask">
      <el-alert
        type="info"
        :closable="false"
        class="mb8"
        :title="`名额 ${priceTask.headcount} 个；单人赏金 1-500 分，总额不超过 ${MAX_TOTAL} 分`"
      />
      <el-form label-width="100px">
        <el-form-item label="单人赏金">
          <el-input-number v-model="priceForm.reward" :min="1" :max="MAX_REWARD" :precision="0" />
          <span class="unit">分</span>
        </el-form-item>
        <el-form-item label="总额">
          <span class="total-num"><PointsNum :value="priceTotal" suffix="分" /></span>
          <span class="formula">（{{ priceForm.reward }} × {{ priceTask.headcount }} 名额）</span>
        </el-form-item>
      </el-form>
      <el-alert
        v-if="!priceValid"
        type="warning"
        :closable="false"
        :title="`总额超限：当前名额下单人赏金最高 ${maxRewardForHeadcount} 分；或 ${priceForm.reward} 分时最多 ${maxHeadcountForReward} 个名额`"
        show-icon
      />
    </template>
    <template #footer>
      <el-button @click="priceVisible = false">取消</el-button>
      <el-button type="primary" :disabled="!priceValid" :loading="priceLoading" @click="submitPrice">确认定价</el-button>
    </template>
  </el-dialog>

  <!-- 改价对话框 -->
  <el-dialog v-model="repriceVisible" :title="repriceTask ? `改价 #${repriceTask.id} ${repriceTask.title}` : '改价'" width="480px">
    <template v-if="repriceTask">
      <el-alert
        type="info"
        :closable="false"
        class="mb8"
        :title="`当前赏金 ${repriceTask.rewardPerPerson} 分/人，名额 ${repriceTask.headcount} 个`"
      />
      <el-alert
        v-if="(repriceTask.acceptedCount ?? 0) > 0"
        type="warning"
        :closable="false"
        show-icon
        class="mb8"
        title="已有学生通过验收，改价只能维持或调高；调高后系统会立即向已通过学生补差。"
      />
      <el-form ref="repriceFormRef" :model="repriceForm" :rules="repriceRules" label-width="100px">
        <el-form-item label="新赏金" prop="reward">
          <el-input-number v-model="repriceForm.reward" :min="1" :max="MAX_REWARD" :precision="0" />
          <span class="unit">分 / 人</span>
        </el-form-item>
        <el-form-item label="改价原因" prop="reason">
          <el-input v-model="repriceForm.reason" type="textarea" :rows="2" placeholder="必填，将记录到审计日志" />
        </el-form-item>
      </el-form>
    </template>
    <template #footer>
      <el-button @click="repriceVisible = false">取消</el-button>
      <el-button type="primary" :loading="repriceLoading" @click="submitReprice">确认改价</el-button>
    </template>
  </el-dialog>

  <!-- 结算预览对话框 -->
  <el-dialog v-model="previewVisible" :title="previewTask ? `结算预览 #${previewTask.id} ${previewTask.title}` : '结算预览'" width="560px">
    <div v-loading="previewLoading">
      <template v-if="preview">
        <el-descriptions :column="2" border>
          <el-descriptions-item label="托管余额"><PointsNum :value="preview.escrowBalance" suffix="分" /></el-descriptions-item>
          <el-descriptions-item label="通过人数">{{ preview.acceptedCount }} 人</el-descriptions-item>
          <el-descriptions-item label="每人可得"><PointsNum :value="preview.perPerson" suffix="分" /></el-descriptions-item>
          <el-descriptions-item label="余数（发给第一名）">{{ preview.remainderRecipients }} 分</el-descriptions-item>
          <el-descriptions-item label="退池金额">
            <PointsNum :value="preview.refundToPool" suffix="分" />
          </el-descriptions-item>
          <el-descriptions-item label="结算模式">
            {{ preview.settlementMode === 'REFUND_ONLY' ? '仅退回（不发放）' : '正常结算' }}
          </el-descriptions-item>
        </el-descriptions>
        <h4 class="sec-title">通过名单</h4>
        <el-empty v-if="preview.passed.length === 0" description="暂无通过验收的学生" :image-size="60" />
        <el-table v-else :data="preview.passed" size="small" max-height="240">
          <el-table-column prop="student" label="学生" width="120" />
          <el-table-column prop="basePaid" label="已发基础分" width="110" align="right" />
          <el-table-column label="通过时间">
            <template #default="{ row }">{{ row.acceptedAt ? new Date(row.acceptedAt).toLocaleString('zh-CN') : '—' }}</template>
          </el-table-column>
        </el-table>
      </template>
    </div>
    <template #footer>
      <el-button @click="previewVisible = false">关闭</el-button>
    </template>
  </el-dialog>
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
.mb8 {
  margin-bottom: 8px;
}
.unit {
  margin-left: 8px;
  color: var(--sasu-text-secondary);
  font-size: 13px;
}
.formula {
  margin-left: 8px;
  color: var(--sasu-text-secondary);
  font-size: 12px;
}
.total-num {
  font-size: 18px;
}
.sec-title {
  margin: 16px 0 8px;
  font-size: 14px;
}
</style>
