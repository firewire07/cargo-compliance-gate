import { sign, verify, type JwtPayload } from 'jsonwebtoken';

export type AccessTokenPayload = {
  sub: string;
  username: string;
  roles: string[];
};

const DEFAULT_EXPIRES_IN = '2h';
const DEFAULT_MAX_AGE_SEC = 2 * 60 * 60;

export function jwtMaxAgeSec(expiresIn = DEFAULT_EXPIRES_IN): number {
  const match = /^(\d+)([smhd])$/.exec(expiresIn.trim());
  if (!match) {
    return DEFAULT_MAX_AGE_SEC;
  }
  const n = Number(match[1]);
  const unit = match[2];
  if (unit === 's') return n;
  if (unit === 'm') return n * 60;
  if (unit === 'h') return n * 60 * 60;
  return n * 60 * 60 * 24;
}

export function signAccessToken(
  payload: AccessTokenPayload,
  secret: string,
  expiresIn = DEFAULT_EXPIRES_IN,
): string {
  return sign(payload, secret, { expiresIn } as Parameters<typeof sign>[2]);
}

export function verifyAccessToken(token: string, secret: string): AccessTokenPayload {
  const decoded = verify(token, secret) as JwtPayload & AccessTokenPayload;
  if (!decoded?.sub || !Array.isArray(decoded.roles)) {
    throw new Error('invalid access token payload');
  }
  return {
    sub: decoded.sub,
    username: decoded.username,
    roles: decoded.roles,
  };
}
