import { Module } from '@nestjs/common';
import { AdminSettingsController } from './settings/admin-settings.controller';

@Module({
  controllers: [AdminSettingsController],
})
export class SettingsModule {}
