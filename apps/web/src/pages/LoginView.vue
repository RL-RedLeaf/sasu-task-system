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
    await router.push(typeof redirect === 'string' ? redirect : '/');
  } catch (error) {
    const err = error as NormalizedError;
    message.error(err.friendlyMessage ?? '登录失败');
  } finally {
    loading.value = false;
  }
}
</script>

<template>
  <div class="login-wrap">
    <a-card class="login-card">
      <h2 class="login-title">登录</h2>
      <p class="tip">账号由管理员分配，忘记密码请联系管理员。首次登录需修改初始密码。</p>
      <a-form ref="formRef" :model="form" :rules="rules" layout="vertical" @submit.prevent>
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
</template>

<style scoped>
.login-wrap {
  display: flex;
  justify-content: center;
  padding-top: 48px;
}
.login-card {
  width: 380px;
  border-radius: var(--sasu-radius-base);
  box-shadow: var(--sasu-shadow-card);
}
.login-title {
  margin: 0 0 4px;
}
.tip {
  color: var(--sasu-text-secondary);
  font-size: 12px;
  margin-top: 0;
}
.submit {
  width: 100%;
  margin-top: 4px;
}
</style>
