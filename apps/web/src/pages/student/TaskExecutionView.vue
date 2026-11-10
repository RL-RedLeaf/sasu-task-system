<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { ElMessage, type UploadFile, type UploadUserFile } from 'element-plus';
import { submissionsApi, tasksApi, type TaskSummary } from '@/api/tasks';
import type { NormalizedError } from '@/api/http';
import EmptyState from '@/components/EmptyState.vue';
import PageHeader from '@/components/PageHeader.vue';
import PointsNum from '@/components/PointsNum.vue';
import StatusTag from '@/components/StatusTag.vue';

interface SubmissionFileItem {
  file: { id: string; originalName: string; mime: string };
}
interface SubmissionItem {
  id: string;
  version: number;
  content: string;
  status: string;
  submittedAt: string;
  files: SubmissionFileItem[];
}
interface ReviewItem {
  id: string;
  submissionId: string;
  decision: 'ACCEPT' | 'REJECT';
  reason: string | null;
  isProxy: boolean;
  createdAt: string;
}
interface HistoryData {
  id: string;
  taskId: string;
  attemptNo: number;
  status: string;
  claimedAt: string;
  acceptedAt: string | null;
  resubmitDeadline: string | null;
  rejectCount: number;
  basePaid: number;
  bonusPaid: number;
  isViolation: boolean;
  violationPenalty: number;
  violationDeducted: number;
  submissions: SubmissionItem[];
  reviews: ReviewItem[];
}

const MAX_FILES = 5;
const MAX_FILE_SIZE = 20 * 1024 * 1024;
const REJECT_MAX = 3;

const route = useRoute();
const router = useRouter();

const assignmentId = computed(() => String(route.params.assignmentId ?? ''));
const assignment = ref<HistoryData | null>(null);
const task = ref<TaskSummary | null>(null);
const loading = ref(false);

const content = ref('');
const fileList = ref<UploadUserFile[]>([]);
const submitting = ref(false);

const now = ref(Date.now());
let timer: ReturnType<typeof setInterval> | null = null;

const status = computed(() => assignment.value?.status ?? '');
const isActiveStatus = computed(() => status.value === 'CLAIMED' || status.value === 'REJECTED');
const isTerminalBad = computed(() =>
  ['WITHDRAWN', 'OVERDUE', 'FAILED', 'CANCELLED_BY_TEACHER'].includes(status.value),
);
const isDone = computed(() => status.value === 'ACCEPTED' || status.value === 'SETTLED');
const earned = computed(() => (assignment.value?.basePaid ?? 0) + (assignment.value?.bonusPaid ?? 0));

const activeStep = computed(() => {
  if (status.value === 'CLAIMED') return 1;
  if (status.value === 'SUBMITTED') return 2;
  if (status.value === 'REJECTED') return 1; // 驳回后回到「提交」环节重交
  return 3;
});
const reviewStepError = computed(() => status.value === 'REJECTED');

/** 最新一条驳回记录（重交提示用） */
const lastReject = computed(() => {
  const reviews = assignment.value?.reviews ?? [];
  return reviews.find((r) => r.decision === 'REJECT') ?? null;
});

const resubmitLeft = computed(() => {
  const d = assignment.value?.resubmitDeadline;
  if (!d) return '';
  const diff = new Date(d).getTime() - now.value;
  if (diff <= 0) return '重交窗口已结束';
  const days = Math.floor(diff / 86_400_000);
  const hours = Math.floor((diff % 86_400_000) / 3_600_000);
  const minutes = Math.floor((diff % 3_600_000) / 60_000);
  if (days > 0) return `剩余 ${days} 天 ${hours} 小时`;
  if (hours > 0) return `剩余 ${hours} 小时 ${minutes} 分钟`;
  return `剩余 ${minutes} 分钟`;
});
const resubmitUrgent = computed(() => {
  const d = assignment.value?.resubmitDeadline;
  if (!d) return false;
  const diff = new Date(d).getTime() - now.value;
  return diff > 0 && diff < 24 * 3_600_000;
});

