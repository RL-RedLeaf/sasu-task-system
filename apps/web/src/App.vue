<script setup lang="ts">
// 应用外壳：顶部导航 + 路由出口。按角色分布局（Student/Teacher/AdminLayout）在 M1 落地。
</script>

<template>
  <el-container class="app-shell">
    <el-header class="app-header">
      <div class="app-brand">校园任务平台</div>
      <div class="app-nav-note">M0 脚手架 · 业务页面按里程碑交付</div>
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
}
.app-brand {
  font-size: 16px;
  font-weight: 600;
  color: var(--sasu-color-primary);
}
.app-nav-note {
  font-size: 12px;
  color: var(--sasu-text-secondary);
}
.app-main {
  max-width: 1200px;
  width: 100%;
  margin: 0 auto;
}
</style>
