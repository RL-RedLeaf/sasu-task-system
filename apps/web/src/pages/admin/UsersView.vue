<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue';
import { confirm, message, prompt } from '@/composables/feedback';
import type { FormInstance } from 'ant-design-vue';
import type { Rule } from 'ant-design-vue/es/form';
import type { NormalizedError } from '@/api/http';
import { statsApi, usersApi, type UserRow } from '@/api/admin';
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

async function copyText(text: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
    message.success('已复制到剪贴板');
  } catch {
    message.error('复制失败，请手动选择复制');
  }
}

const roleLabels: Record<string, string> = { STUDENT: '学生', TEACHER: '教师', ADMIN: '管理员' };

const columns: TableColumnsType = [
  { title: '学号 / 工号', dataIndex: 'username', key: 'username', width: 140 },
  { title: '姓名', dataIndex: 'name', key: 'name', width: 110 },
  { title: '角色', key: 'role', width: 90 },
  { title: '班级', key: 'className', width: 120 },
  { title: '状态', key: 'status', width: 90 },
  { title: '违约次数', dataIndex: 'violationCount', key: 'violationCount', width: 90, align: 'center' },
  { title: '欠分', dataIndex: 'penaltyDebt', key: 'penaltyDebt', width: 90, align: 'center' },
  { title: '最后登录', key: 'lastLoginAt', width: 170 },
  { title: '操作', key: 'action', width: 240, fixed: 'right' },
];

const pwdColumns: TableColumnsType = [
  { title: '学号 / 工号', dataIndex: 'username', key: 'username', width: 160 },
  { title: '初始密码', dataIndex: 'password', key: 'password' },
];

const errColumns: TableColumnsType = [
  { title: '行号', dataIndex: 'row', key: 'row', width: 80 },
  { title: '学号 / 工号', key: 'username', width: 160 },
  { title: '失败原因', dataIndex: 'error', key: 'error' },
];

// ---------- 列表 ----------
const loading = ref(false);
const items = ref<UserRow[]>([]);
const total = ref(0);
const page = ref(1);
const pageSize = ref(20);
const filters = reactive({ keyword: '', role: '', status: '' });

async function load(): Promise<void> {
  loading.value = true;
  try {
    const data = await usersApi.adminList({
      keyword: filters.keyword || undefined,
      role: filters.role || undefined,
      status: filters.status || undefined,
      page: page.value,
      pageSize: pageSize.value,
    });
    items.value = data.items;
    total.value = data.total;
  } catch (e) {
    message.error(errMsg(e));
  } finally {
    loading.value = false;
  }
}

function onSearch(): void {
  page.value = 1;
  void load();
}

onMounted(() => void load());

// ---------- 新建 ----------
const createOpen = ref(false);
const createFormRef = ref<FormInstance>();
const createLoading = ref(false);
const createForm = reactive({ username: '', name: '', role: 'STUDENT', className: '', email: '' });
const createdPassword = ref('');
const createdUsername = ref('');

const createRules: Record<string, Rule[]> = {
  username: [{ required: true, message: '请输入学号 / 工号', trigger: 'blur' }],
  name: [{ required: true, message: '请输入姓名', trigger: 'blur' }],
  role: [{ required: true, message: '请选择角色', trigger: 'change' }],
};

const roleOptions = [
  { label: '学生', value: 'STUDENT' },
  { label: '教师', value: 'TEACHER' },
  { label: '管理员', value: 'ADMIN' },
];

function openCreate(): void {
  Object.assign(createForm, { username: '', name: '', role: 'STUDENT', className: '', email: '' });
  createdPassword.value = '';
  createdUsername.value = '';
  createOpen.value = true;
}

async function submitCreate(): Promise<void> {
  await createFormRef.value?.validate();
  createLoading.value = true;
  try {
    const res = await usersApi.create({
      username: createForm.username,
      name: createForm.name,
      role: createForm.role,
      className: createForm.className || undefined,
      email: createForm.email || undefined,
    });
    createdPassword.value = res.initialPassword;
    createdUsername.value = createForm.username;
    createOpen.value = false;
    void load();
  } catch (e) {
    message.error(errMsg(e));
  } finally {
    createLoading.value = false;
  }
}

// ---------- 编辑 ----------
const editOpen = ref(false);
const editFormRef = ref<FormInstance>();
const editLoading = ref(false);
const editId = ref('');
const editForm = reactive({ name: '', role: 'STUDENT', className: '', email: '' });

const editRules: Record<string, Rule[]> = {
  name: [{ required: true, message: '请输入姓名', trigger: 'blur' }],
  role: [{ required: true, message: '请选择角色', trigger: 'change' }],
};

