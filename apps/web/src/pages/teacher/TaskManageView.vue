<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { confirm, message, prompt } from '@/composables/feedback';
import type { FormInstance } from 'ant-design-vue';
import type { Rule } from 'ant-design-vue/es/form';
import type { Dayjs } from 'dayjs';
import dayjs from 'dayjs';
import { categoriesApi, communityApi, type CategoryRow } from '@/api/admin';
import { submissionsApi, tasksApi, type AssignmentRow, type TaskSummary } from '@/api/tasks';
import { useAuthStore } from '@/stores/auth';
import type { NormalizedError } from '@/api/http';
import EmptyState from '@/components/EmptyState.vue';
import PageHeader from '@/components/PageHeader.vue';
import PointsNum from '@/components/PointsNum.vue';
import StatusTag from '@/components/StatusTag.vue';
import type { TableColumnsType } from 'ant-design-vue';

const HOUR = 3_600_000;
const DAY = 86_400_000;
const MAX_DAYS = 90;
const REJECT_MAX = 3;

const route = useRoute();
const router = useRouter();
const auth = useAuthStore();

const taskId = computed(() => String(route.params.id ?? ''));
/** detail 响应包含原始字段（categoryId 等），供编辑表单回填 */
type ManageTask = TaskSummary & { categoryId?: string | number };
const task = ref<ManageTask | null>(null);
const assignments = ref<AssignmentRow[]>([]);
const comments = ref<{ id: string; content: string; author: { name: string; role: string }; createdAt: string }[]>([]);
const loading = ref(false);
const categories = ref<CategoryRow[]>([]);

const now = ref(Date.now());
let timer: ReturnType<typeof setInterval> | null = null;

const roleLabel: Record<string, string> = { STUDENT: '学生', TEACHER: '教师', ADMIN: '管理员' };

const assignmentColumns: TableColumnsType = [
  { title: '学生', key: 'student', width: 120 },
  { title: '班级', key: 'className', width: 140 },
  { title: '状态', key: 'status', width: 100 },
  { title: '最新提交', key: 'version', width: 90, align: 'center' },
  { title: '驳回次数', key: 'rejectCount', width: 90, align: 'center' },
  { title: '接单时间', key: 'claimedAt', width: 170 },
  { title: '已得分', key: 'paid', width: 100, align: 'right' },
  { title: '操作', key: 'action', width: 170, fixed: 'right' },
];

/** 归属教师或管理员可操作（后端最终校验） */
const canOperate = computed(() => auth.role === 'TEACHER' || auth.role === 'ADMIN');
const editable = computed(() =>
  !!task.value && ['PENDING_REWARD', 'RECRUITING', 'FULL'].includes(task.value.status),
);
const canClose = computed(() => !!task.value && ['RECRUITING', 'FULL'].includes(task.value.status));
const canCancel = computed(() =>
  !!task.value && ['PENDING_REWARD', 'RECRUITING', 'FULL'].includes(task.value.status),
);

/** 是否已有学生接单（决定名额不可改、截止只能延后） */
const hasClaims = computed(() => {
  if (!task.value) return false;
  const active = assignments.value.some((a) =>
    ['CLAIMED', 'SUBMITTED', 'ACCEPTED', 'REJECTED', 'SETTLED'].includes(a.status),
  );
  return active || task.value.filledCount > 0;
});

const deadlineUrgent = computed(() => {
  const d = task.value?.deadlineAt;
  if (!d) return false;
  const diff = new Date(d).getTime() - now.value;
  return diff > 0 && diff < 24 * HOUR;
});

function fmtTime(v: string | null | undefined): string {
  return v ? new Date(v).toLocaleString('zh-CN') : '—';
}

async function load(): Promise<void> {
  loading.value = true;
  try {
    task.value = await tasksApi.detail(taskId.value);
    const [asg, cm] = await Promise.all([
      tasksApi.taskAssignments(taskId.value).catch(() => ({ items: [] as AssignmentRow[] })),
      communityApi.comments(taskId.value).catch(() => ({ items: [] })),
    ]);
    assignments.value = asg.items;
    comments.value = cm.items;
  } catch (e) {
    message.error((e as NormalizedError).friendlyMessage ?? '任务不存在或无权查看');
  } finally {
    loading.value = false;
  }
}

