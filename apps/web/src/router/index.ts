import { createRouter, createWebHistory } from 'vue-router';
import { useAuthStore } from '@/stores/auth';
import type { Role } from '@sasu/shared';

/**
 * 全量路由（PRD §8）：meta.roles 缺省 = 登录即可；students/teachers/admin 分别限定。
 * 首登强制改密由 /change-password 页 + 守卫处理。
 */
const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/login', name: 'login', component: () => import('@/pages/LoginView.vue'), meta: { public: true } },
    { path: '/change-password', name: 'change-password', component: () => import('@/pages/ChangePasswordView.vue'), meta: { public: false } },
    { path: '/', name: 'home', component: () => import('@/pages/HomeView.vue') },

    // 学生 + 公共
    { path: '/tasks', name: 'hall', component: () => import('@/pages/student/TaskHallView.vue') },
    { path: '/tasks/:id', name: 'task-detail', component: () => import('@/pages/student/TaskDetailView.vue') },
    { path: '/my/tasks', name: 'my-tasks', component: () => import('@/pages/student/MyTasksView.vue') },
    { path: '/my/tasks/:assignmentId', name: 'task-exec', component: () => import('@/pages/student/TaskExecutionView.vue') },
    { path: '/points', name: 'points', component: () => import('@/pages/student/PointsView.vue') },
    { path: '/withdraw', name: 'withdraw', component: () => import('@/pages/student/WithdrawView.vue') },
    { path: '/my/disputes', name: 'my-disputes', component: () => import('@/pages/student/MyDisputesView.vue') },
    { path: '/notifications', name: 'notifications', component: () => import('@/pages/NotificationsView.vue') },
    { path: '/profile', name: 'profile', component: () => import('@/pages/ProfileView.vue') },

    // 教师端
    { path: '/tasks/new', name: 'task-new', component: () => import('@/pages/teacher/TaskNewView.vue'), meta: { roles: ['TEACHER', 'ADMIN'] } },
    { path: '/teacher/tasks', name: 'teacher-tasks', component: () => import('@/pages/teacher/TeacherTasksView.vue'), meta: { roles: ['TEACHER', 'ADMIN'] } },
    { path: '/teacher/tasks/:id', name: 'teacher-task', component: () => import('@/pages/teacher/TaskManageView.vue'), meta: { roles: ['TEACHER', 'ADMIN'] } },

    // 管理端
    { path: '/admin', name: 'admin-dashboard', component: () => import('@/pages/admin/DashboardView.vue'), meta: { roles: ['ADMIN'] } },
    { path: '/admin/users', name: 'admin-users', component: () => import('@/pages/admin/UsersView.vue'), meta: { roles: ['ADMIN'] } },
    { path: '/admin/categories', name: 'admin-categories', component: () => import('@/pages/admin/CategoriesView.vue'), meta: { roles: ['ADMIN'] } },
    { path: '/admin/tasks', name: 'admin-tasks', component: () => import('@/pages/admin/TasksView.vue'), meta: { roles: ['ADMIN'] } },
    { path: '/admin/points', name: 'admin-points', component: () => import('@/pages/admin/PointsView.vue'), meta: { roles: ['ADMIN'] } },
    { path: '/admin/withdrawals', name: 'admin-withdrawals', component: () => import('@/pages/admin/WithdrawalsView.vue'), meta: { roles: ['ADMIN'] } },
    { path: '/admin/disputes', name: 'admin-disputes', component: () => import('@/pages/admin/DisputesView.vue'), meta: { roles: ['ADMIN'] } },
    { path: '/admin/reports', name: 'admin-reports', component: () => import('@/pages/admin/ReportsView.vue'), meta: { roles: ['ADMIN'] } },
    { path: '/admin/announcements', name: 'admin-announcements', component: () => import('@/pages/admin/AnnouncementsView.vue'), meta: { roles: ['ADMIN'] } },
    { path: '/admin/settings', name: 'admin-settings', component: () => import('@/pages/admin/SettingsView.vue'), meta: { roles: ['ADMIN'] } },
    { path: '/admin/audit', name: 'admin-audit', component: () => import('@/pages/admin/AuditView.vue'), meta: { roles: ['ADMIN'] } },
    { path: '/admin/stats', name: 'admin-stats', component: () => import('@/pages/admin/StatsView.vue'), meta: { roles: ['ADMIN'] } },

    { path: '/403', name: 'forbidden', component: () => import('@/pages/ForbiddenView.vue'), meta: { public: true } },
    { path: '/:pathMatch(.*)*', name: 'not-found', component: () => import('@/pages/NotFoundView.vue'), meta: { public: true } },
  ],
});

router.beforeEach(async (to) => {
  const auth = useAuthStore();
  if (!auth.loaded) await auth.fetchMe();

  if (to.meta.public) {
    if (to.name === 'login' && auth.isLoggedIn && !auth.mustChangePassword) return { name: 'home' };
    return true;
  }
  if (!auth.isLoggedIn) {
    return { name: 'login', query: { redirect: to.fullPath } };
  }
  // 首登强制改密：仅放行改密页（后端同样拦截，PRD AUTH-02）
  if (auth.mustChangePassword && to.name !== 'change-password' && to.name !== 'profile') {
    return { name: 'change-password' };
  }
  const roles = to.meta.roles as Role[] | undefined;
  if (roles && auth.role && !roles.includes(auth.role)) {
    return { name: 'forbidden' };
  }
  return true;
});

export default router;
