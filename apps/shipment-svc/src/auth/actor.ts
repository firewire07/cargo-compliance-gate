import { ForbiddenException } from '@nestjs/common';

export type Actor = {
  actorId: string;
  role: string;
  at: string;
};

export const ANALYST_ROLE = 'ANALYST';

export function parseRoles(header?: string): string[] {
  if (!header) {
    return [];
  }
  return header
    .split(/[,\s]+/)
    .map((role) => role.trim().toUpperCase())
    .filter(Boolean);
}

export function requireAnalyst(userId?: string, rolesHeader?: string): Actor {
  const actorId = userId?.trim();
  if (!actorId) {
    throw new ForbiddenException('x-user-id is required');
  }
  const roles = parseRoles(rolesHeader);
  if (!roles.includes(ANALYST_ROLE)) {
    throw new ForbiddenException('ANALYST role required');
  }
  return {
    actorId,
    role: ANALYST_ROLE,
    at: new Date().toISOString(),
  };
}