function fmtTime(v: string | null | undefined): string {
  return v ? new Date(v).toLocaleString('zh-CN') : '—';
}

function terminalHint(s: string): string {
  const map: Record<string, string> = {
    WITHDRAWN: '你已在截止前主动取消该任务，不计违约。',
    OVERDUE: '截止时间到达时仍未提交，已判定违约并扣除违约金。',
    FAILED: '被驳回后未在重交窗口内重新提交，已判定违约并扣除违约金。',
    CANCELLED_BY_TEACHER: '任务被教师取消/下架，不计违约。',
  };
  return map[s] ?? '';
}

async function load(): Promise<void> {
  loading.value = true;
  try {
    const data = (await submissionsApi.history(assignmentId.value)) as unknown as HistoryData;
    assignment.value = data;
    if (data.taskId) {
      try {
        task.value = await tasksApi.detail(data.taskId);
      } catch {
        task.value = null;
      }
    }
  } catch (e) {
    ElMessage.error((e as NormalizedError).friendlyMessage ?? '加载失败');
  } finally {
    loading.value = false;
  }
}

function onFileChange(file: UploadFile, list: UploadFile[]): void {
  if (list.length > MAX_FILES) {
    ElMessage.warning(`最多上传 ${MAX_FILES} 个文件`);
    fileList.value = list.slice(0, MAX_FILES);
    return;
  }
  const raw = file.raw as File | undefined;
  if (raw && raw.size > MAX_FILE_SIZE) {
    ElMessage.warning(`「${raw.name}」超过 20MB，已移除`);
    fileList.value = list.filter((f) => f !== file);
  }
}

async function onSubmit(): Promise<void> {
  const text = content.value.trim();
  if (text.length < 10 || text.length > 1000) {
    ElMessage.warning('文字说明需 10-1000 字');
    return;
  }
  const files = fileList.value
    .map((f) => f.raw as File | undefined)
    .filter((f): f is File => f instanceof File);
  submitting.value = true;
  try {
    const res = await submissionsApi.submit(assignmentId.value, text, files);
    ElMessage.success(`提交成功，当前为第 ${res.version} 版，等待教师验收`);
    content.value = '';
    fileList.value = [];
    await load();
  } catch (e) {
    ElMessage.error((e as NormalizedError).friendlyMessage ?? '提交失败');
  } finally {
    submitting.value = false;
  }
}

function base64ToBlob(base64: string, mime: string): Blob {
  const bin = atob(base64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type: mime || 'application/octet-stream' });
}

async function downloadFile(fileId: string, fallbackName: string, fallbackMime: string): Promise<void> {
  try {
    const r = await submissionsApi.downloadFile(fileId);
    const blob = base64ToBlob(r.contentBase64, r.meta?.mime || fallbackMime);
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = r.meta?.originalName || fallbackName || `file-${fileId}`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  } catch (e) {
    ElMessage.error((e as NormalizedError).friendlyMessage ?? '下载失败');
  }
}

onMounted(() => {
  timer = setInterval(() => {
    now.value = Date.now();
  }, 30_000);
  void load();
});
onBeforeUnmount(() => {
  if (timer) clearInterval(timer);
});
</script>

