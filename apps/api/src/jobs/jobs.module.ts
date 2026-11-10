import { Module } from '@nestjs/common';
import { JobsService } from './jobs.service';
import { TasksModule } from '../tasks/tasks.module';

@Module({
  imports: [TasksModule],
  providers: [JobsService],
})
export class JobsModule {}
