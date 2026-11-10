<script setup lang="ts">
import { reactive, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import type { FormInstance, FormRules } from 'element-plus';
import { ElMessage } from 'element-plus';
import { useAuthStore } from '@/stores/auth';
import { NormalizedError } from '@/api/http';

const auth = useAuthStore();
const route = useRoute();
const router = useRouter();
const formRef = ref<FormInstance>();
const loading = ref(false);
const form = reactive({ username: '', password: '' });
const rules: FormRules = {
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
    ElMessage.error(err.friendlyMessage ?? '登录失败');
  } finally {
    loading.value = false;
  }
}
</script>

<template>
  <div class="login-wrap">
    <el-card class="login-card" shadow="never">
      <h2 class="login-title">登录</h2>
      <p class="tip">账号由管理员分配，忘记密码请联系管理员。首次登录需修改初始密码。</p>
      <el-form ref="formRef" :model="form" :rules="rules" label-position="top" @submit.prevent>
        <el-form-item label="学号 / 工号" prop="username">
          <el-input v-model="form.username" autocomplete="username" placeholder="学号 / 工号" />
        </el-form-item>
        <el-form-item label="密码" prop="password">
          <el-input
            v-model="form.password"
            type="password"
            show-password
            autocomplete="current-password"
            placeholder="密码"
          />
        </el-form-item>
        <el-button class="submit" type="primary" native-type="submit" :loading="loading" @click="onSubmit">
          登录
        </el-button>
      </el-form>
    </el-card>
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
}
</style>
