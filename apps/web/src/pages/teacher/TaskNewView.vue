<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue';
import { useRouter } from 'vue-router';
import { ElMessage, type FormInstance, type FormRules } from 'element-plus';
import { categoriesApi, type CategoryRow } from '@/api/admin';
import { tasksApi } from '@/api/tasks';
import type { NormalizedError } from '@/api/http';
import PageHeader from '@/components/PageHeader.vue';

const HOUR = 3_600_000;
const DAY = 86_400_000;
const MAX_DAYS = 90;

const router = useRouter();
const formRef = ref<FormInstance>();
const loading = ref(false);
const categories = ref<CategoryRow[]>([]);

const form = reactive({
  title: '',
  categoryId: undefined as number | undefined,
  description: '',
  requirement: '',
  location: '',
  contactInfo: '',
  headcount: 1,
  deadlineAt: null as Date | null,
});

const minDeadline = new Date(Date.now() + HOUR);
const maxDeadline = new Date(Date.now() + MAX_DAYS * DAY);
void minDeadline;
void maxDeadline;

const rules: FormRules = {
  title: [
    { required: true, message: '请输入任务标题', trigger: 'blur' },
    { min: 2, max: 50, message: '标题需 2-50 字', trigger: 'blur' },
  ],
  categoryId: [{ required: true, message: '请选择任务分类', trigger: 'change' }],
  description: [
    { required: true, message: '请输入任务描述', trigger: 'blur' },
    { min: 10, max: 2000, message: '描述需 10-2000 字', trigger: 'blur' },
  ],
  requirement: [{ max: 500, message: '交付要求最多 500 字', trigger: 'blur' }],
  location: [{ max: 100, message: '地点最多 100 字', trigger: 'blur' }],
  contactInfo: [{ max: 200, message: '联系方式最多 200 字', trigger: 'blur' }],
  headcount: [{ required: true, message: '请填写名额', trigger: 'change' }],
  deadlineAt: [
    { required: true, message: '请选择截止时间', trigger: 'change' },
    {
      validator: (_r, value: Date | null, cb) => {
        if (!value) {
          cb();
          return;
        }
        const t = new Date(value).getTime();
        if (t <= Date.now() + HOUR) cb(new Error('截止时间至少晚于当前 1 小时'));
        else if (t > Date.now() + MAX_DAYS * DAY) cb(new Error(`截止时间最长不超过 ${MAX_DAYS} 天`));
        else cb();
      },
      trigger: 'change',
    },
  ],
};

function disabledDate(d: Date): boolean {
  const t = d.getTime();
  // 最早当前+1小时（放宽到当天 0 点避免日历整格不可选），最晚 90 天
  return t < Date.now() + HOUR - DAY || t > Date.now() + MAX_DAYS * DAY;
}

async function onSubmit(): Promise<void> {
  await formRef.value?.validate();
  loading.value = true;
  try {
    const data: Record<string, unknown> = {
      title: form.title.trim(),
      categoryId: form.categoryId,
      description: form.description.trim(),
      headcount: form.headcount,
      deadlineAt: new Date(form.deadlineAt as Date).toISOString(),
    };
    if (form.requirement.trim()) data.requirement = form.requirement.trim();
    if (form.location.trim()) data.location = form.location.trim();
    if (form.contactInfo.trim()) data.contactInfo = form.contactInfo.trim();
    await tasksApi.create(data);
    ElMessage.success('任务已提交，等待管理员定价后才会出现在任务大厅');
    await router.push('/teacher/tasks');
  } catch (e) {
    ElMessage.error((e as NormalizedError).friendlyMessage ?? '提交失败');
  } finally {
    loading.value = false;
  }
}

onMounted(async () => {
  try {
    const r = await categoriesApi.list();
    categories.value = r.items;
  } catch {
    // 分类加载失败时提示
    ElMessage.warning('分类加载失败，请刷新重试');
  }
});
</script>

