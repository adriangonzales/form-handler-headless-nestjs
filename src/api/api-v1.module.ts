import { Module } from '@nestjs/common';

/**
 * Everything under `/api/v1`, mounted by `RouterModule` in `AppModule`. Feature
 * modules (forms, entries, auth, ...) are imported here as they land.
 */
@Module({})
export class ApiV1Module {}
