<script setup lang="ts">
import { useAuthStore } from '@/stores/auth';

const auth = useAuthStore();
</script>

<template>
  <el-card class="home-card" shadow="never">
    <template #header>
      <span>校园任务平台</span>
    </template>
    <p>老师发任务，学生接任务，学校用积分结算。</p>
    <p class="tip">
      M0 脚手架已就绪：主题主色、路由骨架、Pinia、按需 Element Plus。 登录与业务页面按里程碑 M1–M5
      交付。
    </p>
    <el-button type="primary" @click="() => auth.clear()">示例主按钮（#B4232A）</el-button>
  </el-card>
</template>

<style scoped>
.home-card {
  border-radius: var(--sasu-radius-base);
  box-shadow: var(--sasu-shadow-card);
}
.tip {
  color: var(--sasu-text-secondary);
}
</style>
