<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { confirm, message, prompt } from '@/composables/feedback';
import { communityApi } from '@/api/admin';
import { submissionsApi, tasksApi, type TaskSummary } from '@/api/tasks';
import { useAuthStore } from '@/stores/auth';
import type { NormalizedError } from '@/api/http';
import EmptyState from '@/components/EmptyState.vue';
import PointsNum from '@/components/PointsNum.vue';
import StatusTag from '@/components/StatusTag.vue';

interface CommentRow {
  id: string;
  content: string;
  author: { name: string; role: string };
  createdAt: string;
}

const route = useRoute();
const router = useRouter();
const auth = useAuthStore();

const taskId = computed(() => String(route.params.id ?? ''));
const task = ref<TaskSummary | null>(null);
const comments = ref<CommentRow[]>([]);
const loading = ref(false);
const claiming = ref(false);
const commentText = ref('');
const posting = ref(false);

const now = ref(Date.now());
let timer: ReturnType<typeof setInterval> | null = null;

const roleLabel: Record<string, string> = { STUDENT: '学生', TEACHER: '教师', ADMIN: '管理员' };

const isStudent = computed(() => auth.role === 'STUDENT');
const myAssignment = computed(() => task.value?.myAssignment ?? null);
const canClaim = computed(
  () => isStudent.value && task.value?.status === 'RECRUITING' && !myAssignment.value,
);
const canWithdraw = computed(() => isStudent.value && myAssignment.value?.status === 'CLAIMED');
const canSubmit = computed(
  () => isStudent.value && (myAssignment.value?.status === 'CLAIMED' || myAssignment.value?.status === 'REJECTED'),
);

function remainingText(deadline: string | null | undefined): string {
  if (!deadline) return '—';
  const diff = new Date(deadline).getTime() - now.value;
  if (diff <= 0) return '已截止';
  const days = Math.floor(diff / 86_400_000);
  const hours = Math.floor((diff % 86_400_000) / 3_600_000);
  const minutes = Math.floor((diff % 3_600_000) / 60_000);
  if (days > 0) return `剩余 ${days} 天 ${hours} 小时`;
  if (hours > 0) return `剩余 ${hours} 小时 ${minutes} 分钟`;
  return `剩余 ${minutes} 分钟`;
}
const deadlineUrgent = computed(() => {
  const d = task.value?.deadlineAt;
  if (!d) return false;
  const diff = new Date(d).getTime() - now.value;
  return diff > 0 && diff < 24 * 3_600_000;
});

function fmtTime(v: string | null | undefined): string {
  return v ? new Date(v).toLocaleString('zh-CN') : '—';
}

async function load(): Promise<void> {
  loading.value = true;
  try {
    task.value = await tasksApi.detail(taskId.value);
    try {
      const r = await communityApi.comments(taskId.value);
      comments.value = r.items;
    } catch {
      comments.value = [];
    }
  } catch (e) {
    message.error((e as NormalizedError).friendlyMessage ?? '任务不存在或已下架');
  } finally {
    loading.value = false;
  }
}

async function onClaim(): Promise<void> {
  claiming.value = true;
  try {
    await tasksApi.claim(taskId.value);
    message.success('接单成功，请在截止时间前完成并提交交付物');
    await load();
  } catch (e) {
    message.error((e as NormalizedError).friendlyMessage ?? '接单失败');
  } finally {
    claiming.value = false;
  }
}

async function onWithdraw(): Promise<void> {
  const assignmentId = myAssignment.value?.id;
  if (!assignmentId) return;
  try {
    await confirm({
      title: '取消接单',
      content: '截止前主动取消接单不会计入违约，名额将被释放。确认取消接单？',
      icon: 'warning',
      okText: '确认取消',
      cancelText: '再想想',
    });
  } catch {
    return;
  }
  try {
    await tasksApi.withdrawClaim(assignmentId);
    message.success('已取消接单，名额已释放');
    await load();
  } catch (e) {
    message.error((e as NormalizedError).friendlyMessage ?? '取消失败');
  }
}

