<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue';
import { confirm, message } from '@/composables/feedback';
import type { FormInstance } from 'ant-design-vue';
import type { Rule } from 'ant-design-vue/es/form';
import type { NormalizedError } from '@/api/http';
import { categoriesApi, type CategoryRow } from '@/api/admin';
import PageHeader from '@/components/PageHeader.vue';
import EmptyState from '@/components/EmptyState.vue';
import type { TableColumnsType } from 'ant-design-vue';

function errMsg(e: unknown): string {
  return (e as NormalizedError).friendlyMessage ?? '操作失败';
}

const columns: TableColumnsType = [
  { title: '分类名称', dataIndex: 'name', key: 'name' },
  { title: '说明', key: 'description' },
  { title: '排序', dataIndex: 'sortOrder', key: 'sortOrder', width: 100, align: 'center' },
  { title: '操作', key: 'action', width: 160, fixed: 'right' },
];

const loading = ref(false);
const items = ref<CategoryRow[]>([]);

async function load(): Promise<void> {
  loading.value = true;
  try {
    const data = await categoriesApi.list();
    items.value = [...data.items].sort((a, b) => a.sortOrder - b.sortOrder);
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
const form = reactive({ name: '', description: '', sortOrder: 0 });

const rules: Record<string, Rule[]> = {
  name: [{ required: true, message: '请输入分类名称', trigger: 'blur' }],
};

function openCreate(): void {
  editingId.value = null;
  Object.assign(form, { name: '', description: '', sortOrder: 0 });
  dialogOpen.value = true;
}

function openEdit(row: CategoryRow): void {
  editingId.value = row.id;
  Object.assign(form, { name: row.name, description: row.description ?? '', sortOrder: row.sortOrder });
  dialogOpen.value = true;
}

async function submit(): Promise<void> {
  await formRef.value?.validate();
  saving.value = true;
  try {
    const data = {
      name: form.name,
      description: form.description || undefined,
      sortOrder: form.sortOrder,
    };
    if (editingId.value) {
      await categoriesApi.update(editingId.value, data);
      message.success('已保存');
    } else {
      await categoriesApi.create(data);
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

async function remove(row: CategoryRow): Promise<void> {
  try {
    await confirm({
      title: '删除分类',
      content: `确认删除分类「${row.name}」吗？若仍有任务引用该分类，删除会被拒绝。`,
      icon: 'warning',
      okText: '确认删除',
    });
    await categoriesApi.remove(row.id);
    message.success('已删除');
    void load();
  } catch (e) {
    if (e !== 'cancel' && e !== 'close') message.error(errMsg(e));
  }
}
</script>

<template>
  <div class="page-top">
    <PageHeader title="任务分类管理" subtitle="任务发布时可选的分类，含展示排序" />
    <a-button type="primary" @click="openCreate">新建分类</a-button>
  </div>

  <a-card class="block">
    <a-table
      :columns="columns"
      :data-source="items"
      :loading="loading"
      :pagination="false"
      row-key="id"
    >
      <template #bodyCell="{ column, record }">
        <template v-if="column.key === 'description'">{{ record.description ?? '—' }}</template>
        <template v-else-if="column.key === 'action'">
          <a-button type="link" size="small" class="op-link" @click="openEdit(record as CategoryRow)">编辑</a-button>
          <a-button type="link" size="small" class="op-link op-danger" @click="remove(record as CategoryRow)">删除</a-button>
        </template>
      </template>
      <template #emptyText><EmptyState description="还没有分类，点击右上角新建" /></template>
    </a-table>
  </a-card>

  <a-modal v-model:open="dialogOpen" :title="editingId ? '编辑分类' : '新建分类'" :width="440">
    <a-form ref="formRef" :model="form" :rules="rules" :label-col="{ style: { width: '90px' } }">
      <a-form-item label="分类名称" name="name">
        <a-input v-model:value="form.name" :maxlength="20" placeholder="如：卫生劳动、活动协助" />
      </a-form-item>
      <a-form-item label="说明">
        <a-textarea v-model:value="form.description" :rows="2" :maxlength="100" />
      </a-form-item>
      <a-form-item label="排序值">
        <a-input-number v-model:value="form.sortOrder" :min="0" :max="9999" />
        <span class="tip">数字越小越靠前</span>
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
.tip {
  margin-left: 8px;
  color: var(--sasu-text-secondary);
  font-size: 12px;
}
.op-link {
  padding: 0;
}
.op-danger {
  color: var(--sasu-color-danger);
}
</style>
