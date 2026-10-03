import { Module } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { TimestampSubscriber } from '../common/db/timestamp.subscriber';
import { databaseConfig } from '../config';
import { dataSourceOptions } from './data-source-options';
import { ENTITIES } from './entities';

@Module({
  imports: [
    TypeOrmModule.forRootAsync({
      inject: [databaseConfig.KEY],
      useFactory: (config: ConfigType<typeof databaseConfig>) =>
        dataSourceOptions(config),
    }),
    TypeOrmModule.forFeature(ENTITIES),
  ],
  providers: [TimestampSubscriber],
  exports: [TypeOrmModule],
})
export class DatabaseModule {}
