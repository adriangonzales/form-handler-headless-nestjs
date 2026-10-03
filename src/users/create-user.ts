import { Logger } from '@nestjs/common';

// `npm run user:create`: port of the Laravel `CreateUser` command.
// Implemented in phase 4 (ch. 5, PLAN.md).
Logger.error('user:create is not implemented yet (phase 4).', 'CreateUser');
process.exitCode = 1;
