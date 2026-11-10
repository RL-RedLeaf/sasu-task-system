<script setup lang="ts">
import { reactive, ref } from 'vue';
import { useRouter } from 'vue-router';
import { ElMessage, type FormInstance, type FormRules } from 'element-plus';
import { useAuthStore } from '@/stores/auth';
import { authApi } from '@/api/auth';
import { NormalizedError } from '@/api/http';

/** 首登强制改密（PRD AUTH-02/03）：改密后旧会话失效，重新登录 */
const auth = useAuthStore();
const router = useRouter();
const formRef = ref<FormInstance>();
const loading = ref(false);
const form = reactive({ oldPassword: '', newPassword: '', confirm: '' });

const rules: FormRules = {
  oldPassword: [{ required: true, message: '请输入当前密码', trigger: 'blur' }],
  newPassword: [
    { required: true, message: '请输入新密码', trigger: 'blur' },
    {
      validator: (_r, value: string, cb) => {
        if (value && (value.length < 8 || !/[a-zA-Z]/.test(value) || !/\d/.test(value))) {
          cb(new Error('新密码至少 8 位，且需同时包含字母和数字'));
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
        if (value !== form.newPassword) cb(new Error('两次输入的密码不一致'));
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
    ElMessage.success('密码修改成功，请重新登录');
    auth.reset();
    if (username) await auth.login(username, form.newPassword);
    await router.push('/');
  } catch (error) {
    const err = error as NormalizedError;
    ElMessage.error(err.friendlyMessage ?? '修改失败');
  } finally {
    loading.value = false;
  }
}
</script>

<template>
  <div class="login-wrap">
    <el-card class="card" shadow="never">
      <h2>修改初始密码</h2>
      <p class="tip">首次登录必须修改初始密码后才能使用系统。</p>
      <el-form ref="formRef" :model="form" :rules="rules" label-position="top" @submit.prevent>
        <el-form-item label="当前密码" prop="oldPassword">
          <el-input v-model="form.oldPassword" type="password" show-password />
        </el-form-item>
        <el-form-item label="新密码（≥8 位，含字母和数字）" prop="newPassword">
          <el-input v-model="form.newPassword" type="password" show-password />
        </el-form-item>
        <el-form-item label="确认新密码" prop="confirm">
          <el-input v-model="form.confirm" type="password" show-password />
        </el-form-item>
        <el-button class="submit" type="primary" native-type="submit" :loading="loading" @click="onSubmit">
          修改并重新登录
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
}
</style>
