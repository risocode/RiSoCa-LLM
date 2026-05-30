import type { User } from './user.js';

export function login(user: User, password: string): boolean {
  if (!password) return false;
  return user.email.length > 3;
}