function goExecution(): void {
  void router.push(`/my/tasks/${myAssignment.value?.id}`);
}

async function onReport(): Promise<void> {
  let reason: string;
  try {
    reason = (
      await prompt({
        title: '举报任务',
        message: '禁止代课、代考、代写作业、人肉搜索、骚扰他人等内容，违者封号并移交学校处理。',
        placeholder: '请填写举报理由（10-200 字）',
        validate: (v: string) => {
          const n = (v ?? '').trim().length;
          if (n < 10) return '理由至少 10 字';
          if (n > 200) return '理由最多 200 字';
          return true;
        },
      })
    ).trim();
  } catch {
    return;
  }
  try {
    await communityApi.report({ targetType: 'TASK', targetId: Number(taskId.value), reason });
    message.success('举报已提交，管理员将尽快处理');
  } catch (e) {
    message.error((e as NormalizedError).friendlyMessage ?? '举报失败');
  }
}

async function postComment(): Promise<void> {
  const content = commentText.value.trim();
  if (content.length < 1 || content.length > 500) {
    message.warning('留言需 1-500 字');
    return;
  }
  posting.value = true;
  try {
    await communityApi.addComment(taskId.value, content);
    commentText.value = '';
    message.success('留言已发布');
    const r = await communityApi.comments(taskId.value);
    comments.value = r.items;
  } catch (e) {
    message.error((e as NormalizedError).friendlyMessage ?? '留言失败（仅参与任务的用户可发言）');
  } finally {
    posting.value = false;
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
    message.error((e as NormalizedError).friendlyMessage ?? '下载失败');
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
  <a-spin :spinning="loading">
    <template v-if="task">
      <div class="detail-header">
        <div class="detail-title-row">
          <h2 class="detail-title">{{ task.title }}</h2>
          <StatusTag :status="task.status" />
        </div>
        <div class="detail-sub">
          <a-tag>{{ task.category?.name ?? '未分类' }}</a-tag>
          <span>发布于 {{ fmtTime(task.createdAt) }}</span>
        </div>
      </div>

      <a-card class="block">
        <a-descriptions :column="3" bordered>
          <a-descriptions-item label="发布教师">{{ task.teacher?.name ?? '—' }}</a-descriptions-item>
          <a-descriptions-item label="单人赏金">
            <span class="reward"><PointsNum :value="task.rewardPerPerson ?? 0" suffix="分" /></span>
          </a-descriptions-item>
          <a-descriptions-item label="名额">
            剩余 <b>{{ task.remaining ?? Math.max(0, task.headcount - task.filledCount) }}</b> / {{ task.headcount }}
          </a-descriptions-item>
          <a-descriptions-item label="截止时间" :span="2">
            {{ fmtTime(task.deadlineAt) }}
            <span class="deadline" :style="deadlineUrgent ? { color: 'var(--sasu-color-danger)' } : {}">
              （{{ remainingText(task.deadlineAt) }}）
            </span>
          </a-descriptions-item>
          <a-descriptions-item label="地点">{{ task.location || '不限' }}</a-descriptions-item>
          <a-descriptions-item label="任务描述" :span="3">
            <div class="pre-wrap">{{ task.description }}</div>
          </a-descriptions-item>
          <a-descriptions-item label="交付要求" :span="3">
            <div class="pre-wrap">{{ task.requirement || '无特别要求，以任务描述为准' }}</div>
          </a-descriptions-item>
          <a-descriptions-item v-if="task.contactInfo && myAssignment" label="联系方式" :span="3">
            {{ task.contactInfo }}
          </a-descriptions-item>
          <a-descriptions-item label="参考附件" :span="3">
            <template v-if="task.attachments && task.attachments.length > 0">
              <a-button
                v-for="att in task.attachments"
                :key="att.file.id"
                type="link"
                class="file-link"
                @click="downloadFile(att.file.id, att.file.originalName, att.file.mime)"
              >
                {{ att.file.originalName }}
              </a-button>
            </template>
            <span v-else class="muted">无</span>
          </a-descriptions-item>
        </a-descriptions>

        <div v-if="isStudent" class="actions">
          <a-button
            v-if="canClaim"
            type="primary"
            size="large"
            :loading="claiming"
            @click="onClaim"
          >
            接单
          </a-button>
          <a-button v-if="canWithdraw" @click="onWithdraw">取消接单</a-button>
          <a-button v-if="canSubmit && myAssignment" type="primary" @click="goExecution">去提交交付物</a-button>
          <a-button v-else-if="myAssignment" @click="goExecution">查看我的任务进度</a-button>
          <span v-if="canClaim" class="tip">接单后名额立即锁定，截止前取消不计违约</span>
        </div>
      </a-card>

      <a-card class="block">
        <template #title>
          <div class="card-header-row">
            <span>任务留言</span>
            <a-button v-if="auth.isLoggedIn" size="small" danger @click="onReport">举报任务</a-button>
          </div>
        </template>
        <div v-if="comments.length > 0" class="comment-list">
          <div v-for="c in comments" :key="c.id" class="comment-item">
            <div class="comment-head">
              <b>{{ c.author?.name ?? '匿名' }}</b>
              <a-tag>{{ roleLabel[c.author?.role] ?? c.author?.role }}</a-tag>
              <span class="time">{{ fmtTime(c.createdAt) }}</span>
            </div>
            <div class="comment-body pre-wrap">{{ c.content }}</div>
          </div>
        </div>
        <EmptyState v-else description="还没有留言" />
        <div v-if="auth.isLoggedIn" class="comment-input">
          <a-textarea
            v-model:value="commentText"
            :rows="3"
            :maxlength="500"
            show-count
            placeholder="留言仅任务参与者可发言（1-500 字）"
          />
          <a-button type="primary" :loading="posting" @click="postComment">发表留言</a-button>
        </div>
        <p v-else class="tip">登录后才能查看与发表留言</p>
      </a-card>
    </template>
    <EmptyState v-else-if="!loading" description="任务不存在或已下架">
      <a-button type="primary" @click="router.push('/tasks')">返回任务大厅</a-button>
    </EmptyState>
  </a-spin>
</template>

<style scoped>
.block {
  border-radius: var(--sasu-radius-base);
  box-shadow: var(--sasu-shadow-card);
  margin-bottom: 16px;
}
.detail-header {
  margin-bottom: 16px;
}
.detail-title-row {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
}
.detail-title {
  margin: 0 0 4px;
  font-size: 20px;
}
.detail-sub {
  display: flex;
  align-items: center;
  gap: 10px;
  color: var(--sasu-text-secondary);
  font-size: 13px;
}
.reward {
  color: var(--sasu-color-primary);
}
.deadline {
  font-size: 13px;
}
.pre-wrap {
  white-space: pre-wrap;
  word-break: break-word;
}
.actions {
  margin-top: 16px;
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
}
.tip {
  color: var(--sasu-text-secondary);
  font-size: 12px;
}
.muted {
  color: var(--sasu-text-secondary);
}
.file-link {
  margin-right: 12px;
  padding: 0;
}
.card-header-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.comment-list {
  margin-bottom: 12px;
}
.comment-item {
  padding: 10px 0;
  border-bottom: 1px solid var(--sasu-border);
}
.comment-item:last-child {
  border-bottom: none;
}
.comment-head {
  display: flex;
  align-items: center;
  gap: 8px;
}
.comment-head .time {
  color: var(--sasu-text-secondary);
  font-size: 12px;
  margin-left: auto;
}
.comment-body {
  margin-top: 4px;
  color: var(--sasu-text-primary);
}
.comment-input {
  margin-top: 12px;
  display: flex;
  gap: 12px;
  align-items: flex-start;
}
</style>
