<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import type { FormInstance, FormRules } from 'element-plus';
import type { NormalizedError } from '@/api/http';
import { communityApi, type AnnouncementRow } from '@/api/admin';
import PageHeader from '@/components/PageHeader.vue';
import StatusTag from '@/components/StatusTag.vue';
import EmptyState from '@/components/EmptyState.vue';

function errMsg(e: unknown): string {
  return (e as NormalizedError).friendlyMessage ?? '操作失败';
}

function fmtTime(value: string | null): string {
  return value ? new Date(value).toLocaleString('zh-CN') : '—';
}

const statusLabels: Record<string, string> = { DRAFT: '草稿', PUBLISHED: '发布', OFFLINE: '下线' };

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
    ElMessage.error(errMsg(e));
  } finally {
    loading.value = false;
  }
}

function onPageChange(): void {
  void load();
}

onMounted(() => void load());

// ---------- 新建 / 编辑 ----------
const dialogVisible = ref(false);
const editingId = ref<string | null>(null);
const formRef = ref<FormInstance>();
const saving = ref(false);
const form = reactive({ title: '', content: '', status: 'DRAFT' });

const rules: FormRules = {
  title: [{ required: true, message: '请输入公告标题', trigger: 'blur' }],
  content: [{ required: true, message: '请输入公告内容', trigger: 'blur' }],
  status: [{ required: true, message: '请选择状态', trigger: 'change' }],
};

function openCreate(): void {
  editingId.value = null;
  Object.assign(form, { title: '', content: '', status: 'DRAFT' });
  dialogVisible.value = true;
}

function openEdit(row: AnnouncementRow): void {
  editingId.value = row.id;
  Object.assign(form, { title: row.title, content: row.content, status: row.status });
  dialogVisible.value = true;
}

async function submit(): Promise<void> {
  await formRef.value?.validate();
  saving.value = true;
  try {
    if (editingId.value) {
      await communityApi.updateAnnouncement(editingId.value, { ...form });
      ElMessage.success('已保存');
    } else {
      await communityApi.createAnnouncement({ ...form });
      ElMessage.success('已创建');
    }
    dialogVisible.value = false;
    void load();
  } catch (e) {
    ElMessage.error(errMsg(e));
  } finally {
    saving.value = false;
  }
}

async function remove(row: AnnouncementRow): Promise<void> {
  try {
    await ElMessageBox.confirm(`确认删除公告「${row.title}」吗？`, '删除公告', {
      confirmButtonText: '确认删除',
      cancelButtonText: '取消',
      type: 'warning',
    });
    await communityApi.updateAnnouncement(row.id, { status: 'OFFLINE' });
    ElMessage.success('已下线该公告');
    void load();
  } catch (e) {
    if (e !== 'cancel' && e !== 'close') ElMessage.error(errMsg(e));
  }
}
</script>

<template>
  <div class="page-top">
    <PageHeader title="公告管理" subtitle="面向全体用户的站内公告，支持草稿/发布/下线" />
    <el-button type="primary" @click="openCreate">新建公告</el-button>
  </div>

  <el-card shadow="never" class="block">
    <el-table v-loading="loading" :data="items" stripe>
      <el-table-column prop="title" label="标题" min-width="220" show-overflow-tooltip />
      <el-table-column prop="content" label="内容" min-width="280" show-overflow-tooltip />
      <el-table-column label="状态" width="90">
        <template #default="{ row }"><StatusTag :status="statusLabels[row.status as string] ?? row.status" /></template>
      </el-table-column>
      <el-table-column label="发布时间" width="170">
        <template #default="{ row }">{{ fmtTime(row.publishedAt) }}</template>
      </el-table-column>
      <el-table-column label="创建时间" width="170">
        <template #default="{ row }">{{ fmtTime(row.createdAt) }}</template>
      </el-table-column>
      <el-table-column label="操作" width="150" fixed="right">
        <template #default="{ row }">
          <el-button link type="primary" size="small" @click="openEdit(row)">编辑</el-button>
          <el-button v-if="row.status !== 'OFFLINE'" link type="danger" size="small" @click="remove(row)">下线</el-button>
        </template>
      </el-table-column>
      <template #empty><EmptyState description="还没有公告，点击右上角新建" /></template>
    </el-table>

    <div class="pager">
      <el-pagination
        v-model:current-page="page"
        v-model:page-size="pageSize"
        :total="total"
        layout="total, prev, pager, next"
        @current-change="onPageChange"
      />
    </div>
  </el-card>

  <el-dialog v-model="dialogVisible" :title="editingId ? '编辑公告' : '新建公告'" width="560px">
    <el-form ref="formRef" :model="form" :rules="rules" label-width="80px">
      <el-form-item label="标题" prop="title">
        <el-input v-model="form.title" maxlength="50" show-word-limit />
      </el-form-item>
      <el-form-item label="内容" prop="content">
        <el-input v-model="form.content" type="textarea" :rows="6" maxlength="1000" show-word-limit />
      </el-form-item>
      <el-form-item label="状态" prop="status">
        <el-radio-group v-model="form.status">
          <el-radio value="DRAFT">草稿</el-radio>
          <el-radio value="PUBLISHED">发布</el-radio>
          <el-radio value="OFFLINE">下线</el-radio>
        </el-radio-group>
      </el-form-item>
    </el-form>
    <template #footer>
      <el-button @click="dialogVisible = false">取消</el-button>
      <el-button type="primary" :loading="saving" @click="submit">保存</el-button>
    </template>
  </el-dialog>
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
</style>
