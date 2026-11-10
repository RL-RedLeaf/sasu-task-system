<script setup lang="ts">
import { reactive, ref } from 'vue';
import type { FormInstance, FormRules } from 'element-plus';
import { Role } from '@sasu/shared';
import { useAuthStore } from '@/stores/auth';

/**
 * 登录页骨架（PRD §8.1 /login）。
 * M1 接入 POST /auth/login：失败统一提示「账号或密码错误」，首登强制改密。
 */
const auth = useAuthStore();
const formRef = ref<FormInstance>();
const form = reactive({ username: '', password: '' });
const rules: FormRules = {
  username: [{ required: true, message: '请输入学号 / 工号', trigger: 'blur' }],
  password: [{ required: true, message: '请输入密码', trigger: 'blur' }],
};

async function onSubmit(): Promise<void> {
  await formRef.value?.validate();
  // TODO(M1): 调用 /auth/login；此处仅演示登录态写入
  auth.setLogin({ id: 0, name: form.username, role: Role.STUDENT });
}
</script>

<template>
  <el-card class="login-card" shadow="never">
    <h2>登录</h2>
    <p class="tip">账号由管理员分配，忘记密码请联系管理员。</p>
    <el-form ref="formRef" :model="form" :rules="rules" label-position="top" @submit.prevent>
      <el-form-item label="学号 / 工号" prop="username">
        <el-input v-model="form.username" autocomplete="username" />
      </el-form-item>
      <el-form-item label="密码" prop="password">
        <el-input
          v-model="form.password"
          type="password"
          show-password
          autocomplete="current-password"
        />
      </el-form-item>
      <el-button type="primary" native-type="submit" @click="onSubmit">登录</el-button>
    </el-form>
  </el-card>
</template>

<style scoped>
.login-card {
  max-width: 380px;
  margin: 48px auto;
  border-radius: var(--sasu-radius-base);
  box-shadow: var(--sasu-shadow-card);
}
.tip {
  color: var(--sasu-text-secondary);
  font-size: 12px;
}
</style>
