export type SeedUser = {
  id: string;
  username: string;
  password: string;
  roles: string[];
};

/**
 * Seeded demo users for local interview training only.
 * Passwords are placeholders, not real credentials.
 */
export const DEMO_USERS: SeedUser[] = [
  {
    id: 'operator',
    username: 'operator',
    password: 'operator-demo',
    roles: ['OPERATOR'],
  },
  {
    id: 'analyst-a',
    username: 'analyst-a',
    password: 'analyst-a-demo',
    roles: ['ANALYST'],
  },
  {
    id: 'analyst-b',
    username: 'analyst-b',
    password: 'analyst-b-demo',
    roles: ['ANALYST'],
  },
];

export function findDemoUser(username: string): SeedUser | undefined {
  return DEMO_USERS.find((user) => user.username === username);
}
