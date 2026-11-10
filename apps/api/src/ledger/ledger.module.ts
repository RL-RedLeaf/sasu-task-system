import { Global, Module } from '@nestjs/common';
import { LedgerService } from './ledger.service';

/**
 * 全局记账模块：唯一允许写 point_accounts / point_transactions / point_legs 的入口。
 * M4 在此实现双分录记账（TASK_PAYOUT / TASK_FREEZE / TASK_REPRICE_TOPUP / …）。
 */
@Global()
@Module({
  providers: [LedgerService],
  exports: [LedgerService],
})
export class LedgerModule {}
