import { Module } from '@nestjs/common';
import { TasksController } from './tasks.controller';
import { AdminTasksController } from './admin-tasks.controller';
import { TasksService } from './tasks.service';
import { PricingService } from './pricing.service';
import { LifecycleService } from './lifecycle.service';
import { AssignmentsService } from './assignments.service';
import { SubmissionsController } from '../submissions/submissions.controller';
import { SubmissionsService } from '../submissions/submissions.service';
import { FilesService } from '../files/files.service';
import { SettlementService } from './settlement.service';

@Module({
  controllers: [TasksController, AdminTasksController, SubmissionsController],
  providers: [
    TasksService,
    PricingService,
    LifecycleService,
    AssignmentsService,
    SubmissionsService,
    FilesService,
    SettlementService,
  ],
  exports: [TasksService, AssignmentsService, SubmissionsService, FilesService, SettlementService],
})
export class TasksModule {}
