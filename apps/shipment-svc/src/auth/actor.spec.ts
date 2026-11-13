import { ForbiddenException } from '@nestjs/common';
import { parseRoles, requireAnalyst } from './actor';

describe('requireAnalyst', () => {
  it('returns an ANALYST actor from the identity headers', () => {
    const actor = requireAnalyst('analyst-a', 'operator, analyst');
    expect(actor.actorId).toBe('analyst-a');
    expect(actor.role).toBe('ANALYST');
    expect(actor.at).toEqual(expect.any(String));
  });

  it('rejects a missing user id or a non-analyst role', () => {
    expect(() => requireAnalyst(undefined, 'ANALYST')).toThrow(ForbiddenException);
    expect(() => requireAnalyst(' ', 'ANALYST')).toThrow(ForbiddenException);
    expect(() => requireAnalyst('analyst-a', 'OPERATOR')).toThrow(ForbiddenException);
    expect(() => requireAnalyst('analyst-a')).toThrow(ForbiddenException);
  });
});

describe('parseRoles', () => {
  it('splits and uppercases comma- or space-separated roles', () => {
    expect(parseRoles('analyst, operator')).toEqual(['ANALYST', 'OPERATOR']);
    expect(parseRoles(undefined)).toEqual([]);
  });
});
