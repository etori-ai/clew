/**
 * Push the development directory to a running Clew over HTTP (D68 item 7: the synthetic provisioner). Run inside the
 * app container once `bun run dev` answers:
 *   bun run dev:provision            # CLEW_URL (default http://127.0.0.1:3000), token from DEV_PROVISIONER_TOKEN or .auth-test.env
 *   bun run dev:provision -- --token <token> --url http://host:3000
 *   bun run dev:provision -- --force # when a person has decided that a push that deactivates many people is right
 * `bun run auth:setup` issues the token and pushes the same directory in-process, so this is for exercising the endpoint.
 */
import { scimClient } from './client';
import { developmentScope, developmentDirectory } from './directory';
import { push } from './push';

const args = process.argv.slice(2);
const option = (name: string) => {
  const index = args.indexOf('--' + name);
  return index === -1 ? undefined : args[index + 1];
};
async function tokenFromFile() {
  const file = Bun.file('.auth-test.env');
  if (!(await file.exists())) return undefined;
  const match = /^DEV_PROVISIONER_TOKEN=(.+)$/m.exec(await file.text());
  return match?.[1]?.trim();
}
const token = option('token') ?? process.env.DEV_PROVISIONER_TOKEN ?? (await tokenFromFile());
if (!token) throw new Error('No provisioner token: run `bun run auth:setup`, or pass --token.');
const url = (option('url') ?? process.env.CLEW_URL ?? 'http://127.0.0.1:3000').replace(/\/+$/, '') + '/scim/v2';
const summary = await push(scimClient(url, token), developmentDirectory, developmentScope, {
  log: line => console.log(line),
  force: args.includes('--force'),
});
console.log(
  `Pushed the development directory to ${url}: ${summary.created} users created, ${summary.replaced} replaced, ${summary.deactivated} deactivated; ${summary.groupsCreated} groups created, ${summary.groupsReplaced} replaced, ${summary.groupsRemoved} removed.`,
);
if (summary.refused.length) {
  console.error(`${summary.refused.length} of the people were not written. Everybody else was sent.`);
  for (const refused of summary.refused)
    console.error(`  ${refused.userName} (${refused.externalId}): ${refused.detail}`);
  process.exitCode = 1;
}
if (summary.groupsRefused.length) {
  console.error(
    `${summary.groupsRefused.length} units or groups were not written as the directory has them. Everything else was sent, and every removal made.`,
  );
  for (const refused of summary.groupsRefused) console.error(`  ${refused.externalId}: ${refused.detail}`);
  process.exitCode = 1;
}
