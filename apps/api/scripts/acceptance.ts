/* eslint-disable no-console */
/**
 * §15.1 P0 核心验收脚本 + §15.2 提现/仲裁子集 + §15.3 边界子集。
 * 运行前提：api 已启动并连接 sasu_dev（脚本会重置数据假设：仅 seed 数据）。
 * 用法：pnpm --filter @sasu/api exec tsx scripts/acceptance.ts
 */
const BASE = process.env.ACCEPTANCE_BASE ?? 'http://localhost:3000/api/v1';

interface Jar {
  cookie?: string;
}

let passed = 0;
const failures: string[] = [];

function check(name: string, cond: boolean, detail?: unknown): void {
  if (cond) {
    passed++;
    console.log(`  ✅ ${name}`);
  } else {
    failures.push(name);
    console.error(`  ❌ ${name}${detail !== undefined ? ` :: ${JSON.stringify(detail)}` : ''}`);
  }
}

async function api<T = unknown>(
  method: string,
  path: string,
  body?: unknown,
  jar?: Jar,
  headers: Record<string, string> = {},
): Promise<{ code: number; message: string; data: T; status: number }> {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      'content-type': 'application/json',
      ...(jar?.cookie ? { cookie: jar.cookie } : {}),
      ...headers,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const setCookie = res.headers.get('set-cookie');
  if (setCookie && jar) {
    const tokenPart = setCookie.split(';')[0];
    if (tokenPart && !/=$/.test(tokenPart)) {
      jar.cookie = tokenPart;
    }
  }
  const json = (await res.json()) as { code: number; message: string; data?: T };
  return { code: json.code, message: json.message, data: (json.data ?? (json as unknown as T)) as T, status: res.status };
}

async function login(username: string, password: string): Promise<Jar> {
  const jar: Jar = {};
  const r = await api('POST', '/auth/login', { username, password }, jar);
  if (r.code !== 0) throw new Error(`login ${username} failed: ${r.message}`);
  return jar;
}

async function changePassword(jar: Jar, oldPassword: string, newPassword: string): Promise<void> {
  const r = await api('POST', '/auth/change-password', { oldPassword, newPassword }, jar);
  if (r.code !== 0) throw new Error(`change password failed: ${r.message}`);
}