// ---------------- 编辑 ----------------

const editOpen = ref(false);
const editSaving = ref(false);
const editFormRef = ref<FormInstance>();
const editForm = reactive({
  title: '',
  categoryId: undefined as number | undefined,
  description: '',
  requirement: '',
  location: '',
  contactInfo: '',
  headcount: 1,
  deadlineAt: null as Dayjs | null,
});

const editRules = computed<Record<string, Rule[]>>(() => ({
  title: [
    { required: true, message: '请输入任务标题', trigger: 'blur' },
    { min: 2, max: 50, message: '标题需 2-50 字', trigger: 'blur' },
  ],
  categoryId: [{ required: true, message: '请选择分类', trigger: 'change' }],
  description: [
    { required: true, message: '请输入任务描述', trigger: 'blur' },
    { min: 10, max: 2000, message: '描述需 10-2000 字', trigger: 'blur' },
  ],
  headcount: [{ required: true, message: '请填写名额', trigger: 'change' }],
  deadlineAt: [
    { required: true, message: '请选择截止时间', trigger: 'change' },
    {
      validator: (_r, value: Dayjs | null, cb) => {
        if (!value) {
          cb();
          return;
        }
        const t = value.valueOf();
        const current = task.value ? new Date(task.value.deadlineAt).getTime() : Number.NaN;
        // 未修改截止时间（分钟粒度）：不做严格校验（后端只在字段变化时校验）
        if (Number.isFinite(current) && Math.floor(t / 60_000) === Math.floor(current / 60_000)) {
          cb();
          return;
        }
        if (t <= Date.now() + HOUR) cb('截止时间至少晚于当前 1 小时');
        else if (t > Date.now() + MAX_DAYS * DAY) cb(`截止时间最长不超过 ${MAX_DAYS} 天`);
        else if (hasClaims.value && Number.isFinite(current) && t < current) {
          cb('已有人接单，截止时间只能延后');
        } else cb();
      },
      trigger: 'change',
    },
  ],
}));

function openEdit(): void {
  const t = task.value;
  if (!t) return;
  editForm.title = t.title;
  editForm.categoryId = t.categoryId !== undefined && t.categoryId !== null ? Number(t.categoryId) : undefined;
  editForm.description = t.description;
  editForm.requirement = t.requirement ?? '';
  editForm.location = t.location ?? '';
  editForm.contactInfo = t.contactInfo ?? '';
  editForm.headcount = t.headcount;
  editForm.deadlineAt = dayjs(t.deadlineAt);
  editOpen.value = true;
}

async function onSaveEdit(): Promise<void> {
  await editFormRef.value?.validate();
  const t = task.value;
  if (!t) return;
  editSaving.value = true;
  try {
    // 只提交有变化的字段；version 恒传（乐观锁）
    const body: Record<string, unknown> = { version: t.version };
    if (editForm.title.trim() !== t.title) body.title = editForm.title.trim();
    if (editForm.categoryId !== undefined && Number(editForm.categoryId) !== Number(t.categoryId)) {
      body.categoryId = editForm.categoryId;
    }
    if (editForm.description.trim() !== t.description) body.description = editForm.description.trim();
    if ((editForm.requirement.trim() || '') !== (t.requirement ?? '')) body.requirement = editForm.requirement.trim();
    if ((editForm.location.trim() || '') !== (t.location ?? '')) body.location = editForm.location.trim();
    if ((editForm.contactInfo.trim() || '') !== (t.contactInfo ?? '')) body.contactInfo = editForm.contactInfo.trim();
    if (!hasClaims.value && editForm.headcount !== t.headcount) body.headcount = editForm.headcount;
    if (editForm.deadlineAt) {
      const nextMs = editForm.deadlineAt.valueOf();
      const currentMs = new Date(t.deadlineAt).getTime();
      if (Math.floor(nextMs / 60_000) !== Math.floor(currentMs / 60_000)) {
        body.deadlineAt = new Date(nextMs).toISOString();
      }
    }
    const res = await tasksApi.edit(taskId.value, body);
    if (res.changed === 0) {
      message.info('没有修改任何字段');
    } else {
      message.success('任务已更新');
    }
    editOpen.value = false;
    await load();
  } catch (e) {
    message.error((e as NormalizedError).friendlyMessage ?? '保存失败');
  } finally {
    editSaving.value = false;
  }
}

