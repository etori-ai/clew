import type { UserAdminRow, UserStatus } from '@clew/contracts';

/**
 * Whether a provisioned person can use Clew, as an administrator reads it (D62, D85): switched off in the catalogue, no
 * grant, or a grant and whether the person has signed in. Administration › Användare filters by it and marks the two
 * an administrator acts on; the person's page says it under Kontakt for a reader with `admin.users`.
 */
export const statusOf = (u: Pick<UserAdminRow, 'enabled' | 'active' | 'bound'>): UserStatus =>
  !u.enabled ? 'disabled' : !u.active ? 'no-access' : u.bound ? 'signed-in' : 'not-signed-in';
export const statusLabel: Record<UserStatus, string> = {
  'signed-in': 'Har loggat in',
  'not-signed-in': 'Inte inloggad ännu',
  'no-access': 'Ingen åtkomst',
  disabled: 'Avstängd',
};
