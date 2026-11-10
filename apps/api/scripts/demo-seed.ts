/* eslint-disable no-console */
/**
 * 演示数据（可直接登录体验，不走强制改密）：
 * 需要先 reset 数据库（drop → migrate → seed）且 api 正在运行（默认 http://localhost:3000）。
 * 用法：pnpm --filter @sasu/api exec tsx scripts/demo-seed.ts
 * 结果：
 *   教师 tea_demo / TeaPassw0rd（陈老师）
 *   学生 stu_demo / StuPassw0rd（李明）×2（王小红 stu_demo2 / WangPassw0rd）
 *   积分池 1000；已发布并定价的任务「图书馆搬新书上架」；一名学生已接单。
 */
const BASE = process.env.DEMO_BASE ?? 'http://localhost:3000/api/v1';

interface Jar {
  cookie?: string;
}

async function api<T = unknown>(
  method: string,
  path: string,
  body?: unknown,
  jar?: Jar,
  headers: Record<string, string> = {},
): Promise<{ code: number; message: string; data: T }> {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      ...(jar?.cookie ? { cookie: jar.cookie } : {}),
      ...headers,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const setCookie = res.headers.get('set-cookie');
  if (setCookie && jar) {
    const tokenPart = setCookie.split(';')[0];
    if (tokenPart && !/=$/.test(tokenPart)) jar.cookie = tokenPart;
  }
  const json = (await res.json()) as { code: number; message: string; data?: T };
  return { code: json.code, message: json.message, data: (json.data ?? (json as unknown as T)) as T };
}

async function login(username: string, password: string): Promise<Jar> {
  const jar: Jar = {};
  const r = await api('POST', '/auth/login', { username, password }, jar);
  if (r.code !== 0) throw new Error(`login ${username}: ${r.message}`);
  return jar;
}

async function main(): Promise<void> {
  let admin = await login('admin', 'Admin@2026');
  // 新库 admin 首登未改密会被 guard 拦截，先改密再重新登录
  const changed = await api('POST', '/auth/change-password', { oldPassword: 'Admin@2026', newPassword: 'Admin#Demo2026' }, admin);
  if (changed.code === 0) {
    admin = await login('admin', 'Admin#Demo2026');
    console.log('管理员密码已设为 Admin#Demo2026');
  } else {
    // 已改过（非首次运行），回退尝试已知密码
    admin = await login('admin', 'Admin#Demo2026');
  }
  const idem = () => `demo-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  // 1) 积分池充值
  await api('POST', '/admin/points/pool/topup', { amount: 1000, reason: '演示初始化' }, admin, {
    'Idempotency-Key': idem(),
  });

  // 2) 创建教师与学生
  const created: { username: string; password: string }[] = [];
  for (const u of [
    { username: 'tea_demo', name: '陈老师', role: 'TEACHER', className: '语文教研组' },
    { username: 'stu_demo', name: '李明', role: 'STUDENT', className: '八年级3班' },
    { username: 'stu_demo2', name: '王小红', role: 'STUDENT', className: '八年级1班' },
  ]) {
    const r = await api<{ id: string; initialPassword: string }>('POST', '/admin/users', u, admin);
    if (r.code !== 0) throw new Error(`create ${u.username}: ${r.message}`);
    created.push({ username: u.username, password: r.data.initialPassword });
  }

  // 3) 各账号改密为固定演示密码并重新登录（改密后 token_version 失效）
  const passwords: Record<string, string> = {
    tea_demo: 'TeaPassw0rd',
    stu_demo: 'StuPassw0rd',
    stu_demo2: 'WangPassw0rd',
  };
  for (const c of created) {
    const old = c.password;
    const jar = await login(c.username, old);
    await api('POST', '/auth/change-password', { oldPassword: old, newPassword: passwords[c.username] }, jar);
  }
  const teacher = await login('tea_demo', passwords.tea_demo);
  const student1 = await login('stu_demo', passwords.stu_demo);

  // 4) 教师发布任务（demo 账号无需强制改密，直接可操作）
  const cats = await api<{ items: { id: string; name: string }[] }>('GET', '/categories', undefined, teacher);
  const campus = cats.data.items.find((c) => c.name === '校园服务') ?? cats.data.items[0]!;
  const deadline = new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString();
  const task = await api<{ id: string }>(
    'POST',
    '/tasks',
    {
      title: '图书馆搬新书上架',
      categoryId: Number(campus.id),
      description: '图书馆新到一批图书需要上架，工作内容：搬运书箱、按索书号排序上架、整理书架。劳动强度中等，请穿着方便活动的服装，到场后找陈老师签到。',
      requirement: '完成后拍照提交：上架完成的书架全景一张；如有余力可顺手把还书车清空。',
      location: '图书馆二楼南侧',
      contactInfo: '陈老师（到场后在前台登记）',
      headcount: 2,
      deadlineAt: deadline,
    },
    teacher,
  );
  if (task.code !== 0) throw new Error(`create task: ${task.message}`);

  // 5) 管理员定价 50
  await api('POST', `/admin/tasks/${task.data.id}/price`, { rewardPerPerson: 50 }, admin);

  // 6) 学生 A 接单（大厅里显示 1/2）
  const claim = await api('POST', `/tasks/${task.data.id}/claims`, undefined, student1);
  if (claim.code !== 0) throw new Error(`claim: ${claim.message}`);

  // 7) demo 账号取消「首登强制改密」，方便直接登录体验（直接改库，绕过流程）
  const { Prisma, PrismaClient } = await import('../src/generated/prisma/client');
  const { PrismaMariaDb } = await import('@prisma/adapter-mariadb');
  const prisma = new PrismaClient({ adapter: new PrismaMariaDb(process.env.DATABASE_URL ?? '') });
  await prisma.user.updateMany({
    where: { username: { in: ['tea_demo', 'stu_demo', 'stu_demo2'] } },
    data: { mustChangePassword: false },
  });
  await prisma.$disconnect();
  void Prisma;

  console.log('demo 数据就绪：');
  console.log('  管理员 admin / Admin#Demo2026');
  console.log('  教师  tea_demo  / TeaPassw0rd （陈老师）');
  console.log('  学生  stu_demo  / StuPassw0rd （李明，已接单）');
  console.log('  学生  stu_demo2 / WangPassw0rd（王小红）');
  console.log('  管理员 admin 的密码为 reset 后你设置的那个');
  console.log(`  任务 #${task.data.id}「图书馆搬新书上架」已定价 50 分/人，名额 1/2`);
}

main().catch((error) => {
  console.error('demo-seed 失败：', error);
  process.exitCode = 1;
});