function openEdit(row: UserRow): void {
  editId.value = row.id;
  Object.assign(editForm, {
    name: row.name,
    role: row.role,
    className: row.className ?? '',
    email: row.email ?? '',
  });
  editOpen.value = true;
}

async function submitEdit(): Promise<void> {
  await editFormRef.value?.validate();
  editLoading.value = true;
  try {
    await usersApi.update(editId.value, {
      name: editForm.name,
      role: editForm.role,
      className: editForm.className,
      email: editForm.email,
    });
    message.success('已保存');
    editOpen.value = false;
    void load();
  } catch (e) {
    message.error(errMsg(e));
  } finally {
    editLoading.value = false;
  }
}

// ---------- 禁用 / 启用 ----------
async function disableUser(row: UserRow): Promise<void> {
  let reason: string;
  try {
    reason = (
      await prompt({
        title: `禁用账号 ${row.name}`,
        message: '禁用后该用户将无法登录，请填写禁用原因（必填）。',
        placeholder: '请输入禁用原因',
        validate: (v: string) => (v && v.trim() ? true : '禁用原因不能为空'),
      })
    ).trim();
  } catch {
    return;
  }
  try {
    await usersApi.disable(row.id, reason);
    message.success('已禁用');
    void load();
  } catch (e) {
    if (e !== 'cancel' && e !== 'close') message.error(errMsg(e));
  }
}

async function enableUser(row: UserRow): Promise<void> {
  try {
    await confirm({
      title: '启用账号',
      content: `确认启用账号 ${row.name} 吗？`,
      icon: 'warning',
      okText: '确认启用',
    });
    await usersApi.enable(row.id);
    message.success('已启用');
    void load();
  } catch (e) {
    if (e !== 'cancel' && e !== 'close') message.error(errMsg(e));
  }
}

// ---------- 重置密码 ----------
async function resetPassword(row: UserRow): Promise<void> {
  try {
    await confirm({
      title: '重置密码',
      content: `确认重置 ${row.name}（${row.username}）的密码吗？重置后旧密码立即失效，将生成新的初始密码。`,
      icon: 'warning',
      okText: '确认重置',
    });
    const res = await usersApi.resetPassword(row.id);
    createdPassword.value = res.initialPassword;
    createdUsername.value = row.username;
  } catch (e) {
    if (e !== 'cancel' && e !== 'close') message.error(errMsg(e));
  }
}

// ---------- Excel 导入 ----------
const importOpen = ref(false);
const importFile = ref<File | null>(null);
const importLoading = ref(false);
interface ImportResult {
  batchId: string;
  totalRows: number;
  successRows: number;
  failedRows: number;
  initialPasswords: { username: string; password: string }[];
  errors: { row: number; username?: string; error: string }[];
}
const importResult = ref<ImportResult | null>(null);

function openImport(): void {
  importFile.value = null;
  importResult.value = null;
  importOpen.value = true;
}

/** AntD 手动上传：捕获 File 并阻止自动上传 */
function beforeUpload(file: File): boolean {
  importFile.value = file;
  return false;
}

function onRemove(): void {
  importFile.value = null;
}

async function submitImport(): Promise<void> {
  if (!importFile.value) {
    message.warning('请先选择 Excel 文件');
    return;
  }
  importLoading.value = true;
  try {
    importResult.value = await usersApi.import(importFile.value);
    message.success('导入完成');
    void load();
  } catch (e) {
    message.error(errMsg(e));
  } finally {
    importLoading.value = false;
  }
}

const passwordListText = computed(() => {
  const r = importResult.value;
  if (!r) return '';
  return r.initialPasswords.map((p) => `${p.username} ${p.password}`).join('\n');
});

async function copyAllPasswords(): Promise<void> {
  if (passwordListText.value) await copyText(passwordListText.value);
}
</script>

