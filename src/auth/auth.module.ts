import { Module } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { jwtConfig } from '../config';
import { DatabaseModule } from '../database/database.module';
import { PasswordHasher } from '../users/password-hasher';
import { AuthController } from './auth.controller';
import {
  JwtAuthGuard,
  TokenAuthenticator,
  TokenVersionGuard,
} from './auth.guards';
import { AuthService } from './auth.service';
import { DenyListService } from './deny-list.service';
import {
  LoginLimiter,
  loginLimiterStoreProvider,
} from './login-limiter.service';
import { TokenService } from './token.service';

/** Login, refresh, logout, `me`, and the guards every API module uses (ch. 5). */
@Module({
  imports: [
    DatabaseModule,
    JwtModule.registerAsync({
      inject: [jwtConfig.KEY],
      useFactory: (config: ConfigType<typeof jwtConfig>) => ({
        secret: config.secret,
        signOptions: { algorithm: 'HS256' },
      }),
    }),
  ],
  controllers: [AuthController],
  providers: [
    TokenService,
    DenyListService,
    TokenAuthenticator,
    JwtAuthGuard,
    TokenVersionGuard,
    AuthService,
    LoginLimiter,
    loginLimiterStoreProvider,
    PasswordHasher,
  ],
  exports: [
    TokenService,
    DenyListService,
    TokenAuthenticator,
    JwtAuthGuard,
    TokenVersionGuard,
    AuthService,
    PasswordHasher,
  ],
})
export class AuthModule {}
