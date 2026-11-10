import { LedgerService } from '../src/ledger/ledger.service';
import type { AccountOwnerType } from '@sasu/shared';

/** 单元级：余额不变式（入账主流程依赖数据库，由验收脚本覆盖） */
describe('LedgerService 余额不变式（PRD §9.3 不变式 12）', () => {
  let ledger: LedgerService;

  beforeEach(() => {
    // 仅测试纯函数，不触库
    ledger = new LedgerService({} as never);
  });

  it('普通账户余额/冻结为负时抛错', () => {
    const cases: [AccountOwnerType, number, number][] = [
      ['USER', -1, 0],
      ['TASK_ESCROW', 0, -5],
      ['POOL', -100, 0],
    ];
    for (const [ownerType, balance, frozen] of cases) {
      expect(() => ledger.assertBalanceInvariant(ownerType, balance, frozen)).toThrow(/不得为负/);
    }
    expect(() => ledger.assertBalanceInvariant('POOL', 1000, 0)).not.toThrow();
  });

  it('SYS_ISSUE 允许负余额但冻结必须为 0 且不得为正', () => {
    expect(() => ledger.assertBalanceInvariant('SYS_ISSUE', -1000, 0)).not.toThrow();
    expect(() => ledger.assertBalanceInvariant('SYS_ISSUE', 10, 0)).toThrow();
    expect(() => ledger.assertBalanceInvariant('SYS_ISSUE', -10, 1)).toThrow();
  });

  it('账户键生成符合 §9.2 约定', () => {
    expect(LedgerService.POOL).toBe('POOL');
    expect(LedgerService.userKey(456n)).toBe('USER:456');
    expect(LedgerService.taskKey(123n)).toBe('TASK:123');
  });
});
