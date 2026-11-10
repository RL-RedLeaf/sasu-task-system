import { LedgerService } from '../src/ledger/ledger.service';

describe('LedgerService（记账唯一入口）', () => {
  let ledger: LedgerService;

  beforeEach(() => {
    ledger = new LedgerService();
  });

  describe('assertLegsBalanced', () => {
    it('分录求和为 0 时通过（如 TASK_PAYOUT：托管 -100 / 用户 +100）', () => {
      expect(() => ledger.assertLegsBalanced([-100, 100])).not.toThrow();
      expect(() => ledger.assertLegsBalanced([50, -30, -20])).not.toThrow();
    });

    it('分录不平衡时抛错（PRD §9.3 不变式 3）', () => {
      expect(() => ledger.assertLegsBalanced([-100, 90])).toThrow(/分录不平衡/);
      expect(() => ledger.assertLegsBalanced([])).not.toThrow();
    });
  });

  describe('assertBalanceInvariant', () => {
    it('普通账户余额/冻结为负时抛错（不变式 12）', () => {
      expect(() => ledger.assertBalanceInvariant('USER', -1, 0)).toThrow(/不得为负/);
      expect(() => ledger.assertBalanceInvariant('TASK_ESCROW', 0, -5)).toThrow(/不得为负/);
      expect(() => ledger.assertBalanceInvariant('POOL', 100, 0)).not.toThrow();
    });

    it('SYS_ISSUE 允许负余额但冻结必须为 0', () => {
      expect(() => ledger.assertBalanceInvariant('SYS_ISSUE', -1000, 0)).not.toThrow();
      expect(() => ledger.assertBalanceInvariant('SYS_ISSUE', 10, 0)).toThrow();
      expect(() => ledger.assertBalanceInvariant('SYS_ISSUE', -10, 1)).toThrow();
    });
  });
});
