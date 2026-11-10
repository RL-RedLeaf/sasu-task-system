import { Module } from '@nestjs/common';
import { PointsController } from './points.controller';
import { LedgerModule } from '../ledger/ledger.module';

@Module({
  imports: [LedgerModule],
  controllers: [PointsController],
})
export class PointsModule {}