<template>
  <div v-loading="loading">
    <PageHeader title="任务执行" subtitle="按时提交交付物；被驳回请在重交窗口内重新提交，最多驳回 3 次" />

    <template v-if="assignment">
      <!-- 任务概要 -->
      <el-card shadow="never" class="block">
        <template #header>
          <div class="card-header-row">
            <span>任务概要</span>
            <StatusTag :status="assignment.status" />
          </div>
        </template>
        <div v-if="task" class="summary">
          <el-link type="primary" class="summary-title" @click="router.push(`/tasks/${task.id}`)">
            {{ task.title }}
          </el-link>
          <el-descriptions :column="3" class="summary-desc">
            <el-descriptions-item label="分类">{{ task.category?.name ?? '—' }}</el-descriptions-item>
            <el-descriptions-item label="教师">{{ task.teacher?.name ?? '—' }}</el-descriptions-item>
            <el-descriptions-item label="单人赏金">
              <PointsNum :value="task.rewardPerPerson ?? 0" suffix="分" />
            </el-descriptions-item>
            <el-descriptions-item label="接单时间">{{ fmtTime(assignment.claimedAt) }}</el-descriptions-item>
            <el-descriptions-item label="任务截止">{{ fmtTime(task.deadlineAt) }}</el-descriptions-item>
            <el-descriptions-item label="驳回次数">
              {{ assignment.rejectCount }} / {{ REJECT_MAX }}
            </el-descriptions-item>
          </el-descriptions>
        </div>
        <div v-else class="summary">
          <p class="muted">任务概要暂不可见（接单记录 #{{ assignmentId }}）</p>
        </div>
      </el-card>

      <!-- 终态提示 -->
      <el-alert
        v-if="isTerminalBad"
        :title="terminalHint(assignment.status)"
        :type="assignment.isViolation ? 'error' : 'info'"
        show-icon
        :closable="false"
        class="block"
      />

      <!-- 重交窗口高亮 -->
      <el-alert
        v-if="status === 'REJECTED'"
        type="error"
        show-icon
        :closable="false"
        class="block resubmit-alert"
      >
        <template #title>
          第 {{ assignment.rejectCount }} 次被驳回，请在重交窗口内重新提交
          <span :style="resubmitUrgent ? { color: 'var(--sasu-color-danger)', fontWeight: 600 } : {}">
            （重交截止 {{ fmtTime(assignment.resubmitDeadline) }}，{{ resubmitLeft }}）
          </span>
        </template>
        <div v-if="lastReject" class="pre-wrap">
          驳回理由：{{ lastReject.reason ?? '（未填写）' }}
        </div>
        <div v-else>驳回理由见下方历史版本。</div>
        <div v-if="assignment.rejectCount >= REJECT_MAX" class="warn-line">
          已达驳回次数上限（{{ REJECT_MAX }} 次），本次验收只能通过或转管理员仲裁，请尽快与教师沟通。
        </div>
      </el-alert>

      <!-- 状态时间线 -->
      <el-card shadow="never" class="block" header="进度">
        <el-steps :active="activeStep" align-center finish-status="success">
          <el-step title="接单" :description="fmtTime(assignment.claimedAt)" />
          <el-step
            title="提交"
            :description="
              assignment.submissions.length > 0
                ? `最新 v${assignment.submissions[0]?.version ?? 1} · ${fmtTime(assignment.submissions[0]?.submittedAt)}`
                : '未提交'
            "
          />
          <el-step
            title="验收"
            :status="reviewStepError ? 'error' : undefined"
            :description="isDone ? fmtTime(assignment.acceptedAt) : reviewStepError ? '已驳回，请重交' : '等待教师验收'"
          />
        </el-steps>
        <div v-if="isDone" class="earned">
          已获得积分：<PointsNum :value="earned" suffix="分" />
          <span class="muted">（基础 {{ assignment.basePaid }} + 再分配 {{ assignment.bonusPaid }}）</span>
        </div>
        <div v-if="assignment.isViolation" class="violation">
          违约金：应扣 {{ assignment.violationPenalty }} 分，实扣 {{ assignment.violationDeducted }} 分
        </div>
      </el-card>

      <!-- 提交表单 -->
      <el-card v-if="isActiveStatus" shadow="never" class="block" header="提交交付物">
        <el-form label-position="top" @submit.prevent="onSubmit">
          <el-form-item label="文字说明（10-1000 字，提交后不可修改）">
            <el-input
              v-model="content"
              type="textarea"
              :rows="6"
              maxlength="1000"
              show-word-limit
              placeholder="描述你完成了什么、结果放在哪里等"
            />
          </el-form-item>
          <el-form-item label="附件（选填，最多 5 个，单个 ≤ 20MB）">
            <el-upload
              v-model:file-list="fileList"
              multiple
              :auto-upload="false"
              :limit="MAX_FILES"
              :on-change="onFileChange"
              :on-exceed="() => ElMessage.warning(`最多上传 ${MAX_FILES} 个文件`)"
            >
              <el-button type="primary" plain>选择文件</el-button>
              <template #tip>
                <div class="upload-tip">支持任意格式，图片 / 文档可直接给教师下载查看</div>
              </template>
            </el-upload>
          </el-form-item>
          <el-button type="primary" :loading="submitting" @click="onSubmit">提交交付物</el-button>
          <span v-if="status === 'REJECTED'" class="tip">本次提交将作为新版本（v{{ assignment.rejectCount + 1 }}）</span>
        </el-form>
      </el-card>

      <!-- 历史版本 -->
      <el-card shadow="never" class="block" header="提交历史">
        <div v-if="assignment.submissions.length > 0">
          <div v-for="s in assignment.submissions" :key="s.id" class="version-item">
            <div class="version-head">
              <span class="version-no">v{{ s.version }}</span>
              <StatusTag :status="s.status === 'PENDING' ? 'SUBMITTED' : s.status" />
              <span class="time">{{ fmtTime(s.submittedAt) }}</span>
            </div>
            <div class="version-body pre-wrap">{{ s.content }}</div>
            <div v-if="s.files && s.files.length > 0" class="version-files">
              <el-link
                v-for="f in s.files"
                :key="f.file.id"
                type="primary"
                class="file-link"
                @click="downloadFile(f.file.id, f.file.originalName, f.file.mime)"
              >
                {{ f.file.originalName }}
              </el-link>
            </div>
            <div
              v-for="r in (assignment.reviews ?? []).filter((x) => x.submissionId === s.id)"
              :key="r.id"
              class="review-line"
            >
              <el-tag size="small" :type="r.decision === 'ACCEPT' ? 'success' : 'danger'">
                {{ r.decision === 'ACCEPT' ? '验收通过' : '验收驳回' }}
              </el-tag>
              <span v-if="r.isProxy" class="muted">（管理员代验收）</span>
              <span v-if="r.reason" class="pre-wrap">理由：{{ r.reason }}</span>
              <span class="time">{{ fmtTime(r.createdAt) }}</span>
            </div>
          </div>
        </div>
        <EmptyState v-else description="还没有提交过交付物" />
      </el-card>
    </template>
    <EmptyState v-else-if="!loading" description="接单记录不存在" />
  </div>
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
.summary-title {
  font-size: 15px;
  font-weight: 600;
}
.summary-desc {
  margin-top: 8px;
}
.resubmit-alert :deep(.el-alert__title) {
  white-space: normal;
}
.warn-line {
  margin-top: 6px;
  color: var(--sasu-color-danger);
}
.earned {
  margin-top: 16px;
  color: var(--sasu-color-success);
  font-size: 15px;
  text-align: center;
}
.violation {
  margin-top: 8px;
  color: var(--sasu-color-danger);
  font-size: 13px;
  text-align: center;
}
.upload-tip {
  color: var(--sasu-text-secondary);
  font-size: 12px;
}
.tip {
  margin-left: 12px;
  color: var(--sasu-text-secondary);
  font-size: 12px;
}
.muted {
  color: var(--sasu-text-secondary);
}
.pre-wrap {
  white-space: pre-wrap;
  word-break: break-word;
}
.version-item {
  padding: 12px 0;
  border-bottom: 1px solid var(--sasu-border);
}
.version-item:last-child {
  border-bottom: none;
}
.version-head {
  display: flex;
  align-items: center;
  gap: 10px;
}
.version-no {
  font-weight: 700;
  color: var(--sasu-color-primary);
}
.version-head .time {
  margin-left: auto;
  color: var(--sasu-text-secondary);
  font-size: 12px;
}
.version-body {
  margin-top: 6px;
}
.version-files {
  margin-top: 6px;
}
.file-link {
  margin-right: 12px;
}
.review-line {
  margin-top: 8px;
  padding: 8px 10px;
  background: var(--sasu-bg-page);
  border-radius: 6px;
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  font-size: 13px;
}
.review-line .time {
  margin-left: auto;
  color: var(--sasu-text-secondary);
  font-size: 12px;
}
</style>
