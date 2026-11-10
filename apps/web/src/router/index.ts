import { createRouter, createWebHistory } from 'vue-router';

/**
 * 路由骨架（PRD §8.1–§8.3 的完整路由在 M1–M5 按页面清单补齐）。
 * 登录守卫 / 角色守卫（RBAC + 资源归属）由 M1 认证模块引入。
 */
const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/', name: 'home', component: () => import('@/pages/HomeView.vue') },
    { path: '/login', name: 'login', component: () => import('@/pages/LoginView.vue') },
    {
      path: '/403',
      name: 'forbidden',
      component: () => import('@/pages/ForbiddenView.vue'),
    },
    {
      path: '/:pathMatch(.*)*',
      name: 'not-found',
      component: () => import('@/pages/NotFoundView.vue'),
    },
  ],
});

export default router;
