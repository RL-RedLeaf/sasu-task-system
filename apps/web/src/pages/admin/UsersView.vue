<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import type { FormInstance, FormRules, UploadFile } from 'element-plus';
import type { NormalizedError } from '@/api/http';
import { statsApi, usersApi, type UserRow } from '@/api/admin';
import PageHeader from '@/components/PageHeader.vue';
import StatusTag from '@/components/StatusTag.vue';
import EmptyState from '@/components/EmptyState.vue';

function errMsg(e: unknown): string {
  return (e as NormalizedError).friendlyMessage ?? '操作失败';
}

function fmtTime(value: string | null): string {
  return value ? new Date(value).toLocaleString('zh-CN') : '—';
}

async function copyText(text: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
    ElMessage.success('已复制到剪贴板');
  } catch {
    ElMessage.error('复制失败，请手动选择复制');
  }
}

const roleLabels: Record<string, string> = { STUDENT: '学生', TEACHER: '教师', ADMIN: '管理员' };

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
    ElMessage.error(errMsg(e));
  } finally {
    loading.value = false;
  }
}

function onSearch(): void {
  page.value = 1;
  void load();
}

function onPageChange(): void {
  void load();
}

onMounted(() => void load());

// ---------- 新建 ----------
const createVisible = ref(false);
const createFormRef = ref<FormInstance>();
const createLoading = ref(false);
const createForm = reactive({ username: '', name: '', role: 'STUDENT', className: '', email: '' });
const createdPassword = ref('');
const createdUsername = ref('');

const createRules: FormRules = {
  username: [{ required: true, message: '请输入学号 / 工号', trigger: 'blur' }],
  name: [{ required: true, message: '请输入姓名', trigger: 'blur' }],
  role: [{ required: true, message: '请选择角色', trigger: 'change' }],
};

function openCreate(): void {
  Object.assign(createForm, { username: '', name: '', role: 'STUDENT', className: '', email: '' });
  createdPassword.value = '';
  createdUsername.value = '';
  createVisible.value = true;
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
    createVisible.value = false;
    void load();
  } catch (e) {
    ElMessage.error(errMsg(e));
  } finally {
    createLoading.value = false;
  }
}

// ---------- 编辑 ----------
const editVisible = ref(false);
const editFormRef = ref<FormInstance>();
const editLoading = ref(false);
const editId = ref('');
const editForm = reactive({ name: '', role: 'STUDENT', className: '', email: '' });

const editRules: FormRules = {
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
  editVisible.value = true;
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
    ElMessage.success('已保存');
    editVisible.value = false;
    void load();
  } catch (e) {
    ElMessage.error(errMsg(e));
  } finally {
    editLoading.value = false;
  }
}

// ---------- 禁用 / 启用 ----------
async function disableUser(row: UserRow): Promise<void> {
  try {
    const { value } = await ElMessageBox.prompt(
      '禁用后该用户将无法登录，请填写禁用原因（必填）。',
      `禁用账号 ${row.name}`,
      {
        confirmButtonText: '确认禁用',
        cancelButtonText: '取消',
        inputPlaceholder: '请输入禁用原因',
        inputValidator: (v: string) => (v && v.trim() ? true : '禁用原因不能为空'),
      },
    );
    await usersApi.disable(row.id, value.trim());
    ElMessage.success('已禁用');
    void load();
  } catch (e) {
    if (e !== 'cancel' && e !== 'close') ElMessage.error(errMsg(e));
  }
}

async function enableUser(row: UserRow): Promise<void> {
  try {
    await ElMessageBox.confirm(`确认启用账号 ${row.name} 吗？`, '启用账号', {
      confirmButtonText: '确认启用',
      cancelButtonText: '取消',
      type: 'warning',
    });
    await usersApi.enable(row.id);
    ElMessage.success('已启用');
    void load();
  } catch (e) {
    if (e !== 'cancel' && e !== 'close') ElMessage.error(errMsg(e));
  }
}

// ---------- 重置密码 ----------
async function resetPassword(row: UserRow): Promise<void> {
  try {
    await ElMessageBox.confirm(
      `确认重置 ${row.name}（${row.username}）的密码吗？重置后旧密码立即失效，将生成新的初始密码。`,
      '重置密码',
      { confirmButtonText: '确认重置', cancelButtonText: '取消', type: 'warning' },
    );
    const res = await usersApi.resetPassword(row.id);
    createdPassword.value = res.initialPassword;
    createdUsername.value = row.username;
  } catch (e) {
    if (e !== 'cancel' && e !== 'close') ElMessage.error(errMsg(e));
  }
}

