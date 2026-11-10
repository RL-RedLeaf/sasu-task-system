<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import type { FormInstance, FormRules } from 'element-plus';
import type { NormalizedError } from '@/api/http';
import { categoriesApi, type CategoryRow } from '@/api/admin';
import PageHeader from '@/components/PageHeader.vue';
import EmptyState from '@/components/EmptyState.vue';

function errMsg(e: unknown): string {
  return (e as NormalizedError).friendlyMessage ?? '操作失败';
}

const loading = ref(false);
const items = ref<CategoryRow[]>([]);

async function load(): Promise<void> {
  loading.value = true;
  try {
    const data = await categoriesApi.list();
    items.value = [...data.items].sort((a, b) => a.sortOrder - b.sortOrder);
  } catch (e) {
    ElMessage.error(errMsg(e));
  } finally {
    loading.value = false;
  }
}

onMounted(() => void load());

// ---------- 新建 / 编辑 ----------
const dialogVisible = ref(false);
const editingId = ref<string | null>(null);
const formRef = ref<FormInstance>();
const saving = ref(false);
const form = reactive({ name: '', description: '', sortOrder: 0 });

const rules: FormRules = {
  name: [{ required: true, message: '请输入分类名称', trigger: 'blur' }],
};

function openCreate(): void {
  editingId.value = null;
  Object.assign(form, { name: '', description: '', sortOrder: 0 });
  dialogVisible.value = true;
}

function openEdit(row: CategoryRow): void {
  editingId.value = row.id;
  Object.assign(form, { name: row.name, description: row.description ?? '', sortOrder: row.sortOrder });
  dialogVisible.value = true;
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
      ElMessage.success('已保存');
    } else {
      await categoriesApi.create(data);
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

async function remove(row: CategoryRow): Promise<void> {
  try {
    await ElMessageBox.confirm(
      `确认删除分类「${row.name}」吗？若仍有任务引用该分类，删除会被拒绝。`,
      '删除分类',
      { confirmButtonText: '确认删除', cancelButtonText: '取消', type: 'warning' },
    );
    await categoriesApi.remove(row.id);
    ElMessage.success('已删除');
    void load();
  } catch (e) {
    if (e !== 'cancel' && e !== 'close') ElMessage.error(errMsg(e));
  }
}
</script>

<template>
  <div class="page-top">
    <PageHeader title="任务分类管理" subtitle="任务发布时可选的分类，含展示排序" />
    <el-button type="primary" @click="openCreate">新建分类</el-button>
  </div>

  <el-card shadow="never" class="block">
    <el-table v-loading="loading" :data="items" stripe>
      <el-table-column prop="name" label="分类名称" min-width="160" />
      <el-table-column prop="description" label="说明" min-width="240">
        <template #default="{ row }">{{ row.description ?? '—' }}</template>
      </el-table-column>
      <el-table-column prop="sortOrder" label="排序" width="100" align="center" />
      <el-table-column label="操作" width="160" fixed="right">
        <template #default="{ row }">
          <el-button link type="primary" size="small" @click="openEdit(row as CategoryRow)">编辑</el-button>
          <el-button link type="danger" size="small" @click="remove(row as CategoryRow)">删除</el-button>
        </template>
      </el-table-column>
      <template #empty><EmptyState description="还没有分类，点击右上角新建" /></template>
    </el-table>
  </el-card>

  <el-dialog v-model="dialogVisible" :title="editingId ? '编辑分类' : '新建分类'" width="440px">
    <el-form ref="formRef" :model="form" :rules="rules" label-width="90px">
      <el-form-item label="分类名称" prop="name">
        <el-input v-model="form.name" maxlength="20" placeholder="如：卫生劳动、活动协助" />
      </el-form-item>
      <el-form-item label="说明">
        <el-input v-model="form.description" type="textarea" :rows="2" maxlength="100" />
      </el-form-item>
      <el-form-item label="排序值">
        <el-input-number v-model="form.sortOrder" :min="0" :max="9999" />
        <span class="tip">数字越小越靠前</span>
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
.tip {
  margin-left: 8px;
  color: var(--sasu-text-secondary);
  font-size: 12px;
}
</style>
