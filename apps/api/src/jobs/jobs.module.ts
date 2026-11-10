import { Module } from '@nestjs/common';
import { JobsService } from './jobs.service';
import { AdminJobsController } from './admin-jobs.controller';
import { TasksModule } from '../tasks/tasks.module';

@Module({
  imports: [TasksModule],
  controllers: [AdminJobsController],
  providers: [JobsService],
})
export class JobsModule {}