// ---------------- 验收 / 驳回 ----------------

async function onAccept(row: AssignmentRow): Promise<void> {
  try {
    await confirm({
      title: '验收通过',
      content: `确认通过「${row.student?.name ?? '该学生'}」的交付物？通过后积分将立即发放，不可撤销。`,
      okText: '确认通过',
    });
  } catch {
    return;
  }
  try {
    await submissionsApi.review(row.id, 'ACCEPT');
    message.success('已验收通过，积分已发放');
    await load();
  } catch (e) {
    message.error((e as NormalizedError).friendlyMessage ?? '操作失败');
  }
}

async function onReject(row: AssignmentRow): Promise<void> {
  let reason: string;
  try {
    reason = (
      await prompt({
        title: `驳回「${row.student?.name ?? '该学生'}」的交付物`,
        message: `驳回后学生需在重交窗口内重新提交（该接单已驳回 ${row.rejectCount}/${REJECT_MAX} 次，超过 ${REJECT_MAX} 次只能通过或转仲裁）。`,
        placeholder: '请填写驳回理由（5-200 字）',
        validate: (v: string) => {
          const n = (v ?? '').trim().length;
          if (n < 5) return '理由至少 5 字';
          if (n > 200) return '理由最多 200 字';
          return true;
        },
      })
    ).trim();
  } catch {
    return;
  }
  try {
    await submissionsApi.review(row.id, 'REJECT', reason);
    message.success('已驳回，学生将收到通知');
    await load();
  } catch (e) {
    message.error((e as NormalizedError).friendlyMessage ?? '操作失败');
  }
}

// ---------------- 关闭 / 取消 ----------------

async function onClose(): Promise<void> {
  let reason: string;
  try {
    reason = (
      await prompt({
        title: '关闭任务',
        message: '关闭后停止接单：进行中的接单将不计违约，剩余托管积分退回积分池（提交待验收的保留）。确认关闭？',
        placeholder: '请填写关闭原因（必填）',
        validate: (v: string) => ((v ?? '').trim().length >= 2 ? true : '关闭原因至少 2 字'),
      })
    ).trim();
  } catch {
    return;
  }
  try {
    await tasksApi.close(taskId.value, reason);
    message.success('任务已关闭');
    await load();
  } catch (e) {
    message.error((e as NormalizedError).friendlyMessage ?? '操作失败');
  }
}

async function onCancel(): Promise<void> {
  let reason: string;
  try {
    reason = (
      await prompt({
        title: '取消任务',
        message: '取消为终态且立即退款；仅当任务没有待验收（SUBMITTED）的提交时可用。确认取消？',
        placeholder: '请填写取消原因（必填）',
        validate: (v: string) => ((v ?? '').trim().length >= 2 ? true : '取消原因至少 2 字'),
      })
    ).trim();
  } catch {
    return;
  }
  try {
    await tasksApi.cancel(taskId.value, reason);
    message.success('任务已取消，托管积分已退回');
    await load();
  } catch (e) {
    message.error((e as NormalizedError).friendlyMessage ?? '操作失败');
  }
}

// ---------------- 留言 ----------------

const commentText = ref('');
const posting = ref(false);

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
    message.error((e as NormalizedError).friendlyMessage ?? '留言失败');
  } finally {
    posting.value = false;
  }
}

function disabledDate(d: Dayjs): boolean {
  return d.valueOf() < Date.now() + HOUR - DAY || d.valueOf() > Date.now() + MAX_DAYS * DAY;
}

onMounted(() => {
  timer = setInterval(() => {
    now.value = Date.now();
  }, 30_000);
  void load();
  categoriesApi
    .list()
    .then((r) => {
      categories.value = r.items;
    })
    .catch(() => {
      // 编辑对话框分类加载失败不阻塞页面
    });
});
onBeforeUnmount(() => {
  if (timer) clearInterval(timer);
});
</script>

