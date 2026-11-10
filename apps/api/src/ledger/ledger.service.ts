/**
 * 记账唯一入口（PRD §12.1 硬性约定）。
 *
 * 所有积分变动只能经由本模块完成「写 point_accounts + point_transactions + point_legs」，
 * 业务模块（tasks/withdrawals/disputes/…）禁止直接修改账表。
 *
 * M0 仅提供分录平衡断言；双分录账本、幂等 biz_key、
 * 16 种交易类型分录模板（PRD §9.2.1）与 13 条不变式对账（PRD §9.3）在 M4 实现。
 */
export class LedgerService {
  /** 校验一笔交易的所有分录 delta 求和为 0（不变式 3），违反即抛错回滚。 */
  assertLegsBalanced(deltas: readonly number[]): void {
    const sum = deltas.reduce((acc, d) => acc + d, 0);
    if (sum !== 0) {
      throw new Error(`分录不平衡：Σdelta = ${sum}（必须为 0）`);
    }
  }

  /** 账户余额与冻结桶均不得为负（不变式 12；SYS_ISSUE 例外，须 ≤ 0）。 */
  assertBalanceInvariant(ownerType: string, balance: number, frozen: number): void {
    if (ownerType === 'SYS_ISSUE') {
      if (balance > 0 || frozen !== 0) {
        throw new Error(`SYS_ISSUE 非法状态：balance=${balance}, frozen=${frozen}`);
      }
      return;
    }
    if (balance < 0 || frozen < 0) {
      throw new Error(`${ownerType} 余额不得为负：balance=${balance}, frozen=${frozen}`);
    }
  }
}
