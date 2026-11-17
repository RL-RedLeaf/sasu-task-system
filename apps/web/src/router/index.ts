import { createRouter, createWebHistory } from 'vue-router';
import { useAuthStore } from '@/stores/auth';
import type { Role } from '@sasu/shared';

/**
 * 全量路由（PRD §8）：meta.roles 缺省 = 登录即可；students/teachers/admin 分别限定。
 * 首登强制改密由 /change-password 页 + 守卫处理。
 * 布局壳：学生/公共页挂 TopNavShell（顶部导航），管理/教师页挂 AdminShell（侧边栏），
 * 登录与 404/403 独立成页；meta.title 供 AdminShell 顶栏显示。
 */
const router = createRouter({
  history: createWebHistory(),
  // 浏览器前进/后退保留滚动位置；新导航回到顶部
  scrollBehavior: (_to, _from, savedPosition) => savedPosition ?? { top: 0 },
  routes: [
    { path: '/login', name: 'login', component: () => import('@/pages/LoginView.vue'), meta: { public: true } },
    { path: '/403', name: 'forbidden', component: () => import('@/pages/ForbiddenView.vue'), meta: { public: true } },

    // ---- 学生 + 公共（顶部导航壳） ----
    {
      path: '/',
      component: () => import('@/layouts/TopNavShell.vue'),
      children: [
        { path: '', name: 'home', component: () => import('@/pages/HomeView.vue') },
        { path: '/tasks', name: 'hall', component: () => import('@/pages/student/TaskHallView.vue') },
        { path: '/tasks/:id', name: 'task-detail', component: () => import('@/pages/student/TaskDetailView.vue') },
        { path: '/my/tasks', name: 'my-tasks', component: () => import('@/pages/student/MyTasksView.vue') },
        { path: '/my/tasks/:assignmentId', name: 'task-exec', component: () => import('@/pages/student/TaskExecutionView.vue') },
        { path: '/points', name: 'points', component: () => import('@/pages/student/PointsView.vue') },
        { path: '/withdraw', name: 'withdraw', component: () => import('@/pages/student/WithdrawView.vue') },
        { path: '/my/disputes', name: 'my-disputes', component: () => import('@/pages/student/MyDisputesView.vue') },
        { path: '/notifications', name: 'notifications', component: () => import('@/pages/NotificationsView.vue') },
        { path: '/profile', name: 'profile', component: () => import('@/pages/ProfileView.vue') },
        { path: '/change-password', name: 'change-password', component: () => import('@/pages/ChangePasswordView.vue') },
      ],
    },

    // ---- 管理 / 教师端（侧边栏壳） ----
    {
      path: '/',
      component: () => import('@/layouts/AdminShell.vue'),
      children: [
        // 教师端
        { path: '/tasks/new', name: 'task-new', component: () => import('@/pages/teacher/TaskNewView.vue'), meta: { roles: ['TEACHER', 'ADMIN'], title: '发布任务' } },
        { path: '/teacher/tasks', name: 'teacher-tasks', component: () => import('@/pages/teacher/TeacherTasksView.vue'), meta: { roles: ['TEACHER', 'ADMIN'], title: '我的任务' } },
        { path: '/teacher/tasks/:id', name: 'teacher-task', component: () => import('@/pages/teacher/TaskManageView.vue'), meta: { roles: ['TEACHER', 'ADMIN'], title: '任务管理' } },
        // 管理端
        { path: '/admin', name: 'admin-dashboard', component: () => import('@/pages/admin/DashboardView.vue'), meta: { roles: ['ADMIN'], title: '工作台' } },
        { path: '/admin/users', name: 'admin-users', component: () => import('@/pages/admin/UsersView.vue'), meta: { roles: ['ADMIN'], title: '用户管理' } },
        { path: '/admin/categories', name: 'admin-categories', component: () => import('@/pages/admin/CategoriesView.vue'), meta: { roles: ['ADMIN'], title: '任务分类' } },
        { path: '/admin/tasks', name: 'admin-tasks', component: () => import('@/pages/admin/TasksView.vue'), meta: { roles: ['ADMIN'], title: '任务定价' } },
        { path: '/admin/points', name: 'admin-points', component: () => import('@/pages/admin/PointsView.vue'), meta: { roles: ['ADMIN'], title: '积分池管理' } },
        { path: '/admin/withdrawals', name: 'admin-withdrawals', component: () => import('@/pages/admin/WithdrawalsView.vue'), meta: { roles: ['ADMIN'], title: '提现审批' } },
        { path: '/admin/disputes', name: 'admin-disputes', component: () => import('@/pages/admin/DisputesView.vue'), meta: { roles: ['ADMIN'], title: '仲裁处理' } },
        { path: '/admin/reports', name: 'admin-reports', component: () => import('@/pages/admin/ReportsView.vue'), meta: { roles: ['ADMIN'], title: '举报处理' } },
        { path: '/admin/announcements', name: 'admin-announcements', component: () => import('@/pages/admin/AnnouncementsView.vue'), meta: { roles: ['ADMIN'], title: '公告管理' } },
        { path: '/admin/settings', name: 'admin-settings', component: () => import('@/pages/admin/SettingsView.vue'), meta: { roles: ['ADMIN'], title: '系统参数' } },
        { path: '/admin/audit', name: 'admin-audit', component: () => import('@/pages/admin/AuditView.vue'), meta: { roles: ['ADMIN'], title: '审计日志' } },
        { path: '/admin/stats', name: 'admin-stats', component: () => import('@/pages/admin/StatsView.vue'), meta: { roles: ['ADMIN'], title: '平台统计' } },
      ],
    },

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
  // 管理员的"首页"即管理控制台（公共首页仅学生/游客视角，避免管理员被落在无侧边栏的通用页）
  if (to.name === 'home' && auth.role === 'ADMIN') {
    return { name: 'admin-dashboard' };
  }
  const roles = to.meta.roles as Role[] | undefined;
  if (roles && auth.role && !roles.includes(auth.role)) {
    return { name: 'forbidden' };
  }
  return true;
});

export default router;
