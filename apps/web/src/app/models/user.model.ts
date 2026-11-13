export type UserRole = 'operator' | 'analyst';

export interface SessionUser {
  username: string;
  role: UserRole;
}
