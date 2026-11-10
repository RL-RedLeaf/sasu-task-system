<script setup lang="ts">
import { reactive, ref } from 'vue';
import { useRouter } from 'vue-router';
import { message } from '@/composables/feedback';
import type { FormInstance } from 'ant-design-vue';
import type { Rule } from 'ant-design-vue/es/form';
import { useAuthStore } from '@/stores/auth';
import { authApi } from '@/api/auth';
import { NormalizedError } from '@/api/http';

/** 首登强制改密（PRD AUTH-02/03）：改密后旧会话失效，重新登录 */
const auth = useAuthStore();
const router = useRouter();
const formRef = ref<FormInstance>();
const loading = ref(false);
const form = reactive({ oldPassword: '', newPassword: '', confirm: '' });

const rules: Record<string, Rule[]> = {
  oldPassword: [{ required: true, message: '请输入当前密码', trigger: 'blur' }],
  newPassword: [
    { required: true, message: '请输入新密码', trigger: 'blur' },
    {
      validator: (_r, value: string, cb) => {
        if (value && (value.length < 8 || !/[a-zA-Z]/.test(value) || !/\d/.test(value))) {
          cb('新密码至少 8 位，且需同时包含字母和数字');
        } else {
          cb();
        }
      },
      trigger: 'blur',
    },
  ],
  confirm: [
    {
      validator: (_r, value: string, cb) => {
        if (value !== form.newPassword) cb('两次输入的密码不一致');
        else cb();
      },
      trigger: 'blur',
    },
  ],
};

async function onSubmit(): Promise<void> {
  await formRef.value?.validate();
  loading.value = true;
  try {
    const username = auth.user?.username;
    await authApi.changePassword(form.oldPassword, form.newPassword);
    message.success('密码修改成功，请重新登录');
    auth.reset();
    if (username) await auth.login(username, form.newPassword);
    await router.push('/');
  } catch (error) {
    const err = error as NormalizedError;
    message.error(err.friendlyMessage ?? '修改失败');
  } finally {
    loading.value = false;
  }
}
</script>

<template>
  <div class="login-wrap">
    <a-card class="card">
      <h2>修改初始密码</h2>
      <p class="tip">首次登录必须修改初始密码后才能使用系统。</p>
      <a-form ref="formRef" :model="form" :rules="rules" layout="vertical" @submit.prevent>
        <a-form-item label="当前密码" name="oldPassword">
          <a-input-password v-model:value="form.oldPassword" />
        </a-form-item>
        <a-form-item label="新密码（≥8 位，含字母和数字）" name="newPassword">
          <a-input-password v-model:value="form.newPassword" />
        </a-form-item>
        <a-form-item label="确认新密码" name="confirm">
          <a-input-password v-model:value="form.confirm" />
        </a-form-item>
        <a-button class="submit" type="primary" html-type="submit" :loading="loading" @click="onSubmit">
          修改并重新登录
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
.card {
  width: 420px;
  border-radius: var(--sasu-radius-base);
  box-shadow: var(--sasu-shadow-card);
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
