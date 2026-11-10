<script setup lang="ts">
import { reactive, ref } from 'vue';
import { ElMessage, type FormInstance, type FormRules } from 'element-plus';
import { useAuthStore } from '@/stores/auth';
import { authApi } from '@/api/auth';
import { NormalizedError } from '@/api/http';
import PageHeader from '@/components/PageHeader.vue';

const auth = useAuthStore();
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
          cb(new Error('至少 8 位，且需同时包含字母和数字'));
        } else cb();
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
    await authApi.changePassword(form.oldPassword, form.newPassword);
    ElMessage.success('密码修改成功，请重新登录');
    const username = auth.user?.username;
    auth.reset();
    if (username) await auth.login(username, form.newPassword);
  } catch (error) {
    const err = error as NormalizedError;
    ElMessage.error(err.friendlyMessage ?? '修改失败');
  } finally {
    loading.value = false;
  }
}
</script>

<template>
  <PageHeader title="个人中心" />
  <el-row :gutter="16">
    <el-col :span="10">
      <el-card shadow="never" class="block">
        <template #header>我的资料</template>
        <div class="row"><span>姓名</span><b>{{ auth.user?.name }}</b></div>
        <div class="row"><span>学号 / 工号</span><b>{{ auth.user?.username }}</b></div>
        <div class="row"><span>角色</span><b>{{ auth.user?.role }}</b></div>
        <p class="tip">如需修改姓名、班级等信息，请联系管理员。</p>
      </el-card>
    </el-col>
    <el-col :span="14">
      <el-card shadow="never" class="block">
        <template #header>修改密码</template>
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
          <el-button type="primary" native-type="submit" :loading="loading" @click="onSubmit">修改密码</el-button>
        </el-form>
      </el-card>
    </el-col>
  </el-row>
</template>

<style scoped>
.block {
  border-radius: var(--sasu-radius-base);
  box-shadow: var(--sasu-shadow-card);
}
.row {
  display: flex;
  justify-content: space-between;
  padding: 6px 0;
}
.tip {
  color: var(--sasu-text-secondary);
  font-size: 12px;
}
</style>
