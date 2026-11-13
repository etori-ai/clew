/**
 * Check what a Clew installation holds after a provisioner's push (D68), over SCIM alone. It only reads.
 *
 *   CLEW_PROVISIONER_TOKEN=<token> bun scripts/provisioner-check.ts https://clew.example/scim/v2
 *   bun scripts/provisioner-check.ts http://127.0.0.1:3000/scim/v2 --token <token>
 *   bun scripts/provisioner-check.ts <url> --roots 1   # warn when the root count differs from the source
 *
 * The environment variable keeps the token out of the shell history. The check authenticates as the provisioner, so
 * it counts as a call from it and moves its last-seen time: to leave that alone, issue the check a key under an id of
 * its own right before it runs ("Lägg till katalog" on Administration › Användare, or
 * `bun scripts/provisioner-token.ts add check --organisation <organisationId>`), and take it back as soon as it has
 * run ("Återkalla nyckeln" on Administration › Användare, or `bun scripts/provisioner-token.ts revoke check`). There is
 * one kind of key (D68 item 5, D107 item 3): though the check only reads, its key can create, change and deactivate
 * users and groups as much as the provisioner's own. Until it is taken back, its row under "Inläsning från katalogen"
 * stays on the page and shows "Tyst i över två dygn" from two days after the check last ran. Exit 0 when nothing
 * failed (warnings included), 1 on a failure, 2 on a usage error.
 */
import { scimClient } from './provisioner/client';
import { checkProvisioning } from './provisioner/check';

const args = process.argv.slice(2);
const option = (name: string) => {
  const index = args.indexOf('--' + name);
  return index === -1 ? undefined : args[index + 1];
};
const url = args.find((a, i) => !a.startsWith('--') && !args[i - 1]?.startsWith('--'))?.replace(/\/+$/, '');
const token = option('token') ?? process.env.CLEW_PROVISIONER_TOKEN;
const roots = option('roots') === undefined ? undefined : Number(option('roots'));
if (!url || !token || (roots !== undefined && (!Number.isInteger(roots) || roots < 0))) {
  console.error(
    'Usage: CLEW_PROVISIONER_TOKEN=<token> bun scripts/provisioner-check.ts <url ending in /scim/v2> [--token <token>] [--roots <n>]',
  );
  process.exit(2);
}
const findings = await checkProvisioning(url, scimClient(url, token), fetch, { roots }).catch(error => {
  console.log('FAIL ' + (error as Error).message);
  process.exit(1);
});
console.log(`Provisioning at ${url}`);
for (const f of findings)
  console.log(`  ${f.level === 'ok' ? 'ok  ' : f.level === 'warn' ? 'warn' : 'FAIL'} ${f.text}`);
const failures = findings.filter(f => f.level === 'fail').length,
  warnings = findings.filter(f => f.level === 'warn').length;
console.log(
  failures ? `\n${failures} failure(s).` : warnings ? `\nNo failures, ${warnings} warning(s).` : '\nAll checks passed.',
);
process.exit(failures ? 1 : 0);
