import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { GatewayEnv } from '../config/env';
import { findDemoUser } from './users';
import {
  AccessTokenPayload,
  jwtMaxAgeSec,
  signAccessToken,
  verifyAccessToken,
} from './jwt';
import { AUTH_COOKIE, parseCookies } from './cookies';
import { StreamTokenStore } from './stream-token.store';

@Injectable()
export class AuthService {
  constructor(
    private readonly config: ConfigService<GatewayEnv, true>,
    private readonly streamTokens: StreamTokenStore,
  ) {}

  private secret(): string {
    return this.config.get('JWT_SECRET', { infer: true });
  }

  private expiresIn(): string {
    return this.config.get('JWT_EXPIRES_IN', { infer: true });
  }

  login(username: string, password: string) {
    const user = findDemoUser(username);
    if (!user || user.password !== password) {
      throw new UnauthorizedException('Invalid username or password');
    }
    const payload: AccessTokenPayload = {
      sub: user.id,
      username: user.username,
      roles: user.roles,
    };
    const accessToken = signAccessToken(payload, this.secret(), this.expiresIn());
    return {
      accessToken,
      tokenType: 'Bearer',
      expiresIn: jwtMaxAgeSec(this.expiresIn()),
      user: { id: user.id, username: user.username, roles: user.roles },
    };
  }

  verifyBearerOrCookie(authorization?: string, cookieHeader?: string): AccessTokenPayload {
    const bearer = this.bearerToken(authorization);
    const cookieToken = parseCookies(cookieHeader)[AUTH_COOKIE];
    const token = bearer || cookieToken;
    if (!token) {
      throw new UnauthorizedException('Missing access token');
    }
    try {
      return verifyAccessToken(token, this.secret());
    } catch {
      throw new UnauthorizedException('Invalid or expired access token');
    }
  }

  issueStreamToken(payload: AccessTokenPayload) {
    return this.streamTokens.issue(payload);
  }

  authenticateStream(queryToken?: string, cookieHeader?: string): AccessTokenPayload {
    if (queryToken) {
      const payload = this.streamTokens.consume(queryToken);
      if (!payload) {
        throw new UnauthorizedException('Invalid or expired stream token');
      }
      return payload;
    }
    const cookieToken = parseCookies(cookieHeader)[AUTH_COOKIE];
    if (!cookieToken) {
      throw new UnauthorizedException(
        'Stream auth requires a stream token query parameter or the login cookie',
      );
    }
    try {
      return verifyAccessToken(cookieToken, this.secret());
    } catch {
      throw new UnauthorizedException('Invalid or expired access token');
    }
  }

  private bearerToken(authorization?: string): string | undefined {
    if (!authorization) {
      return undefined;
    }
    const [scheme, token] = authorization.split(' ');
    if (scheme?.toLowerCase() !== 'bearer' || !token) {
      return undefined;
    }
    return token;
  }
}