<template>
  <a-spin :spinning="loading">
    <template v-if="task">
      <PageHeader :title="task.title" subtitle="任务管理：编辑信息、验收交付物、关闭或取消任务" />

      <!-- ① 任务信息 -->
      <a-card class="block">
        <template #title>
          <div class="card-header-row">
            <div class="head-left">
              <span>任务信息</span>
              <StatusTag :status="task.status" />
            </div>
            <div class="head-ops">
              <a-button v-if="editable && canOperate" size="small" @click="openEdit">编辑</a-button>
              <a-button v-if="canClose && canOperate" size="small" @click="onClose">关闭任务</a-button>
              <a-button v-if="canCancel && canOperate" size="small" danger @click="onCancel">取消任务</a-button>
            </div>
          </div>
        </template>
        <a-descriptions :column="3" bordered>
          <a-descriptions-item label="分类">{{ task.category?.name ?? '—' }}</a-descriptions-item>
          <a-descriptions-item label="单人赏金">
            <span v-if="task.rewardPerPerson !== null" class="reward">
              <PointsNum :value="task.rewardPerPerson ?? 0" suffix="分" />
            </span>
            <span v-else class="muted">待管理员定价</span>
          </a-descriptions-item>
          <a-descriptions-item label="名额">{{ task.filledCount }} / {{ task.headcount }}</a-descriptions-item>
          <a-descriptions-item label="截止时间" :span="2">
            {{ fmtTime(task.deadlineAt) }}
            <span :style="deadlineUrgent ? { color: 'var(--sasu-color-danger)' } : {}">
              {{ new Date(task.deadlineAt).getTime() > now ? '（未截止）' : '（已截止）' }}
            </span>
          </a-descriptions-item>
          <a-descriptions-item label="发布时间">{{ fmtTime(task.createdAt) }}</a-descriptions-item>
          <a-descriptions-item label="任务描述" :span="3">
            <div class="pre-wrap">{{ task.description }}</div>
          </a-descriptions-item>
          <a-descriptions-item label="交付要求" :span="3">
            <div class="pre-wrap">{{ task.requirement || '无' }}</div>
          </a-descriptions-item>
          <a-descriptions-item label="地点">{{ task.location || '不限' }}</a-descriptions-item>
          <a-descriptions-item label="联系方式" :span="2">{{ task.contactInfo || '未填写' }}</a-descriptions-item>
        </a-descriptions>
        <p class="tip">
          已有人接单时：名额不可修改、截止时间只能延后；「已截止/已完成/已取消」状态不可编辑。
        </p>
      </a-card>

      <!-- ② 接单学生 -->
      <a-card class="block" title="接单学生与验收">
        <div v-if="assignments.length > 0">
          <a-table :columns="assignmentColumns" :data-source="assignments" :pagination="false" row-key="id" :scroll="{ x: 900 }">
            <template #bodyCell="{ column, record }">
              <template v-if="column.key === 'student'">{{ record.student?.name ?? '—' }}</template>
              <template v-else-if="column.key === 'className'">{{ record.student?.className || '—' }}</template>
              <template v-else-if="column.key === 'status'"><StatusTag :status="record.status" /></template>
              <template v-else-if="column.key === 'version'">
                <span v-if="record.submissions && record.submissions.length > 0">v{{ record.submissions[0]?.version }}</span>
                <span v-else class="muted">未提交</span>
              </template>
              <template v-else-if="column.key === 'rejectCount'">{{ record.rejectCount }}/{{ REJECT_MAX }}</template>
              <template v-else-if="column.key === 'claimedAt'">{{ fmtTime(record.claimedAt) }}</template>
              <template v-else-if="column.key === 'paid'">
                <PointsNum class="num" :value="(record.basePaid ?? 0) + (record.bonusPaid ?? 0)" suffix="分" />
              </template>
              <template v-else-if="column.key === 'action'">
                <template v-if="record.status === 'SUBMITTED'">
                  <a-button size="small" type="primary" ghost @click="onAccept(record as AssignmentRow)">验收通过</a-button>
                  <a-button size="small" danger ghost class="btn-gap" @click="onReject(record as AssignmentRow)">驳回</a-button>
                </template>
                <span v-else class="muted">—</span>
              </template>
            </template>
          </a-table>
          <p class="tip">验收通过即从托管发放积分；驳回必填理由（5-200 字），每笔接单最多驳回 {{ REJECT_MAX }} 次。</p>
        </div>
        <EmptyState v-else description="还没有学生接单" />
      </a-card>

      <!-- 留言区 -->
      <a-card class="block" title="任务留言">
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
        <div v-if="canOperate" class="comment-input">
          <a-textarea
            v-model:value="commentText"
            :rows="3"
            :maxlength="500"
            show-count
            placeholder="与学生沟通任务细节（1-500 字）"
          />
          <a-button type="primary" :loading="posting" @click="postComment">发表留言</a-button>
        </div>
      </a-card>

      <!-- 编辑对话框 -->
      <a-modal v-model:open="editOpen" title="编辑任务" :width="640">
        <a-form ref="editFormRef" :model="editForm" :rules="editRules" layout="vertical" @submit.prevent="onSaveEdit">
          <a-form-item label="任务标题（2-50 字）" name="title">
            <a-input v-model:value="editForm.title" :maxlength="50" show-count />
          </a-form-item>
          <a-form-item label="分类" name="categoryId">
            <a-select
              v-model:value="editForm.categoryId"
              show-search
              option-filter-prop="label"
              class="w-select"
              :options="categories.map((c) => ({ label: c.name, value: Number(c.id) }))"
            />
          </a-form-item>
          <a-form-item label="任务描述（10-2000 字）" name="description">
            <a-textarea v-model:value="editForm.description" :rows="5" :maxlength="2000" show-count />
          </a-form-item>
          <a-form-item label="交付要求（选填，500 字以内）" name="requirement">
            <a-textarea v-model:value="editForm.requirement" :rows="3" :maxlength="500" show-count />
          </a-form-item>
          <a-row :gutter="16">
            <a-col :span="10">
              <a-form-item label="名额" name="headcount">
                <a-input-number
                  v-model:value="editForm.headcount"
                  :min="1"
                  :max="50"
                  :precision="0"
                  :disabled="hasClaims"
                  class="w-number"
                />
                <div v-if="hasClaims" class="field-tip">已有人接单，名额不可修改</div>
              </a-form-item>
            </a-col>
            <a-col :span="14">
              <a-form-item label="截止时间" name="deadlineAt">
                <a-date-picker
                  v-model:value="editForm.deadlineAt"
                  show-time
                  format="YYYY-MM-DD HH:mm"
                  :disabled-date="disabledDate"
                  class="w-picker"
                />
                <div v-if="hasClaims" class="field-tip">已有人接单，截止时间只能延后</div>
              </a-form-item>
            </a-col>
          </a-row>
          <a-row :gutter="16">
            <a-col :span="12">
              <a-form-item label="地点（选填）" name="location">
                <a-input v-model:value="editForm.location" :maxlength="100" show-count />
              </a-form-item>
            </a-col>
            <a-col :span="12">
              <a-form-item label="联系方式（选填）" name="contactInfo">
                <a-input v-model:value="editForm.contactInfo" :maxlength="200" show-count />
              </a-form-item>
            </a-col>
          </a-row>
        </a-form>
        <template #footer>
          <a-button @click="editOpen = false">取消</a-button>
          <a-button type="primary" :loading="editSaving" @click="onSaveEdit">保存</a-button>
        </template>
      </a-modal>
    </template>
    <EmptyState v-else-if="!loading" description="任务不存在或无权查看">
      <a-button type="primary" @click="router.push('/teacher/tasks')">返回我的任务</a-button>
    </EmptyState>
  </a-spin>
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
.head-left {
  display: flex;
  align-items: center;
  gap: 10px;
}
.head-ops {
  display: flex;
  gap: 8px;
}
.reward {
  color: var(--sasu-color-primary);
}
.muted {
  color: var(--sasu-text-secondary);
}
.pre-wrap {
  white-space: pre-wrap;
  word-break: break-word;
}
.tip {
  margin-top: 10px;
  margin-bottom: 0;
  color: var(--sasu-text-secondary);
  font-size: 12px;
}
.field-tip {
  color: var(--sasu-text-secondary);
  font-size: 12px;
  margin-top: 4px;
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
}
.comment-input {
  margin-top: 12px;
  display: flex;
  gap: 12px;
  align-items: flex-start;
}
.btn-gap {
  margin-left: 8px;
}
.w-select {
  width: 280px;
}
.w-number {
  width: 140px;
}
.w-picker {
  width: 100%;
}
</style>
