import { sign, verify, type JwtPayload } from 'jsonwebtoken';

export type AccessTokenPayload = {
  sub: string;
  username: string;
  roles: string[];
};

const DEFAULT_EXPIRES_IN = '2h';
const DEFAULT_MAX_AGE_SEC = 2 * 60 * 60;

export function jwtSecret(): string {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    throw new Error('JWT_SECRET is not set');
  }
  return secret;
}

export function jwtExpiresIn(): string {
  return process.env.JWT_EXPIRES_IN || DEFAULT_EXPIRES_IN;
}

export function jwtMaxAgeSec(): number {
  const raw = process.env.JWT_EXPIRES_IN || DEFAULT_EXPIRES_IN;
  const match = /^(\d+)([smhd])$/.exec(raw.trim());
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

export function signAccessToken(payload: AccessTokenPayload): string {
  return sign(payload, jwtSecret(), { expiresIn: jwtExpiresIn() } as Parameters<typeof sign>[2]);
}

export function verifyAccessToken(token: string): AccessTokenPayload {
  const decoded = verify(token, jwtSecret()) as JwtPayload & AccessTokenPayload;
  if (!decoded?.sub || !Array.isArray(decoded.roles)) {
    throw new Error('invalid access token payload');
  }
  return {
    sub: decoded.sub,
    username: decoded.username,
    roles: decoded.roles,
  };
}