// ---------- Excel 导入 ----------
const importVisible = ref(false);
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
  importVisible.value = true;
}

function onFileChange(file: UploadFile): void {
  importFile.value = (file.raw as File) ?? null;
}

function onFileRemove(): void {
  importFile.value = null;
}

async function submitImport(): Promise<void> {
  if (!importFile.value) {
    ElMessage.warning('请先选择 Excel 文件');
    return;
  }
  importLoading.value = true;
  try {
    importResult.value = await usersApi.import(importFile.value);
    ElMessage.success('导入完成');
    void load();
  } catch (e) {
    ElMessage.error(errMsg(e));
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

  <el-card shadow="never" class="block">
    <div class="toolbar">
      <el-input
        v-model="filters.keyword"
        placeholder="学号/工号、姓名"
        clearable
        style="width: 200px"
        @keyup.enter="onSearch"
      />
      <el-select v-model="filters.role" placeholder="角色" clearable style="width: 120px">
        <el-option label="学生" value="STUDENT" />
        <el-option label="教师" value="TEACHER" />
        <el-option label="管理员" value="ADMIN" />
      </el-select>
      <el-select v-model="filters.status" placeholder="状态" clearable style="width: 120px">
        <el-option label="正常" value="ACTIVE" />
        <el-option label="已禁用" value="DISABLED" />
      </el-select>
      <el-button type="primary" @click="onSearch">查询</el-button>
      <div class="toolbar-spacer" />
      <el-button @click="openImport">Excel 导入</el-button>
      <el-button type="primary" @click="openCreate">新建账号</el-button>
    </div>

    <div class="download-row">
      <span class="tip">下载：</span>
      <a class="dl-link" :href="statsApi.importTemplateUrl">导入模板</a>
      <span class="tip">|</span>
      <a class="dl-link" :href="statsApi.usersExportUrl">导出全部用户</a>
    </div>

    <el-table v-loading="loading" :data="items" stripe>
      <el-table-column prop="username" label="学号 / 工号" width="140" />
      <el-table-column prop="name" label="姓名" width="110" />
      <el-table-column prop="role" label="角色" width="90">
        <template #default="{ row }">{{ roleLabels[row.role as string] ?? row.role }}</template>
      </el-table-column>
      <el-table-column prop="className" label="班级" min-width="120">
        <template #default="{ row }">{{ row.className ?? '—' }}</template>
      </el-table-column>
      <el-table-column prop="status" label="状态" width="90">
        <template #default="{ row }"><StatusTag :status="row.status" /></template>
      </el-table-column>
      <el-table-column prop="violationCount" label="违约次数" width="90" align="center" />
      <el-table-column prop="penaltyDebt" label="欠分" width="90" align="center" />
      <el-table-column prop="lastLoginAt" label="最后登录" width="170">
        <template #default="{ row }">{{ fmtTime(row.lastLoginAt) }}</template>
      </el-table-column>
      <el-table-column label="操作" width="240" fixed="right">
        <template #default="{ row }">
          <el-button link type="primary" size="small" @click="openEdit(row)">编辑</el-button>
          <el-button v-if="row.status === 'ACTIVE'" link type="danger" size="small" @click="disableUser(row)">禁用</el-button>
          <el-button v-else link type="success" size="small" @click="enableUser(row)">启用</el-button>
          <el-button link type="warning" size="small" @click="resetPassword(row)">重置密码</el-button>
        </template>
      </el-table-column>
      <template #empty><EmptyState description="没有符合条件的用户" /></template>
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

  <!-- 新建对话框 -->
  <el-dialog v-model="createVisible" title="新建账号" width="480px">
    <el-form ref="createFormRef" :model="createForm" :rules="createRules" label-width="100px">
      <el-form-item label="学号 / 工号" prop="username">
        <el-input v-model="createForm.username" placeholder="登录账号，创建后不可修改" />
      </el-form-item>
      <el-form-item label="姓名" prop="name">
        <el-input v-model="createForm.name" />
      </el-form-item>
      <el-form-item label="角色" prop="role">
        <el-select v-model="createForm.role" style="width: 100%">
          <el-option label="学生" value="STUDENT" />
          <el-option label="教师" value="TEACHER" />
          <el-option label="管理员" value="ADMIN" />
        </el-select>
      </el-form-item>
      <el-form-item label="班级">
        <el-input v-model="createForm.className" placeholder="学生选填" />
      </el-form-item>
      <el-form-item label="邮箱">
        <el-input v-model="createForm.email" placeholder="选填" />
      </el-form-item>
    </el-form>
    <template #footer>
      <el-button @click="createVisible = false">取消</el-button>
      <el-button type="primary" :loading="createLoading" @click="submitCreate">创建</el-button>
    </template>
  </el-dialog>

  <!-- 初始密码弹窗（一次性展示） -->
  <el-dialog
    :model-value="!!createdPassword"
    title="初始密码（仅本次展示）"
    width="440px"
    @update:model-value="createdPassword = ''"
  >
    <el-alert type="warning" :closable="false" show-icon title="请立即复制并告知用户，关闭后不再显示。" />
    <div class="pwd-box">
      <div class="pwd-line"><span class="pwd-label">账号</span><b>{{ createdUsername }}</b></div>
      <div class="pwd-line"><span class="pwd-label">初始密码</span><b class="pwd">{{ createdPassword }}</b></div>
    </div>
    <template #footer>
      <el-button type="primary" @click="copyText(`${createdUsername} ${createdPassword}`)">复制账号和密码</el-button>
      <el-button @click="createdPassword = ''">我已保存，关闭</el-button>
    </template>
  </el-dialog>

  <!-- 编辑对话框 -->
  <el-dialog v-model="editVisible" title="编辑用户" width="480px">
    <el-form ref="editFormRef" :model="editForm" :rules="editRules" label-width="100px">
      <el-form-item label="姓名" prop="name">
        <el-input v-model="editForm.name" />
      </el-form-item>
      <el-form-item label="角色" prop="role">
        <el-select v-model="editForm.role" style="width: 100%">
          <el-option label="学生" value="STUDENT" />
          <el-option label="教师" value="TEACHER" />
          <el-option label="管理员" value="ADMIN" />
        </el-select>
      </el-form-item>
      <el-form-item label="班级">
        <el-input v-model="editForm.className" />
      </el-form-item>
      <el-form-item label="邮箱">
        <el-input v-model="editForm.email" />
      </el-form-item>
    </el-form>
    <template #footer>
      <el-button @click="editVisible = false">取消</el-button>
      <el-button type="primary" :loading="editLoading" @click="submitEdit">保存</el-button>
    </template>
  </el-dialog>

  <!-- Excel 导入对话框 -->
  <el-dialog v-model="importVisible" title="Excel 批量导入" width="640px">
    <el-alert
      type="info"
      :closable="false"
      class="mb8"
      title="请使用标准导入模板上传；导入成功后将展示全部初始密码，仅此一次。"
    />
    <el-upload
      drag
      accept=".xlsx,.xls"
      :auto-upload="false"
      :limit="1"
      :on-change="onFileChange"
      :on-remove="onFileRemove"
    >
      <div class="el-upload__text">拖拽文件到此处，或<em>点击选择</em></div>
      <template #tip>
        <div class="el-upload__tip">仅支持 .xlsx / .xls</div>
      </template>
    </el-upload>
    <div class="download-row">
      <a class="dl-link" :href="statsApi.importTemplateUrl">下载导入模板</a>
    </div>

    <template v-if="importResult">
      <el-divider />
      <el-descriptions :column="3" border>
        <el-descriptions-item label="总行数">{{ importResult.totalRows }}</el-descriptions-item>
        <el-descriptions-item label="成功">
          <span class="ok-text">{{ importResult.successRows }}</span>
        </el-descriptions-item>
        <el-descriptions-item label="失败">
          <span :class="importResult.failedRows > 0 ? 'bad-text' : ''">{{ importResult.failedRows }}</span>
        </el-descriptions-item>
      </el-descriptions>

      <template v-if="importResult.initialPasswords.length > 0">
        <h4 class="sec-title">初始密码列表</h4>
        <el-table :data="importResult.initialPasswords" size="small" max-height="220">
          <el-table-column prop="username" label="学号 / 工号" width="160" />
          <el-table-column prop="password" label="初始密码" />
        </el-table>
        <el-button size="small" class="mt8" @click="copyAllPasswords">复制全部</el-button>
      </template>

      <template v-if="importResult.errors.length > 0">
        <h4 class="sec-title">失败行明细</h4>
        <el-table :data="importResult.errors" size="small" max-height="220">
          <el-table-column prop="row" label="行号" width="80" />
          <el-table-column prop="username" label="学号 / 工号" width="160">
            <template #default="{ row }">{{ row.username ?? '—' }}</template>
          </el-table-column>
          <el-table-column prop="error" label="失败原因" />
        </el-table>
      </template>
    </template>

    <template #footer>
      <el-button @click="importVisible = false">关闭</el-button>
      <el-button type="primary" :loading="importLoading" @click="submitImport">开始导入</el-button>
    </template>
  </el-dialog>
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
  border-radius: 8px;
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
</style>
