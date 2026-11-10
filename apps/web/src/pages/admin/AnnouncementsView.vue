<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue';
import { confirm, message } from '@/composables/feedback';
import type { FormInstance } from 'ant-design-vue';
import type { Rule } from 'ant-design-vue/es/form';
import type { NormalizedError } from '@/api/http';
import { communityApi, type AnnouncementRow } from '@/api/admin';
import PageHeader from '@/components/PageHeader.vue';
import StatusTag from '@/components/StatusTag.vue';
import EmptyState from '@/components/EmptyState.vue';
import AppPagination from '@/components/AppPagination.vue';
import type { TableColumnsType } from 'ant-design-vue';

function errMsg(e: unknown): string {
  return (e as NormalizedError).friendlyMessage ?? '操作失败';
}

function fmtTime(value: string | null): string {
  return value ? new Date(value).toLocaleString('zh-CN') : '—';
}

const statusLabels: Record<string, string> = { DRAFT: '草稿', PUBLISHED: '发布', OFFLINE: '下线' };

const columns: TableColumnsType = [
  { title: '标题', dataIndex: 'title', key: 'title', ellipsis: true },
  { title: '内容', dataIndex: 'content', key: 'content', ellipsis: true },
  { title: '状态', key: 'status', width: 90 },
  { title: '发布时间', key: 'publishedAt', width: 170 },
  { title: '创建时间', key: 'createdAt', width: 170 },
  { title: '操作', key: 'action', width: 150, fixed: 'right' },
];

const loading = ref(false);
const items = ref<AnnouncementRow[]>([]);
const total = ref(0);
const page = ref(1);
const pageSize = ref(20);

async function load(): Promise<void> {
  loading.value = true;
  try {
    const data = await communityApi.adminAnnouncements({ page: page.value, pageSize: pageSize.value });
    items.value = data.items;
    total.value = data.total;
  } catch (e) {
    message.error(errMsg(e));
  } finally {
    loading.value = false;
  }
}

onMounted(() => void load());

// ---------- 新建 / 编辑 ----------
const dialogOpen = ref(false);
const editingId = ref<string | null>(null);
const formRef = ref<FormInstance>();
const saving = ref(false);
const form = reactive({ title: '', content: '', status: 'DRAFT' });

const rules: Record<string, Rule[]> = {
  title: [{ required: true, message: '请输入公告标题', trigger: 'blur' }],
  content: [{ required: true, message: '请输入公告内容', trigger: 'blur' }],
  status: [{ required: true, message: '请选择状态', trigger: 'change' }],
};

function openCreate(): void {
  editingId.value = null;
  Object.assign(form, { title: '', content: '', status: 'DRAFT' });
  dialogOpen.value = true;
}

function openEdit(row: AnnouncementRow): void {
  editingId.value = row.id;
  Object.assign(form, { title: row.title, content: row.content, status: row.status });
  dialogOpen.value = true;
}

async function submit(): Promise<void> {
  await formRef.value?.validate();
  saving.value = true;
  try {
    if (editingId.value) {
      await communityApi.updateAnnouncement(editingId.value, { ...form });
      message.success('已保存');
    } else {
      await communityApi.createAnnouncement({ ...form });
      message.success('已创建');
    }
    dialogOpen.value = false;
    void load();
  } catch (e) {
    message.error(errMsg(e));
  } finally {
    saving.value = false;
  }
}

async function remove(row: AnnouncementRow): Promise<void> {
  try {
    await confirm({
      title: '删除公告',
      content: `确认删除公告「${row.title}」吗？`,
      icon: 'warning',
      okText: '确认删除',
    });
    await communityApi.updateAnnouncement(row.id, { status: 'OFFLINE' });
    message.success('已下线该公告');
    void load();
  } catch (e) {
    if (e !== 'cancel' && e !== 'close') message.error(errMsg(e));
  }
}
</script>

<template>
  <div class="page-top">
    <PageHeader title="公告管理" subtitle="面向全体用户的站内公告，支持草稿/发布/下线" />
    <a-button type="primary" @click="openCreate">新建公告</a-button>
  </div>

  <a-card class="block">
    <a-table
      :columns="columns"
      :data-source="items"
      :loading="loading"
      :pagination="false"
      row-key="id"
      :scroll="{ x: 960 }"
    >
      <template #bodyCell="{ column, record }">
        <template v-if="column.key === 'status'"><StatusTag :status="statusLabels[record.status as string] ?? record.status" /></template>
        <template v-else-if="column.key === 'publishedAt'">{{ fmtTime(record.publishedAt) }}</template>
        <template v-else-if="column.key === 'createdAt'">{{ fmtTime(record.createdAt) }}</template>
        <template v-else-if="column.key === 'action'">
          <a-button type="link" size="small" class="op-link" @click="openEdit(record as AnnouncementRow)">编辑</a-button>
          <a-button v-if="record.status !== 'OFFLINE'" type="link" size="small" class="op-link op-danger" @click="remove(record as AnnouncementRow)">下线</a-button>
        </template>
      </template>
      <template #emptyText><EmptyState description="还没有公告，点击右上角新建" /></template>
    </a-table>

    <div class="pager">
      <AppPagination v-model:page="page" :page-size="pageSize" :total="total" @change="load" />
    </div>
  </a-card>

  <a-modal v-model:open="dialogOpen" :title="editingId ? '编辑公告' : '新建公告'" :width="560">
    <a-form ref="formRef" :model="form" :rules="rules" :label-col="{ style: { width: '80px' } }">
      <a-form-item label="标题" name="title">
        <a-input v-model:value="form.title" :maxlength="50" show-count />
      </a-form-item>
      <a-form-item label="内容" name="content">
        <a-textarea v-model:value="form.content" :rows="6" :maxlength="1000" show-count />
      </a-form-item>
      <a-form-item label="状态" name="status">
        <a-radio-group v-model:value="form.status">
          <a-radio value="DRAFT">草稿</a-radio>
          <a-radio value="PUBLISHED">发布</a-radio>
          <a-radio value="OFFLINE">下线</a-radio>
        </a-radio-group>
      </a-form-item>
    </a-form>
    <template #footer>
      <a-button @click="dialogOpen = false">取消</a-button>
      <a-button type="primary" :loading="saving" @click="submit">保存</a-button>
    </template>
  </a-modal>
</template>

<style scoped>
.page-top {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  margin-bottom: 16px;
}
.block {
  border-radius: var(--sasu-radius-base);
  box-shadow: var(--sasu-shadow-card);
}
.pager {
  margin-top: 12px;
  display: flex;
  justify-content: flex-end;
}
.op-link {
  padding: 0;
}
.op-danger {
  color: var(--sasu-color-danger);
}
</style>
