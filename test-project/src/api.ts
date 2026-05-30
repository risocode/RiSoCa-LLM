import { createUser } from './user.js';
import { login } from './auth.js';

export function registerAndLogin(name: string, email: string, password: string): boolean {
  const user = createUser(name, email);
  return login(user, password);
}
