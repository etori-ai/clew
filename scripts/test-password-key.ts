/**
 * Where a persona's test password is kept in the ignored `.auth-test.env`: `TEST_<USER NAME>_PASSWORD`, every character
 * an environment name may not hold written as `_`, so `sara.nystrom` is `TEST_SARA_NYSTROM_PASSWORD` and the line is read
 * back. Every script that signs in as a persona reads the key from here.
 */
export const testPasswordKey = (userName: string) =>
  'TEST_' + userName.toUpperCase().replace(/[^A-Z0-9_]/g, '_') + '_PASSWORD';