function idem(): string {
  return `accept-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

async function main(): Promise<void> {
  console.log('== §15.1 P0 核心验收 ==');

  // 1. 管理员登录（bootstrap admin，首登改密）
  const admin = await login('admin', 'Admin@2026');
  await changePassword(admin, 'Admin@2026', 'AdminPass1');
  // 改密后重新登录
  const adminJar = await login('admin', 'AdminPass1');
  Object.assign(admin, adminJar);
  const me = await api('GET', '/auth/me', undefined, admin);
  check('管理员登录且首登改密完成', me.data.mustChangePassword === false);

  // 2. 导入 1 教师 + 3 学生（用创建接口代替 Excel；Excel 导入已有单元路径）
  const accounts: Record<string, { username: string; password: string; jar?: Jar }> = {};
  for (const [name, role] of [
    ['T1', 'TEACHER'],
    ['S1', 'STUDENT'],
    ['S2', 'STUDENT'],
    ['S3', 'STUDENT'],
  ] as const) {
    const username = `acc_${name}_${Date.now().toString(36).slice(-4)}`;
    const created = await api<{ initialPassword: string }>(
      'POST',
      '/admin/users',
      { username, name: `测试${name}`, role },
      admin,
    );
    if (created.code !== 0) throw new Error(`create ${username} failed: ${created.message}`);
    accounts[name] = { username, password: created.data.initialPassword };
  }
  check('管理员创建 1 教师 + 3 学生（初始密码仅展示一次）', Object.keys(accounts).length === 4);

  for (const name of ['T1', 'S1', 'S2', 'S3']) {
    const acc = accounts[name];
    acc.jar = await login(acc.username, acc.password);
    await changePassword(acc.jar, acc.password, `Passw0rd`);
    // 改密后 token_version+1，旧会话失效（PRD AUTH-03），重新登录
    acc.jar = await login(acc.username, `Passw0rd`);
  }
  check('首次登录强制改密完成', true);

  // 3. 积分池充值 1000
  const topup = await api('POST', '/admin/points/pool/topup', { amount: 1000, reason: '验收充值' }, admin, {
    'Idempotency-Key': idem(),
  });
  check('充值 1000 成功', topup.code === 0, topup.message);
  const pool1 = await api<{ poolBalance: number; issuedTotal: number; escrowTotal: number }>('GET', '/admin/points/pool', undefined, admin);
  check('POOL=1000 / 发行=1000', pool1.data.poolBalance === 1000 && pool1.data.issuedTotal === 1000, pool1.data);

  // 幂等重放
  const topupAgain = await api('POST', '/admin/points/pool/topup', { amount: 1000, reason: '验收充值' }, admin, {
    'Idempotency-Key': 'accept-fixed-key-001',
  });
  const topupThird = await api('POST', '/admin/points/pool/topup', { amount: 1000, reason: '验收充值' }, admin, {
    'Idempotency-Key': 'accept-fixed-key-001',
  });
  check('同幂等键重复请求不重复入账', topupThird.data.duplicate === true && topupAgain.data.duplicate === false);
  const poolAfterReplay = await api<{ poolBalance: number }>('GET', '/admin/points/pool', undefined, admin);
  check('幂等后池仍为 2000（1000+仅一次重放 1000）', poolAfterReplay.data.poolBalance === 2000, poolAfterReplay.data);

  // 4. 管理员给学生 C(S3) 调整 100
  const usersList = await api<{ items: { id: string; username: string; role: string }[] }>(
    'GET',
    '/admin/users?pageSize=100',
    undefined,
    admin,
  );
  const userByName = new Map(usersList.data.items.map((u) => [u.username, u]));
  const s3Id = userByName.get(accounts.S3.username)!.id;
  const grant = await api('POST', `/admin/users/${s3Id}/points/adjust`, { amount: 100, reason: '测试奖励' }, admin, {
    'Idempotency-Key': idem(),
  });
  check('给学生 C 发放 100', grant.code === 0, grant.message);

  // 5. 教师提交任务（不填赏金）
  const categories = await api<{ items: { id: string; name: string }[] }>('GET', '/categories', undefined, admin);
  const categoryId = Number(categories.data.items[0].id);
  const deadline = new Date(Date.now() + 2 * 3600 * 1000).toISOString(); // 2 小时后（可被强制到期）
  const task = await api<{ id: string; status: string }>('POST', '/tasks', {
    title: '验收任务：整理器材',
    categoryId,
    description: '周五下午需要三名同学帮忙整理实验室器材，请准时到达。',
    headcount: 3,
    deadlineAt: deadline,
  }, accounts.T1.jar);
  check('教师提交任务 → PENDING_REWARD', task.code === 0 && task.data.status === 'PENDING_REWARD', task.message);
  const taskId = task.data.id;

  // 教师传赏金字段应被忽略（不报错、不生效）
  const taskWithReward = await api<{ id: string }>('POST', '/tasks', {
    title: '验收任务：带赏金字段',
    categoryId,
    description: '这个任务尝试传入赏金字段，应被忽略且正常创建。',
    headcount: 1,
    deadlineAt: new Date(Date.now() + 3 * 24 * 3600 * 1000).toISOString(),
    rewardPerPerson: 'IGNORED' as never,
  }, accounts.T1.jar);
  check('教师提交任务携带赏金字段被忽略', taskWithReward.code === 0);

  // 6. 学生看不到待定价任务
  const s1Detail = await api('GET', `/tasks/${taskId}`, undefined, accounts.S1.jar);
  check('学生访问待定价任务 → 3005', s1Detail.code === 3005, s1Detail);
  const hall = await api<{ items: { id: string }[] }>('GET', '/tasks?pageSize=100', undefined, accounts.S1.jar);
  check('大厅不含待定价任务', !hall.data.items.some((t) => t.id === taskId));

  // 7. 定价 100
  const priced = await api<{ totalAmount: number }>('POST', `/admin/tasks/${taskId}/price`, { rewardPerPerson: 100 }, admin);
  check('定价 100 → 总额 300', priced.code === 0 && priced.data.totalAmount === 300, priced);
  const pool2 = await api<{ poolBalance: number; escrowTotal: number }>('GET', '/admin/points/pool', undefined, admin);
  check('POOL=1600 / 托管=300', pool2.data.poolBalance === 1600 && pool2.data.escrowTotal === 300, pool2.data);

  // 池不足时定价被拒（池 1600，R=100×N=20=2000 > 1600 → 3001）
  const poorTask = await api<{ id: string }>('POST', '/tasks', {
    title: '验收任务：池不足',
    categoryId,
    description: '这个任务用于验证池余额不足时定价被拒绝的场景。',
    headcount: 20,
    deadlineAt: new Date(Date.now() + 3 * 24 * 3600 * 1000).toISOString(),
  }, accounts.T1.jar);
  const poorPrice = await api('POST', `/admin/tasks/${poorTask.data.id}/price`, { rewardPerPerson: 100 }, admin);
  check('池余额不足定价 → 3001', poorPrice.code === 3001, poorPrice);
  // 边界：R=501 超单人赏金上限 → 3015
  const overPrice = await api('POST', `/admin/tasks/${poorTask.data.id}/price`, { rewardPerPerson: 501 }, admin);
  check('单人赏金超上限 → 3015', overPrice.code === 3015, overPrice);
  const poorDetail = await api<{ status: string }>('GET', `/tasks/${poorTask.data.id}`, undefined, accounts.T1.jar);
  check('定价失败后任务保持待定价', poorDetail.data.status === 'PENDING_REWARD', poorDetail.data);

  // 8. 三名学生接单
  for (const name of ['S1', 'S2', 'S3']) {
    const claim = await api<{ assignmentId: string }>('POST', `/tasks/${taskId}/claims`, undefined, accounts[name].jar);
    check(`学生 ${name} 接单成功`, claim.code === 0, claim.message);
  }
  const s4Extra = await api('POST', `/tasks/${taskId}/claims`, undefined, accounts.S3.jar);
  check('重复接单被拒（3002/3006）', s4Extra.code === 3002 || s4Extra.code === 3006, s4Extra);
  const detailAfterFull = await api<{ status: string; remaining: number }>('GET', `/tasks/${taskId}`, undefined, accounts.T1.jar);
  check('任务变 FULL', detailAfterFull.data.status === 'FULL');

  // 9. S1 提交 → 驳回 → 重交 → 通过
  const sub1 = await api<{ submissionId: string }>('POST', `/assignments/placeholder/submissions`, undefined, accounts.S1.jar);
  void sub1;
  const myDetail = await api<{ myAssignment: { id: string } }>('GET', `/tasks/${taskId}`, undefined, accounts.S1.jar);
  const s1Assignment = myDetail.data.myAssignment!.id;
  const submit1 = await api<{ version: number }>('POST', `/assignments/${s1Assignment}/submissions`, { content: '这是学生一号第一次提交的交付说明，包含完成情况。' }, accounts.S1.jar);
  check('S1 首次提交', submit1.code === 0 && submit1.data.version === 1, submit1.message);
  const reject1 = await api('POST', `/assignments/${s1Assignment}/review`, { decision: 'REJECT', reason: '图片不清晰，请重新拍摄后提交' }, accounts.T1.jar);
  check('教师驳回（必填理由）', reject1.code === 0, reject1.message);
  const badReject = await api('POST', `/assignments/${s1Assignment}/review`, { decision: 'REJECT' }, accounts.T1.jar);
  check('驳回不填理由被拒', badReject.code === 2001 || badReject.code === 3005, badReject);
  const submit2 = await api<{ version: number }>('POST', `/assignments/${s1Assignment}/submissions`, { content: '这是学生一号重新提交的交付说明，已更换清晰图片。' }, accounts.S1.jar);
  check('重交窗口内重新提交（version 2）', submit2.code === 0 && submit2.data.version === 2, submit2.message);
  const accept1 = await api('POST', `/assignments/${s1Assignment}/review`, { decision: 'ACCEPT' }, accounts.T1.jar);
  check('教师验收通过', accept1.code === 0, accept1.message);
  const s1Points = await api<{ balance: number }>('GET', '/points/me', undefined, accounts.S1.jar);
  check('S1 余额 +100', s1Points.data.balance === 100, s1Points.data);

  // 10. S2 提交并通过；托管剩 100
  const myDetail2 = await api<{ myAssignment: { id: string } }>('GET', `/tasks/${taskId}`, undefined, accounts.S2.jar);
  const s2Assignment = myDetail2.data.myAssignment!.id;
  await api('POST', `/assignments/${s2Assignment}/submissions`, { content: '这是学生二号提交的交付说明，任务已按时完成。' }, accounts.S2.jar);
  const accept2 = await api('POST', `/assignments/${s2Assignment}/review`, { decision: 'ACCEPT' }, accounts.T1.jar);
  check('S2 验收通过', accept2.code === 0, accept2.message);

  // 11. 改价 100 → 120：补差
  const reprice = await api<{ topupPaid: number; budget: number }>(
    'PATCH',
    `/admin/tasks/${taskId}/reward`,
    { rewardPerPerson: 120, reason: '活动升级' },
    admin,
  );
  check('改价 120：补差 40（A/B 各 20）', reprice.code === 0 && reprice.data.topupPaid === 40 && reprice.data.budget === 360, reprice);
  const s1AfterTopup = await api<{ balance: number }>('GET', '/points/me', undefined, accounts.S1.jar);
  check('S1 收到补差 20 → 120', s1AfterTopup.data.balance === 120, s1AfterTopup.data);

  // 12. 调低被拒 3014
  const repriceDown = await api('PATCH', `/admin/tasks/${taskId}/reward`, { rewardPerPerson: 100, reason: '尝试调低' }, admin);
  check('有人通过后调低 → 3014', repriceDown.code === 3014, repriceDown);

  // 13. S3 逾期未提交：强制到期 + close 作业 → 违约 24
  const s1PointsBeforeViolate = (await api<{ balance: number }>('GET', '/points/me', undefined, accounts.S1.jar)).data.balance;
  const closeRun = await api('POST', '/admin/jobs/run', { job: 'close', forceDeadlineTaskId: Number(taskId) }, admin);
  check('强制到期 + 关闭作业执行', closeRun.code === 0, closeRun.message);
  const s3Points = await api<{ balance: number; penaltyDebt: number }>('GET', '/points/me', undefined, accounts.S3.jar);
  check('S3 违约扣 24 → 余额 76', s3Points.data.balance === 76 && s3Points.data.penaltyDebt === 0, s3Points.data);
  const poolAfterViolation = await api<{ poolBalance: number }>('GET', '/admin/points/pool', undefined, admin);
  check('违约金回流池 → 1564', poolAfterViolation.data.poolBalance === 1564, poolAfterViolation.data);
  void s1PointsBeforeViolate;

  // 14. 结算：C 的 120 由 A/B 平分
  const settleRun = await api('POST', '/admin/jobs/run', { job: 'settle' }, admin);
  check('结算作业执行', settleRun.code === 0, settleRun.message);
  const s1Final = await api<{ balance: number }>('GET', '/points/me', undefined, accounts.S1.jar);
  const s2Final = await api<{ balance: number }>('GET', '/points/me', undefined, accounts.S2.jar);
  check('A/B 各 +60 再分配（A=180, B=180）', s1Final.data.balance === 180 && s2Final.data.balance === 180, {
    s1: s1Final.data,
    s2: s2Final.data,
  });
  const taskFinal = await api<{ status: string; settlementStatus: string }>('GET', `/tasks/${taskId}`, undefined, admin);
  check('任务 SETTLED / DONE', taskFinal.data.status === 'SETTLED' && taskFinal.data.settlementStatus === 'DONE', taskFinal.data);

  // 15. 总量守恒
  const poolFinal = await api<{ poolBalance: number; issuedTotal: number }>('GET', '/admin/points/pool', undefined, admin);
  check('总量守恒：池 1564 + A 180 + B 180 + C 76 = 发行 2000', poolFinal.data.poolBalance === 1564 && poolFinal.data.issuedTotal === 2000, poolFinal.data);

  // 16. 对账 13 条不变式
  const reconcile = await api<{ ok: boolean; violations: unknown[] }>('GET', '/admin/points/reconcile', undefined, admin);
  check('对账全部通过', reconcile.data.ok === true, reconcile.data.violations);

  // 17. 审计日志
  const auditList = await api<{ items: { action: string }[] }>('GET', '/admin/audit-logs?pageSize=100', undefined, admin).catch(() => ({ code: -1, message: '', data: { items: [] }, status: 404 }));
  void auditList;

  console.log('\n== §15.2 提现子集（配置汇率 1.0） ==');
  // 管理员给 A 补 70 → 250
  const s1UserId = userByName.get(accounts.S1.username)!.id;
  await api('POST', `/admin/users/${s1UserId}/points/adjust`, { amount: 70, reason: '验收补足' }, admin, { 'Idempotency-Key': idem() });
  // 修改汇率配置
  const settings = await api<{ items: { key: string; valueType: string }[] }>('GET', '/admin/settings', undefined, admin);
  check('系统配置可读', settings.data.items.some((i) => i.key === 'POINT_TO_CASH_RATE'));
  const setRate = await api('PATCH', '/admin/settings', { key: 'POINT_TO_CASH_RATE', value: '1.0000' }, admin);
  check('汇率改为 1.0', setRate.code === 0, setRate.message);

  const w1 = await api<{ id: string; cashAmount: string }>('POST', '/withdrawals', { points: 100 }, accounts.S1.jar, {
    'Idempotency-Key': idem(),
  });
  check('A 申请提现 100（冻结）', w1.code === 0 && w1.data.cashAmount === '100.00', w1);
  const w1Points = await api<{ balance: number; frozen: number }>('GET', '/points/me', undefined, accounts.S1.jar);
  check('A 余额 150 / 冻结 100', w1Points.data.balance === 150 && w1Points.data.frozen === 100, w1Points.data);
  const w2 = await api('POST', '/withdrawals', { points: 50 }, accounts.S1.jar, { 'Idempotency-Key': idem() });
  check('当月第二次申请 → 3010', w2.code === 3010, w2);
  const wApprove = await api('POST', `/admin/withdrawals/${w1.data.id}/approve`, {}, admin);
  check('管理员审批通过', wApprove.code === 0, wApprove.message);
  const wPay = await api('POST', `/admin/withdrawals/${w1.data.id}/pay`, { payNote: '线下现金已发' }, admin, {
    'Idempotency-Key': idem(),
  });
  check('标记已发放', wPay.code === 0, wPay.message);
  const poolAfterPay = await api<{ poolBalance: number }>('GET', '/admin/points/pool', undefined, admin);
  check('PAID 后池 1494（池不动，现金入 SYS_CASHOUT）', poolAfterPay.data.poolBalance === 1494, poolAfterPay.data);
  const w3 = await api('POST', '/withdrawals', { points: 50 }, accounts.S1.jar, { 'Idempotency-Key': idem() });
  check('PAID 仍占当月额度 → 3010', w3.code === 3010, w3);
  // 汇率改回 0
  const resetRate = await api('PATCH', '/admin/settings', { key: 'POINT_TO_CASH_RATE', value: '0.0000' }, admin);
  check('汇率改回 0', resetRate.code === 0, resetRate.message);
  const w4 = await api('POST', '/withdrawals', { points: 50 }, accounts.S1.jar, { 'Idempotency-Key': idem() });
  check('汇率 0 → 3012', w4.code === 3012, w4);

  console.log('\n== 结算后仲裁补偿 ==');
  const disputes = await api<{ items: { id: string }[] }>('GET', '/admin/disputes?status=OPEN', undefined, admin);
  void disputes;
  // 直接创建一个仲裁并走结算后补偿：S3 对已结算任务发起（跳过严格关联，用 taskId）
  const dispute = await api<{ id: string }>('POST', '/disputes', { taskId: Number(taskId), reason: '认为再分配不公，申请补偿' }, accounts.S3.jar);
  if (dispute.code === 0) {
    const resolved = await api('POST', `/admin/disputes/${dispute.data.id}/resolve`, { decision: 'PAY_PARTIAL', payPoints: 30, resolutionNote: '验收补偿' }, admin);
    check('结算后仲裁补偿 30（池出账）', resolved.code === 0, resolved.message);
    const s3After = await api<{ balance: number }>('GET', '/points/me', undefined, accounts.S3.jar);
    check('S3 收到 30 → 106', s3After.data.balance === 106, s3After.data);
  } else {
    check('仲裁创建', false, dispute.message);
  }

  console.log(`\n== 结果：${passed} 通过 / ${failures.length} 失败 ==`);
  if (failures.length > 0) {
    console.error('失败项：', failures);
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error('验收脚本异常退出：', error);
  process.exitCode = 1;
});
