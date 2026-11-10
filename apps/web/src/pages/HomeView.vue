<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { ArrowRightOutlined } from '@ant-design/icons-vue';
import { communityApi } from '@/api/admin';
import { pointsApi } from '@/api/points';
import { useAuthStore } from '@/stores/auth';
import PageHeader from '@/components/PageHeader.vue';
import PointsNum from '@/components/PointsNum.vue';

const auth = useAuthStore();
const router = useRouter();
const announcements = ref<{ id: string; title: string; content: string; publishedAt: string | null }[]>([]);
const points = ref<{ balance: number; frozen: number; penaltyDebt: number } | null>(null);

const isStudent = computed(() => auth.role === 'STUDENT');
const isTeacher = computed(() => auth.role === 'TEACHER' || auth.role === 'ADMIN');
const isAdmin = computed(() => auth.role === 'ADMIN');

const todos = computed(() => {
  if (isAdmin.value) {
    return [
      { label: '待定价任务与积分池', to: '/admin/tasks' },
      { label: '待审批提现', to: '/admin/withdrawals' },
      { label: '待处理仲裁', to: '/admin/disputes' },
      { label: '系统配置与对账', to: '/admin/settings' },
    ];
  }
  if (isTeacher.value) {
    return [
      { label: '发布新任务', to: '/tasks/new' },
      { label: '管理我的任务（验收/驳回）', to: '/teacher/tasks' },
    ];
  }
  return [
    { label: '去任务大厅逛逛', to: '/tasks' },
    { label: '查看我的任务', to: '/my/tasks' },
    { label: '我的积分', to: '/points' },
  ];
});

onMounted(async () => {
  communityApi.announcements().then((r) => (announcements.value = r.items)).catch(() => undefined);
  if (isStudent.value) {
    pointsApi.me().then((r) => (points.value = r)).catch(() => undefined);
  }
});
</script>

<template>
  <PageHeader title="首页" :subtitle="`你好，${auth.user?.name ?? ''}`" />
  <a-row :gutter="16">
    <a-col :span="isStudent ? 16 : 24">
      <a-card class="block" title="公告">
        <template v-if="announcements.length">
          <div v-for="a in announcements" :key="a.id" class="announce">
            <div class="announce-title">{{ a.title }}</div>
            <div class="announce-content">{{ a.content }}</div>
            <div class="announce-date">{{ a.publishedAt?.slice(0, 10) }}</div>
          </div>
        </template>
        <span v-else class="muted">暂无公告</span>
      </a-card>
    </a-col>
    <a-col v-if="isStudent" :span="8">
      <a-card class="block" title="我的积分">
        <div class="point-line">
          <span>可用余额</span>
          <PointsNum :value="points?.balance ?? 0" suffix="分" />
        </div>
        <div class="point-line">
          <span>冻结中</span>
          <PointsNum :value="points?.frozen ?? 0" suffix="分" />
        </div>
        <div v-if="(points?.penaltyDebt ?? 0) > 0" class="point-line warn">
          <span>欠分</span>
          <PointsNum :value="points?.penaltyDebt ?? 0" suffix="分" />
        </div>
      </a-card>
    </a-col>
  </a-row>
  <a-card class="block" title="我的待办">
    <ul class="todo-list">
      <li v-for="t in todos" :key="t.to" class="todo-item" @click="router.push(t.to)">
        <span class="todo-label">{{ t.label }}</span>
        <ArrowRightOutlined class="todo-arrow" />
      </li>
    </ul>
  </a-card>
</template>

<style scoped>
.block {
  margin-bottom: 16px;
  border-radius: var(--sasu-radius-base);
  box-shadow: var(--sasu-shadow-card);
}
.announce {
  padding: 8px 0;
  border-bottom: 1px dashed var(--sasu-border);
}
.announce:last-child {
  border-bottom: none;
}
.announce-title {
  font-weight: 600;
}
.announce-content {
  color: var(--sasu-text-secondary);
  font-size: 13px;
  white-space: pre-wrap;
}
.announce-date {
  font-size: 12px;
  color: var(--sasu-text-secondary);
}
.point-line {
  display: flex;
  justify-content: space-between;
  padding: 6px 0;
}
.point-line.warn {
  color: var(--sasu-color-danger);
}
.todo-list {
  list-style: none;
  margin: 0;
  padding: 0;
}
.todo-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 8px;
  border-bottom: 1px solid var(--sasu-border);
  border-radius: 6px;
  cursor: pointer;
  color: var(--sasu-text-primary);
  font-size: 14px;
  transition: background 0.15s ease;
}
.todo-item:last-child {
  border-bottom: none;
}
.todo-item:hover {
  background: var(--sasu-color-primary-light-bg);
  color: var(--sasu-color-primary);
}
.todo-arrow {
  color: var(--sasu-text-secondary);
}
.muted {
  color: var(--sasu-text-secondary);
}
</style>
