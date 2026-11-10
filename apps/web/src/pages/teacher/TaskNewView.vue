<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue';
import { useRouter } from 'vue-router';
import { message } from '@/composables/feedback';
import type { FormInstance } from 'ant-design-vue';
import type { Rule } from 'ant-design-vue/es/form';
import type { Dayjs } from 'dayjs';
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
  // a-date-picker 的 value 类型为 string | Dayjs | undefined：用 undefined 而非 null
  deadlineAt: undefined as Dayjs | undefined,
});

const rules: Record<string, Rule[]> = {
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
      validator: (_r, value: Dayjs | undefined, cb) => {
        if (!value) {
          cb();
          return;
        }
        const t = value.valueOf();
        if (t <= Date.now() + HOUR) cb('截止时间至少晚于当前 1 小时');
        else if (t > Date.now() + MAX_DAYS * DAY) cb(`截止时间最长不超过 ${MAX_DAYS} 天`);
        else cb();
      },
      trigger: 'change',
    },
  ],
};

function disabledDate(d: Dayjs): boolean {
  const t = d.valueOf();
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
      deadlineAt: (form.deadlineAt as Dayjs).toISOString(),
    };
    if (form.requirement.trim()) data.requirement = form.requirement.trim();
    if (form.location.trim()) data.location = form.location.trim();
    if (form.contactInfo.trim()) data.contactInfo = form.contactInfo.trim();
    await tasksApi.create(data);
    message.success('任务已提交，等待管理员定价后才会出现在任务大厅');
    await router.push('/teacher/tasks');
  } catch (e) {
    message.error((e as NormalizedError).friendlyMessage ?? '提交失败');
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
    message.warning('分类加载失败，请刷新重试');
  }
});
</script>

<template>
  <PageHeader title="发布任务" subtitle="填写任务信息提交后，由管理员定价并上架" />
  <a-alert
    class="block"
    type="info"
    show-icon
    message="赏金由管理员设定，定价后任务才会出现在任务大厅"
    description="请确保任务内容合规：禁止代课、代考、代写作业、人肉搜索、骚扰他人等内容，违者封号并移交学校处理。"
  />
  <a-card class="block">
    <a-form
      ref="formRef"
      :model="form"
      :rules="rules"
      layout="vertical"
      class="task-form"
      @submit.prevent="onSubmit"
    >
      <a-form-item label="任务标题（2-50 字）" name="title">
        <a-input v-model:value="form.title" :maxlength="50" show-count placeholder="例如：帮忙搬运图书馆新到的书籍" />
      </a-form-item>
      <a-form-item label="任务分类" name="categoryId">
        <a-select
          v-model:value="form.categoryId"
          placeholder="请选择分类"
          show-search
          option-filter-prop="label"
          class="w-select"
          :options="categories.map((c) => ({ label: c.name, value: Number(c.id) }))"
        />
      </a-form-item>
      <a-form-item label="任务描述（10-2000 字）" name="description">
        <a-textarea
          v-model:value="form.description"
          :rows="6"
          :maxlength="2000"
          show-count
          placeholder="说清楚做什么、什么时候做、有什么注意事项"
        />
      </a-form-item>
      <a-form-item label="交付要求（选填，500 字以内，告诉学生要交什么）" name="requirement">
        <a-textarea
          v-model:value="form.requirement"
          :rows="3"
          :maxlength="500"
          show-count
          placeholder="例如：提交 2 张现场照片 + 一段 100 字的完成说明"
        />
      </a-form-item>
      <a-row :gutter="16">
        <a-col :span="8">
          <a-form-item label="名额（1-50 人）" name="headcount">
            <a-input-number v-model:value="form.headcount" :min="1" :max="50" :precision="0" class="w-number" />
          </a-form-item>
        </a-col>
        <a-col :span="16">
          <a-form-item label="截止时间（最早当前 1 小时后，最晚 90 天）" name="deadlineAt">
            <a-date-picker
              v-model:value="form.deadlineAt"
              show-time
              placeholder="选择截止时间"
              format="YYYY-MM-DD HH:mm"
              :disabled-date="disabledDate"
              class="w-picker"
            />
          </a-form-item>
        </a-col>
      </a-row>
      <a-row :gutter="16">
        <a-col :span="12">
          <a-form-item label="地点（选填，100 字以内）" name="location">
            <a-input v-model:value="form.location" :maxlength="100" show-count placeholder="例如：图书馆一层服务台" />
          </a-form-item>
        </a-col>
        <a-col :span="12">
          <a-form-item label="联系方式（选填，仅接单成功的学生可见）" name="contactInfo">
            <a-input v-model:value="form.contactInfo" :maxlength="200" show-count placeholder="例如：企业微信 / 邮箱" />
          </a-form-item>
        </a-col>
      </a-row>
      <a-form-item>
        <a-button type="primary" :loading="loading" html-type="submit">提交任务</a-button>
        <a-button class="btn-cancel" @click="router.back()">取消</a-button>
        <span class="tip">提交后进入「待定价」，管理员设定赏金后学生才可见</span>
      </a-form-item>
    </a-form>
  </a-card>
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
.btn-cancel {
  margin-left: 12px;
}
.tip {
  margin-left: 12px;
  color: var(--sasu-text-secondary);
  font-size: 12px;
}
</style>
