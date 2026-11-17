<script setup lang="ts">
import { reactive, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { message } from '@/composables/feedback';
import type { FormInstance } from 'ant-design-vue';
import type { Rule } from 'ant-design-vue/es/form';
import { useAuthStore } from '@/stores/auth';
import { NormalizedError } from '@/api/http';

const auth = useAuthStore();
const route = useRoute();
const router = useRouter();
const formRef = ref<FormInstance>();
const loading = ref(false);
const form = reactive({ username: '', password: '' });
const rules: Record<string, Rule[]> = {
  username: [{ required: true, message: '请输入学号 / 工号', trigger: 'blur' }],
  password: [{ required: true, message: '请输入密码', trigger: 'blur' }],
};

async function onSubmit(): Promise<void> {
  await formRef.value?.validate();
  loading.value = true;
  try {
    const user = await auth.login(form.username, form.password);
    if (user.mustChangePassword) {
      await router.push('/change-password');
      return;
    }
    const redirect = route.query.redirect;
    // 按角色落地（PRD §8：管理/教师端为独立侧边栏工作区）：
    // 管理员直进控制台工作台，教师直进任务管理，学生留在公共首页
    const fallback =
      user.role === 'ADMIN' ? '/admin' : user.role === 'TEACHER' ? '/teacher/tasks' : '/';
    await router.push(typeof redirect === 'string' ? redirect : fallback);
  } catch (error) {
    const err = error as NormalizedError;
    message.error(err.friendlyMessage ?? '登录失败');
  } finally {
    loading.value = false;
  }
}
</script>

<template>
  <div class="login-page">
    <div class="login-panel">
      <div class="login-brand">
        <img class="brand-badge" src="/school-badge.png" alt="上海科技大学附属学校校徽" />
        <span class="brand-name">校园任务平台</span>
      </div>
      <a-card class="login-card">
        <h2 class="login-title">登录</h2>
        <p class="tip">账号由管理员分配，忘记密码请联系管理员。首次登录需修改初始密码。</p>
        <a-form ref="formRef" :model="form" :rules="rules" layout="vertical" @submit.prevent="onSubmit">
          <a-form-item label="学号 / 工号" name="username">
            <a-input v-model:value="form.username" autocomplete="username" placeholder="学号 / 工号" />
          </a-form-item>
          <a-form-item label="密码" name="password">
            <a-input-password
              v-model:value="form.password"
              autocomplete="current-password"
              placeholder="密码"
            />
          </a-form-item>
          <a-button class="submit" type="primary" html-type="submit" :loading="loading" @click="onSubmit">
            登录
          </a-button>
        </a-form>
      </a-card>
    </div>
  </div>
</template>

<style scoped>
.login-page {
  min-height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--sasu-bg-page);
}
.login-panel {
  width: 380px;
}
.login-brand {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 12px;
  margin-bottom: 24px;
}
.brand-badge {
  width: 44px;
  height: 44px;
}
.brand-name {
  font-size: 18px;
  font-weight: 700;
  letter-spacing: 0.2px;
}
.login-card {
  border-radius: var(--sasu-radius-card);
  box-shadow: 0 2px 12px rgba(16, 24, 40, 0.06);
}
.login-title {
  margin: 0 0 4px;
  font-size: 18px;
}
.tip {
  color: var(--sasu-text-secondary);
  font-size: 12px;
  margin-top: 0;
  margin-bottom: 16px;
}
.submit {
  width: 100%;
  margin-top: 4px;
}
</style>