<template>
  <PageHeader title="发布任务" subtitle="填写任务信息提交后，由管理员定价并上架" />
  <el-alert
    class="block"
    type="info"
    show-icon
    :closable="false"
    title="赏金由管理员设定，定价后任务才会出现在任务大厅"
    description="请确保任务内容合规：禁止代课、代考、代写作业、人肉搜索、骚扰他人等内容，违者封号并移交学校处理。"
  />
  <el-card shadow="never" class="block">
    <el-form
      ref="formRef"
      :model="form"
      :rules="rules"
      label-position="top"
      class="task-form"
      @submit.prevent="onSubmit"
    >
      <el-form-item label="任务标题（2-50 字）" prop="title">
        <el-input v-model="form.title" maxlength="50" show-word-limit placeholder="例如：帮忙搬运图书馆新到的书籍" />
      </el-form-item>
      <el-form-item label="任务分类" prop="categoryId">
        <el-select
          v-model="form.categoryId"
          placeholder="请选择分类"
          filterable
          class="w-select"
        >
          <el-option v-for="c in categories" :key="c.id" :label="c.name" :value="Number(c.id)" />
        </el-select>
      </el-form-item>
      <el-form-item label="任务描述（10-2000 字）" prop="description">
        <el-input
          v-model="form.description"
          type="textarea"
          :rows="6"
          maxlength="2000"
          show-word-limit
          placeholder="说清楚做什么、什么时候做、有什么注意事项"
        />
      </el-form-item>
      <el-form-item label="交付要求（选填，500 字以内，告诉学生要交什么）" prop="requirement">
        <el-input
          v-model="form.requirement"
          type="textarea"
          :rows="3"
          maxlength="500"
          show-word-limit
          placeholder="例如：提交 2 张现场照片 + 一段 100 字的完成说明"
        />
      </el-form-item>
      <el-row :gutter="16">
        <el-col :span="8">
          <el-form-item label="名额（1-50 人）" prop="headcount">
            <el-input-number v-model="form.headcount" :min="1" :max="50" :precision="0" controls-position="right" class="w-number" />
          </el-form-item>
        </el-col>
        <el-col :span="16">
          <el-form-item label="截止时间（最早当前 1 小时后，最晚 90 天）" prop="deadlineAt">
            <el-date-picker
              v-model="form.deadlineAt"
              type="datetime"
              placeholder="选择截止时间"
              format="YYYY-MM-DD HH:mm"
              :disabled-date="disabledDate"
              class="w-picker"
            />
          </el-form-item>
        </el-col>
      </el-row>
      <el-row :gutter="16">
        <el-col :span="12">
          <el-form-item label="地点（选填，100 字以内）" prop="location">
            <el-input v-model="form.location" maxlength="100" show-word-limit placeholder="例如：图书馆一层服务台" />
          </el-form-item>
        </el-col>
        <el-col :span="12">
          <el-form-item label="联系方式（选填，仅接单成功的学生可见）" prop="contactInfo">
            <el-input v-model="form.contactInfo" maxlength="200" show-word-limit placeholder="例如：企业微信 / 邮箱" />
          </el-form-item>
        </el-col>
      </el-row>
      <el-form-item>
        <el-button type="primary" :loading="loading" native-type="submit">提交任务</el-button>
        <el-button @click="router.back()">取消</el-button>
        <span class="tip">提交后进入「待定价」，管理员设定赏金后学生才可见</span>
      </el-form-item>
    </el-form>
  </el-card>
</template>

<style scoped>
.block {
  border-radius: var(--sasu-radius-base);
  box-shadow: var(--sasu-shadow-card);
  margin-bottom: 16px;
}
.task-form {
  max-width: 860px;
}
.w-select {
  width: 280px;
}
.w-number {
  width: 160px;
}
.w-picker {
  width: 100%;
}
.tip {
  margin-left: 12px;
  color: var(--sasu-text-secondary);
  font-size: 12px;
}
</style>
