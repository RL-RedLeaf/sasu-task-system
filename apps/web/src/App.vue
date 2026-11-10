<script setup lang="ts">
import { computed } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { ElMessage } from 'element-plus';
import { useAuthStore } from '@/stores/auth';
import { useNotificationStore } from '@/stores/notification';
import type { Role } from '@sasu/shared';

const auth = useAuthStore();
const notify = useNotificationStore();
const route = useRoute();
const router = useRouter();

const isStudent = computed(() => auth.role === 'STUDENT');
const isTeacher = computed(() => auth.role === 'TEACHER' || auth.role === 'ADMIN');
const isAdmin = computed(() => auth.role === 'ADMIN');

const roleLabel: Record<string, string> = { STUDENT: '学生', TEACHER: '教师', ADMIN: '管理员' };

function isActive(name: string): boolean {
  return route.name === name;
}

async function onLogout(): Promise<void> {
  await auth.logout();
  notify.stopPolling();
  ElMessage.success('已退出登录');
  void router.push('/login');
}

if (auth.isLoggedIn) notify.startPolling();
</script>

<template>
  <el-container class="app-shell">
    <el-header class="app-header">
      <div class="header-left">
        <div class="app-brand" @click="router.push('/')">校园任务平台</div>
        <nav class="app-nav">
          <RouterLink class="nav-item" :class="{ active: isActive('home') }" to="/">首页</RouterLink>
          <RouterLink class="nav-item" :class="{ active: isActive('hall') }" to="/tasks">任务大厅</RouterLink>
          <RouterLink
            v-if="isStudent"
            class="nav-item"
            :class="{ active: isActive('my-tasks') }"
            to="/my/tasks"
          >
            我的任务
          </RouterLink>
          <RouterLink
            v-if="isStudent"
            class="nav-item"
            :class="{ active: isActive('points') }"
            to="/points"
          >
            我的积分
          </RouterLink>
          <RouterLink
            v-if="isTeacher"
            class="nav-item"
            :class="{ active: isActive('teacher-tasks') }"
            to="/teacher/tasks"
          >
            任务管理
          </RouterLink>
          <RouterLink v-if="isTeacher" class="nav-item" to="/tasks/new">发布任务</RouterLink>
          <template v-if="isAdmin">
            <RouterLink class="nav-item" :class="{ active: isActive('admin-dashboard') }" to="/admin">仪表盘</RouterLink>
            <RouterLink class="nav-item" to="/admin/users">用户</RouterLink>
            <RouterLink class="nav-item" to="/admin/tasks">任务定价</RouterLink>
            <RouterLink class="nav-item" to="/admin/points">积分池</RouterLink>
            <RouterLink class="nav-item" to="/admin/withdrawals">提现</RouterLink>
            <RouterLink class="nav-item" to="/admin/disputes">仲裁</RouterLink>
            <RouterLink class="nav-item" to="/admin/settings">配置</RouterLink>
          </template>
        </nav>
      </div>
      <div class="header-right">
        <el-badge :value="notify.unread" :hidden="notify.unread === 0" class="bell">
          <RouterLink to="/notifications" class="bell-link" aria-label="通知">铃</RouterLink>
        </el-badge>
        <el-dropdown v-if="auth.user">
          <span class="user-chip">
            {{ auth.user.name }}（{{ roleLabel[auth.user.role] ?? auth.user.role }}）
          </span>
          <template #dropdown>
            <el-dropdown-menu>
              <el-dropdown-item @click="router.push('/profile')">个人中心</el-dropdown-item>
              <el-dropdown-item divided @click="onLogout">退出登录</el-dropdown-item>
            </el-dropdown-menu>
          </template>
        </el-dropdown>
        <el-button v-else type="primary" size="small" @click="router.push('/login')">登录</el-button>
      </div>
    </el-header>
    <el-main class="app-main">
      <RouterView />
    </el-main>
  </el-container>
</template>

<style scoped>
.app-shell {
  min-height: 100%;
}
.app-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  background: var(--sasu-bg-card);
  border-bottom: 1px solid var(--sasu-border);
  position: sticky;
  top: 0;
  z-index: 10;
}
.header-left {
  display: flex;
  align-items: center;
  gap: 24px;
}
.app-brand {
  font-size: 16px;
  font-weight: 600;
  color: var(--sasu-color-primary);
  cursor: pointer;
  white-space: nowrap;
}
.app-nav {
  display: flex;
  align-items: center;
  gap: 4px;
  flex-wrap: wrap;
}
.nav-item {
  padding: 6px 12px;
  border-radius: 6px;
  color: var(--sasu-text-primary);
  text-decoration: none;
  font-size: 14px;
}
.nav-item:hover {
  background: var(--sasu-color-primary-light-bg);
}
.nav-item.active {
  color: var(--sasu-color-primary);
  font-weight: 600;
}
.header-right {
  display: flex;
  align-items: center;
  gap: 16px;
}
.bell-link {
  text-decoration: none;
  color: var(--sasu-text-secondary);
  font-size: 16px;
}
.user-chip {
  cursor: pointer;
  color: var(--sasu-text-primary);
  font-size: 14px;
}
.app-main {
  max-width: 1200px;
  width: 100%;
  margin: 0 auto;
}
</style>
