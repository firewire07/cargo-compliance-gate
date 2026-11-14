import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { AuthService } from './auth.service';
import { JwtAuthGuard } from './auth.guard';
import { signAccessToken } from './jwt';
import { StreamTokenStore } from './stream-token.store';

function contextWith(headers: Record<string, string>): {
  ctx: ExecutionContext;
  req: { headers: Record<string, string | undefined>; user?: unknown };
} {
  const req = { headers: { ...headers } };
  const ctx = {
    switchToHttp: () => ({ getRequest: () => req }),
  } as unknown as ExecutionContext;
  return { ctx, req };
}

const TEST_SECRET = 'test-only-jwt-secret';
const config = {
  get: (key: string) =>
    key === 'JWT_SECRET' ? TEST_SECRET : key === 'JWT_EXPIRES_IN' ? '2h' : undefined,
};

describe('JwtAuthGuard', () => {
  let guard: JwtAuthGuard;

  beforeEach(() => {
    const auth = new AuthService(config as never, new StreamTokenStore());
    guard = new JwtAuthGuard(auth);
  });

  it('sets identity headers from the JWT and ignores a spoofed x-roles header', () => {
    const token = signAccessToken({
      sub: 'operator',
      username: 'operator',
      roles: ['OPERATOR'],
    }, TEST_SECRET);
    const { ctx, req } = contextWith({
      authorization: `Bearer ${token}`,
      'x-user-id': 'analyst-a',
      'x-roles': 'ANALYST',
      'x-correlation-id': 'keep-me',
    });

    expect(guard.canActivate(ctx)).toBe(true);
    expect(req.headers['x-user-id']).toBe('operator');
    expect(req.headers['x-roles']).toBe('OPERATOR');
    expect(req.headers['x-correlation-id']).toBe('keep-me');
    expect(req.user).toEqual(
      expect.objectContaining({ sub: 'operator', roles: ['OPERATOR'] }),
    );
  });

  it('generates a correlation id when the client did not send one', () => {
    const token = signAccessToken({
      sub: 'analyst-a',
      username: 'analyst-a',
      roles: ['ANALYST'],
    }, TEST_SECRET);
    const { ctx, req } = contextWith({ authorization: `Bearer ${token}` });

    expect(guard.canActivate(ctx)).toBe(true);
    expect(req.headers['x-correlation-id']).toEqual(expect.any(String));
    expect(req.headers['x-correlation-id']?.length).toBeGreaterThan(0);
    expect(req.headers['x-user-id']).toBe('analyst-a');
    expect(req.headers['x-roles']).toBe('ANALYST');
  });

  it('rejects a missing or invalid token', () => {
    const missing = contextWith({});
    expect(() => guard.canActivate(missing.ctx)).toThrow(UnauthorizedException);

    const invalid = contextWith({ authorization: 'Bearer not-a-jwt' });
    expect(() => guard.canActivate(invalid.ctx)).toThrow(UnauthorizedException);
  });
});