<template>
  <PageHeader title="用户管理" subtitle="账号创建、Excel 批量导入、禁用/启用与密码重置" />

  <a-card class="block">
    <div class="toolbar">
      <a-input
        v-model:value="filters.keyword"
        placeholder="学号/工号、姓名"
        allow-clear
        style="width: 200px"
        @keyup.enter="onSearch"
      />
      <a-select
        v-model:value="filters.role"
        placeholder="角色"
        allow-clear
        style="width: 120px"
        :options="roleOptions"
      />
      <a-select
        v-model:value="filters.status"
        placeholder="状态"
        allow-clear
        style="width: 120px"
        :options="[
          { label: '正常', value: 'ACTIVE' },
          { label: '已禁用', value: 'DISABLED' },
        ]"
      />
      <a-button type="primary" @click="onSearch">查询</a-button>
      <div class="toolbar-spacer" />
      <a-button @click="openImport">Excel 导入</a-button>
      <a-button type="primary" @click="openCreate">新建账号</a-button>
    </div>

    <div class="download-row">
      <span class="tip">下载：</span>
      <a class="dl-link" :href="statsApi.importTemplateUrl">导入模板</a>
      <span class="tip">|</span>
      <a class="dl-link" :href="statsApi.usersExportUrl">导出全部用户</a>
    </div>

    <a-table
      :columns="columns"
      :data-source="items"
      :loading="loading"
      :pagination="false"
      row-key="id"
      :scroll="{ x: 1100 }"
    >
      <template #bodyCell="{ column, record }">
        <template v-if="column.key === 'role'">{{ roleLabels[record.role as string] ?? record.role }}</template>
        <template v-else-if="column.key === 'className'">{{ record.className ?? '—' }}</template>
        <template v-else-if="column.key === 'status'"><StatusTag :status="record.status" /></template>
        <template v-else-if="column.key === 'lastLoginAt'">{{ fmtTime(record.lastLoginAt) }}</template>
        <template v-else-if="column.key === 'action'">
          <a-button type="link" size="small" class="op-link" @click="openEdit(record as UserRow)">编辑</a-button>
          <a-button v-if="record.status === 'ACTIVE'" type="link" size="small" class="op-link op-danger" @click="disableUser(record as UserRow)">禁用</a-button>
          <a-button v-else type="link" size="small" class="op-link op-success" @click="enableUser(record as UserRow)">启用</a-button>
          <a-button type="link" size="small" class="op-link op-warning" @click="resetPassword(record as UserRow)">重置密码</a-button>
        </template>
      </template>
      <template #emptyText><EmptyState description="没有符合条件的用户" /></template>
    </a-table>

    <div class="pager">
      <AppPagination v-model:page="page" :page-size="pageSize" :total="total" @change="load" />
    </div>
  </a-card>

  <!-- 新建对话框 -->
  <a-modal v-model:open="createOpen" title="新建账号" :width="480">
    <a-form ref="createFormRef" :model="createForm" :rules="createRules" :label-col="{ style: { width: '100px' } }">
      <a-form-item label="学号 / 工号" name="username">
        <a-input v-model:value="createForm.username" placeholder="登录账号，创建后不可修改" />
      </a-form-item>
      <a-form-item label="姓名" name="name">
        <a-input v-model:value="createForm.name" />
      </a-form-item>
      <a-form-item label="角色" name="role">
        <a-select v-model:value="createForm.role" style="width: 100%" :options="roleOptions" />
      </a-form-item>
      <a-form-item label="班级">
        <a-input v-model:value="createForm.className" placeholder="学生选填" />
      </a-form-item>
      <a-form-item label="邮箱">
        <a-input v-model:value="createForm.email" placeholder="选填" />
      </a-form-item>
    </a-form>
    <template #footer>
      <a-button @click="createOpen = false">取消</a-button>
      <a-button type="primary" :loading="createLoading" @click="submitCreate">创建</a-button>
    </template>
  </a-modal>

  <!-- 初始密码弹窗（一次性展示） -->
  <a-modal
    :open="!!createdPassword"
    title="初始密码（仅本次展示）"
    :width="440"
    @cancel="createdPassword = ''"
  >
    <a-alert type="warning" show-icon message="请立即复制并告知用户，关闭后不再显示。" />
    <div class="pwd-box">
      <div class="pwd-line"><span class="pwd-label">账号</span><b>{{ createdUsername }}</b></div>
      <div class="pwd-line"><span class="pwd-label">初始密码</span><b class="pwd">{{ createdPassword }}</b></div>
    </div>
    <template #footer>
      <a-button type="primary" @click="copyText(`${createdUsername} ${createdPassword}`)">复制账号和密码</a-button>
      <a-button @click="createdPassword = ''">我已保存，关闭</a-button>
    </template>
  </a-modal>

  <!-- 编辑对话框 -->
  <a-modal v-model:open="editOpen" title="编辑用户" :width="480">
    <a-form ref="editFormRef" :model="editForm" :rules="editRules" :label-col="{ style: { width: '100px' } }">
      <a-form-item label="姓名" name="name">
        <a-input v-model:value="editForm.name" />
      </a-form-item>
      <a-form-item label="角色" name="role">
        <a-select v-model:value="editForm.role" style="width: 100%" :options="roleOptions" />
      </a-form-item>
      <a-form-item label="班级">
        <a-input v-model:value="editForm.className" />
      </a-form-item>
      <a-form-item label="邮箱">
        <a-input v-model:value="editForm.email" />
      </a-form-item>
    </a-form>
    <template #footer>
      <a-button @click="editOpen = false">取消</a-button>
      <a-button type="primary" :loading="editLoading" @click="submitEdit">保存</a-button>
    </template>
  </a-modal>

  <!-- Excel 导入对话框 -->
  <a-modal v-model:open="importOpen" title="Excel 批量导入" :width="640">
    <a-alert
      type="info"
      class="mb8"
      message="请使用标准导入模板上传；导入成功后将展示全部初始密码，仅此一次。"
    />
    <a-upload-dragger accept=".xlsx,.xls" :before-upload="beforeUpload" @remove="onRemove">
      <p class="ant-upload-drag-icon">
        <span class="drag-icon">⬆️</span>
      </p>
      <p class="ant-upload-text">拖拽文件到此处，或点击选择</p>
      <p class="ant-upload-hint">仅支持 .xlsx / .xls</p>
    </a-upload-dragger>
    <div class="download-row">
      <a class="dl-link" :href="statsApi.importTemplateUrl">下载导入模板</a>
    </div>

    <template v-if="importResult">
      <a-divider />
      <a-descriptions :column="3" bordered>
        <a-descriptions-item label="总行数">{{ importResult.totalRows }}</a-descriptions-item>
        <a-descriptions-item label="成功">
          <span class="ok-text">{{ importResult.successRows }}</span>
        </a-descriptions-item>
        <a-descriptions-item label="失败">
          <span :class="importResult.failedRows > 0 ? 'bad-text' : ''">{{ importResult.failedRows }}</span>
        </a-descriptions-item>
      </a-descriptions>

      <template v-if="importResult.initialPasswords.length > 0">
        <h4 class="sec-title">初始密码列表</h4>
        <a-table :columns="pwdColumns" :data-source="importResult.initialPasswords" :pagination="false" size="small" :scroll="{ y: 220 }" row-key="username" />
        <a-button size="small" class="mt8" @click="copyAllPasswords">复制全部</a-button>
      </template>

      <template v-if="importResult.errors.length > 0">
        <h4 class="sec-title">失败行明细</h4>
        <a-table :columns="errColumns" :data-source="importResult.errors" :pagination="false" size="small" :scroll="{ y: 220 }" row-key="row" />
      </template>
    </template>

    <template #footer>
      <a-button @click="importOpen = false">关闭</a-button>
      <a-button type="primary" :loading="importLoading" @click="submitImport">开始导入</a-button>
    </template>
  </a-modal>
