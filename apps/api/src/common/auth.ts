import { CanActivate, createParamDecorator, ExecutionContext, ForbiddenException, Injectable, SetMetadata, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import type { Request } from 'express';
import type { Role } from '@prisma/client';

export interface AuthUser {
  sub: string;
  role: Role;
  email: string;
  mfaPending?: boolean;
  mfaVerified?: boolean;
}

export type AuthenticatedRequest = Request & { user?: AuthUser };
export const Public = () => SetMetadata('isPublic', true);
export const Roles = (...roles: Role[]) => SetMetadata('roles', roles);
export const MfaAllowed = () => SetMetadata('mfaAllowed', true);
export const CurrentUser = createParamDecorator((_data: unknown, context: ExecutionContext): AuthUser | undefined =>
  context.switchToHttp().getRequest<AuthenticatedRequest>().user
);

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(private readonly jwt: JwtService, private readonly reflector: Reflector) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>('isPublic', [context.getHandler(), context.getClass()]);
    if (isPublic) return true;
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const authorization = request.headers.authorization;
    const token = authorization?.startsWith('Bearer ') ? authorization.slice(7) : undefined;
    if (!token) throw new UnauthorizedException({ code: 'AUTH_REQUIRED', message: 'Authentication is required.' });
    try {
      const claims = await this.jwt.verifyAsync<AuthUser>(token);
      if (!claims.sub || !claims.role) throw new Error('Invalid claims');
      const mfaRole = claims.role === 'ADMIN' || claims.role === 'AUDITOR';
      if (mfaRole && !claims.mfaVerified && !claims.mfaPending) {
        throw new UnauthorizedException({ code: 'MFA_REAUTH_REQUIRED', message: 'Sign in again and complete authenticator verification.' });
      }
      if (claims.mfaPending && !this.reflector.getAllAndOverride<boolean>('mfaAllowed', [context.getHandler(), context.getClass()])) {
        throw new ForbiddenException({ code: 'MFA_REQUIRED', message: 'Complete MFA setup before accessing this resource.' });
      }
      request.user = claims;
      return true;
    } catch (error) {
      if (error instanceof ForbiddenException) throw error;
      if (error instanceof UnauthorizedException) throw error;
      throw new UnauthorizedException({ code: 'INVALID_TOKEN', message: 'The access token is invalid or expired.' });
    }
  }
}

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const roles = this.reflector.getAllAndOverride<Role[]>('roles', [context.getHandler(), context.getClass()]);
    if (!roles?.length) return true;
    const user = context.switchToHttp().getRequest<AuthenticatedRequest>().user;
    if (!user || !roles.includes(user.role)) throw new ForbiddenException({ code: 'FORBIDDEN', message: 'You do not have permission to perform this action.' });
    return true;
  }
}
