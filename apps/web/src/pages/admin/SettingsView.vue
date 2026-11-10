<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue';
import { ElMessage } from 'element-plus';
import type { NormalizedError } from '@/api/http';
import { settingsApi, type ConfigRow } from '@/api/admin';
import PageHeader from '@/components/PageHeader.vue';
import EmptyState from '@/components/EmptyState.vue';

function errMsg(e: unknown): string {
  return (e as NormalizedError).friendlyMessage ?? '操作失败';
}

const loading = ref(false);
const items = ref<ConfigRow[]>([]);

async function load(): Promise<void> {
  loading.value = true;
  try {
    const data = await settingsApi.list();
    items.value = data.items;
  } catch (e) {
    ElMessage.error(errMsg(e));
  } finally {
    loading.value = false;
  }
}

onMounted(() => void load());

// 按 key 前缀简单分组
interface Group {
  title: string;
  order: number;
  match: (key: string) => boolean;
}
const GROUPS: Group[] = [
  { title: '提现类', order: 1, match: (k) => k.startsWith('WITHDRAW') || k === 'POINT_TO_CASH_RATE' },
  { title: '任务类', order: 2, match: (k) => k.startsWith('TASK') || k.startsWith('REVIEW') || k.startsWith('DEADLINE') || k.startsWith('VIOLATION') || k.startsWith('TOTAL_ISSUE') },
  { title: '安全类', order: 3, match: (k) => k.startsWith('LOGIN') || k.startsWith('SESSION') || k.startsWith('SENSITIVE') || k.startsWith('UPLOAD') },
  { title: '保留期类', order: 4, match: (k) => k.includes('RETENTION') || k.startsWith('AUDIT') },
  { title: '其他', order: 99, match: () => true },
];

const groups = computed(() => {
  const used = new Set<string>();
  const result: { title: string; rows: ConfigRow[] }[] = [];
  for (const g of [...GROUPS].sort((a, b) => a.order - b.order)) {
    const rows = items.value.filter((r) => !used.has(r.key) && g.match(r.key));
    rows.forEach((r) => used.add(r.key));
    if (rows.length > 0) result.push({ title: g.title, rows });
  }
  return result;
});

const valueTypeHints: Record<string, string> = {
  INT: '整数',
  DECIMAL: '小数（如 0.0000）',
  JSON: 'JSON 数组，如 [9, 18]',
  STRING: '文本',
  ENUM: '枚举值',
};

// ---------- 编辑 ----------
const dialogVisible = ref(false);
const saving = ref(false);
const editing = ref<ConfigRow | null>(null);
const editForm = reactive({ value: '' });

function openEdit(row: ConfigRow): void {
  editing.value = row;
  editForm.value = row.value;
  dialogVisible.value = true;
}

async function submitEdit(): Promise<void> {
  if (!editing.value) return;
  const v = editForm.value;
  const t = editing.value.valueType;
  if (t === 'INT' && !/^-?\d+$/.test(v.trim())) {
    ElMessage.warning('该配置要求整数格式');
    return;
  }
  if (t === 'DECIMAL' && !/^-?\d+(\.\d+)?$/.test(v.trim())) {
    ElMessage.warning('该配置要求小数格式');
    return;
  }
  saving.value = true;
  try {
    await settingsApi.update(editing.value.key, v.trim());
    ElMessage.success(`已保存 ${editing.value.key}`);
    dialogVisible.value = false;
    void load();
  } catch (e) {
    ElMessage.error(errMsg(e));
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <PageHeader title="系统参数设置" subtitle="提现 / 任务 / 安全 / 保留期等运行参数，修改即时生效" />

  <div v-loading="loading">
    <el-card
      v-for="group in groups"
      :key="group.title"
      shadow="never"
      class="block"
      :class="{ mt16: group.title !== groups[0]?.title }"
    >
      <template #header>{{ group.title }}</template>
      <el-table :data="group.rows" stripe>
        <el-table-column prop="key" label="参数 Key" width="280">
          <template #default="{ row }">
            <span class="mono">{{ row.key }}</span>
            <el-tooltip
              v-if="row.key === 'POINT_TO_CASH_RATE'"
              content="0 表示提现关闭；改为大于 0 的小数后自动开放学生提现入口"
              placement="top"
            >
              <el-tag type="danger" size="small" class="warn-tag">0 表示提现关闭</el-tag>
            </el-tooltip>
          </template>
        </el-table-column>
        <el-table-column prop="description" label="说明" min-width="220">
          <template #default="{ row }">{{ row.description ?? '—' }}</template>
        </el-table-column>
        <el-table-column prop="valueType" label="格式" width="90" align="center" />
        <el-table-column prop="value" label="当前值" width="180">
          <template #default="{ row }">
            <span class="mono">{{ row.value }}</span>
          </template>
        </el-table-column>
        <el-table-column label="操作" width="100" fixed="right">
          <template #default="{ row }">
            <el-button link type="primary" size="small" @click="openEdit(row as ConfigRow)">编辑</el-button>
          </template>
        </el-table-column>
        <template #empty><EmptyState /></template>
      </el-table>
    </el-card>
  </div>

  <el-dialog v-model="dialogVisible" :title="editing ? `编辑 ${editing.key}` : '编辑参数'" width="480px">
    <template v-if="editing">
      <el-alert
        v-if="editing.key === 'POINT_TO_CASH_RATE'"
        type="warning"
        :closable="false"
        show-icon
        class="mb8"
        title="0 表示提现关闭；修改前请确认不存在待审批/待发放的提现记录。"
      />
      <el-form label-width="90px" @submit.prevent>
        <el-form-item label="当前值">
          <span class="mono">{{ editing.value }}</span>
        </el-form-item>
        <el-form-item :label="`新值（${valueTypeHints[editing.valueType] ?? editing.valueType}）`">
          <el-input v-model="editForm.value" :placeholder="valueTypeHints[editing.valueType] ?? '请输入新值'" />
        </el-form-item>
        <p v-if="editing.description" class="tip">{{ editing.description }}</p>
      </el-form>
    </template>
    <template #footer>
      <el-button @click="dialogVisible = false">取消</el-button>
      <el-button type="primary" :loading="saving" @click="submitEdit">保存</el-button>
    </template>
  </el-dialog>
</template>

<style scoped>
.mt16 {
  margin-top: 16px;
}
.block {
  border-radius: var(--sasu-radius-base);
  box-shadow: var(--sasu-shadow-card);
}
.mono {
  font-family: 'SFMono-Regular', Consolas, 'Liberation Mono', monospace;
  font-size: 13px;
}
.warn-tag {
  margin-left: 8px;
}
.mb8 {
  margin-bottom: 8px;
}
.tip {
  color: var(--sasu-text-secondary);
  font-size: 12px;
  margin: 0 0 0 12px;
}
</style>