</template>

<style scoped>
.block {
  border-radius: var(--sasu-radius-base);
  box-shadow: var(--sasu-shadow-card);
}
.toolbar {
  display: flex;
  gap: 8px;
  align-items: center;
  margin-bottom: 12px;
}
.toolbar-spacer {
  flex: 1;
}
.download-row {
  display: flex;
  gap: 8px;
  align-items: center;
  margin-bottom: 12px;
}
.dl-link {
  color: var(--sasu-color-primary);
  text-decoration: none;
  font-size: 13px;
}
.dl-link:hover {
  text-decoration: underline;
}
.tip {
  color: var(--sasu-text-secondary);
  font-size: 12px;
}
.pager {
  margin-top: 12px;
  display: flex;
  justify-content: flex-end;
}
.pwd-box {
  margin-top: 12px;
  background: var(--sasu-bg-page);
  border-radius: var(--sasu-radius-base);
  padding: 12px;
}
.pwd-line {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 4px 0;
}
.pwd-label {
  width: 72px;
  color: var(--sasu-text-secondary);
  font-size: 13px;
}
.pwd {
  font-variant-numeric: tabular-nums;
  letter-spacing: 1px;
}
.mb8 {
  margin-bottom: 8px;
}
.mt8 {
  margin-top: 8px;
}
.sec-title {
  margin: 16px 0 8px;
  font-size: 14px;
}
.ok-text {
  color: var(--sasu-color-success);
  font-weight: 600;
}
.bad-text {
  color: var(--sasu-color-danger);
  font-weight: 600;
}
.op-link {
  padding: 0;
}
.op-danger {
  color: var(--sasu-color-danger);
}
.op-success {
  color: var(--sasu-color-success);
}
.op-warning {
  color: var(--sasu-color-warning);
}
.drag-icon {
  font-size: 28px;
}
</style>
