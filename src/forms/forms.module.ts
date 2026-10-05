import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { DatabaseModule } from '../database/database.module';
import { FormsController } from './forms.controller';
import { FormsService } from './forms.service';

/** Form CRUD, restore and duplicate (ch. 3 §3.4). */
@Module({
  imports: [DatabaseModule, AuthModule],
  controllers: [FormsController],
  providers: [FormsService],
})
export class FormsModule {}
