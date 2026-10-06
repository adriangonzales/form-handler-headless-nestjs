import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { FormEntriesModule } from '../form-entries/form-entries.module';
import { SubmissionsController } from './submissions.controller';

/** Public, unauthenticated form submissions (ch. 3 §3.6). */
@Module({
  imports: [DatabaseModule, FormEntriesModule],
  controllers: [SubmissionsController],
})
export class SubmissionsModule {}
