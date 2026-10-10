import { Module } from '@nestjs/common';
import { AuditController } from './audit.controller';
import { AuditDataService } from './audit-data.service';
import { DatabaseModule } from '../../database/database.module';
import { ProvidersModule } from '../../providers/providers.module';

@Module({
  imports: [DatabaseModule, ProvidersModule],
  controllers: [AuditController],
  providers: [AuditDataService]
})
export class AuditDashboardModule {}
