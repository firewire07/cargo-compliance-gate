import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { randomUUID } from 'crypto';
import { AuthService } from './auth.service';
import type { AccessTokenPayload } from './jwt';

const IDENTITY_HEADERS = ['x-user-id', 'x-roles', 'x-user-roles', 'x-role'];

export type GatewayRequest = {
  headers: Record<string, string | string[] | undefined>;
  user?: AccessTokenPayload;
};

export function headerValue(
  headers: Record<string, string | string[] | undefined>,
  name: string,
): string | undefined {
  const raw = headers[name] ?? headers[name.toLowerCase()];
  if (Array.isArray(raw)) {
    return raw[0];
  }
  return raw;
}

/** Strip client-supplied identity headers, then set them from the verified token. */
export function applyIdentity(req: GatewayRequest, user: AccessTokenPayload): void {
  for (const name of IDENTITY_HEADERS) {
    delete req.headers[name];
    delete req.headers[name.toLowerCase()];
    delete req.headers[name.toUpperCase()];
  }
  req.headers['x-user-id'] = user.sub;
  req.headers['x-roles'] = user.roles.join(',');
  if (!headerValue(req.headers, 'x-correlation-id')) {
    req.headers['x-correlation-id'] = randomUUID();
  }
  req.user = user;
}

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(private readonly auth: AuthService) {}

  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<GatewayRequest>();
    const authorization = headerValue(req.headers, 'authorization');
    const cookie = headerValue(req.headers, 'cookie');
    const user = this.auth.verifyBearerOrCookie(authorization, cookie);
    if (!user) {
      throw new UnauthorizedException('Missing access token');
    }
    applyIdentity(req, user);
    return true;
  }
}
