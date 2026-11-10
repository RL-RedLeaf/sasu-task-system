import { Global, Module } from '@nestjs/common';
import { LedgerService } from './ledger.service';
import { ReconcileService } from './reconcile.service';

/**
 * 全局记账模块：唯一允许写 point_accounts / point_transactions / point_legs 的入口。
 */
@Global()
@Module({
  providers: [LedgerService, ReconcileService],
  exports: [LedgerService, ReconcileService],
})
export class LedgerModule {}
