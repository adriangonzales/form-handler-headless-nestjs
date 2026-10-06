import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { DatabaseModule } from '../database/database.module';
import { CreateFormEntry } from './create-form-entry.service';
import { FormEntriesController } from './form-entries.controller';
import { FormEntriesService } from './form-entries.service';

/** Entry list, triage, bulk actions and the owner's create (ch. 3 §3.5). */
@Module({
  imports: [DatabaseModule, AuthModule],
  controllers: [FormEntriesController],
  providers: [FormEntriesService, CreateFormEntry],
  exports: [CreateFormEntry],
})
export class FormEntriesModule {}
