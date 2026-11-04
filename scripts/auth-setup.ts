/** Run inside the app container. Admin credentials come from env or piped Docker env JSON; never printed. */
import { randomBytes } from 'node:crypto';
import { rename, writeFile } from 'node:fs/promises';
import { and, eq } from 'drizzle-orm';
import { database, closeDatabase } from '@clew/db';
import { ABSOLUTE_MS, IDLE_MS, people, accessGrants, identityBindings, authenticationAudit, pruneAuthentication } from '@clew/db/auth';
import { insertConnector, readConnector } from '@clew/db/connectors';
import { writeAudit } from '@clew/db/threads';
import { sealSecret } from '../apps/server/src/auth-crypto';
const realm = 'clew', issuer = 'http://keycloak.orb.local:8090/realms/' + realm;
const base = process.env.KEYCLOAK_ADMIN_URL ?? 'http://host.docker.internal:8090';
const publicUrl = process.env.PUBLIC_URL ?? 'http://localhost:3020';
let credentials = { ...process.env };
if (!process.stdin.isTTY && !credentials.KEYCLOAK_ADMIN_PASSWORD) {
  const values: unknown = JSON.parse(await Bun.stdin.text());
  if (!Array.isArray(values) || !values.every(v => typeof v === 'string')) throw new Error('Expected environment array');
  credentials = { ...Object.fromEntries(values.map(v => [v.slice(0,v.indexOf('=')),v.slice(v.indexOf('=')+1)])), ...credentials };
}
const username = credentials.KC_BOOTSTRAP_ADMIN_USERNAME ?? credentials.KEYCLOAK_ADMIN;
const password = credentials.KC_BOOTSTRAP_ADMIN_PASSWORD ?? credentials.KEYCLOAK_ADMIN_PASSWORD;
if (!username || !password) throw new Error('Supply Keycloak administrator credentials securely');
const tokenResponse = await fetch(base + '/realms/master/protocol/openid-connect/token', { method:'POST', body:new URLSearchParams({ grant_type:'password',client_id:'admin-cli',username,password }) });
if (!tokenResponse.ok) throw new Error('Keycloak administrator authentication failed');
const token = (await tokenResponse.json() as {access_token:string}).access_token;
async function admin(path:string, method='GET', body?: unknown) {
  const response = await fetch(base + '/admin/' + path,{method, headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});
  if (!response.ok && response.status!==404) throw new Error(`Keycloak setup failed (${response.status})`);
  return response;
}
async function objects(path:string):Promise<Array<Record<string,unknown>>> { return (await admin(path)).json(); }
const root='realms/'+realm;
if((await admin(root)).status===404)await admin('realms','POST',{realm,enabled:true,registrationAllowed:false,resetPasswordAllowed:false,
  internationalizationEnabled:true,supportedLocales:['sv','en'],defaultLocale:'sv',accessTokenLifespan:60,
  bruteForceProtected:true, permanentLockout:false });
await admin(root,'PUT',{ssoSessionIdleTimeout:IDLE_MS / 1000,ssoSessionMaxLifespan:ABSOLUTE_MS / 1000});
// Only this dedicated realm is modified. Never delete users or reset an existing password.
const localFile='apps/server/.env.local', testFile='.auth-test.env';
async function envFile(path:string){if(!await Bun.file(path).exists())return {};return Object.fromEntries((await Bun.file(path).text()).split('\n').flatMap(line=>{
  const match=/^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)=(.*)$/.exec(line);if(!match)return [];
  return [[match[1]!,match[2]!.replace(/^(['"])(.*)\1$/, '$2')]];
}));}
async function writeSettings(path:string, settings:Record<string,string>) {
  const original=await Bun.file(path).exists()?await Bun.file(path).text():'';
  const remaining=new Set(Object.keys(settings));
  const lines=original.split('\n').filter((line,index,array)=>line!=='' || index<array.length-1).map(line=>{
    const match=/^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)=/.exec(line), key=match?.[1];
    if(!key || !(key in settings))return line;
    remaining.delete(key);return key+'='+settings[key];
  });
  for(const key of remaining)lines.push(key+'='+settings[key]);
  const temporary=path+'.'+randomBytes(8).toString('hex')+'.tmp';
  await writeFile(temporary,lines.join('\n')+'\n',{mode:0o600,flag:'wx'});await rename(temporary,path);
}
const existing = await envFile(localFile), previousTest=await envFile(testFile);
async function client(id:string, origins:string[], backchannel:string) {
  const list=await objects(root+'/clients?clientId='+id);const found=list.find(c=>c.clientId===id);
  const settings={clientId:id,protocol:'openid-connect',enabled:true,publicClient:false,standardFlowEnabled:true,implicitFlowEnabled:false,
    directAccessGrantsEnabled:false,serviceAccountsEnabled:false,redirectUris:origins.map(o=>o+'/api/auth/callback'),webOrigins:[],
    attributes:{...(found?.attributes as Record<string,string> | undefined),'pkce.code.challenge.method':'S256','post.logout.redirect.uris':origins.map(o=>o+'/login').join('##'),
      'backchannel.logout.url':backchannel,'backchannel.logout.session.required':'true','backchannel.logout.revoke.offline.tokens':'true'},
  };
  if(found)await admin(root+'/clients/'+found.id,'PUT',{...found,...settings});else await admin(root+'/clients','POST',settings);
  const current=(await objects(root+'/clients?clientId='+id)).find(c=>c.clientId===id)!;
  const secret=await (await admin(root+'/clients/'+current.id+'/client-secret')).json() as {value:string};return secret.value;
}
const clientSecret=await client('clew-web',[publicUrl],'http://host.docker.internal:3020/api/auth/backchannel-logout');
const testPasswords:Record<string,string>={};
try {
  // Hillevi is the manager persona (rektor); Hassan the employee persona (undersköterska, mobile).
  for(const [id,first,last,unit,label,role,capabilities] of [
    ['hillevi','Hillevi','Berg','unit-skola','Bergsåkers skola','manager',['calendar:plan']],
    ['hassan','Hassan','Ali','unit-omsorg','Hemtjänst Centrum','employee',[]],
    // Mikael is the systemförvaltare persona: administration is a grant capability, not a work role (D23).
    ['mikael','Mikael','Lund','unit-it','IT och digitalisering','employee',['admin.connectors']],
  ] as const){
    const key='TEST_'+id.toUpperCase()+'_PASSWORD';
    let user=(await objects(root+'/users?exact=true&username='+id)).find(u=>u.username===id);
    let secret=previousTest[key];
    if(!user){secret=randomBytes(18).toString('base64url');await admin(root+'/users','POST',{username:id,firstName:first,lastName:last,email:id+'@clew.test',emailVerified:true,enabled:true,requiredActions:[],credentials:[{type:'password',value:secret,temporary:false}]});user=(await objects(root+'/users?exact=true&username='+id)).find(u=>u.username===id);}
    if(!user || typeof user.id!=='string')throw new Error('Unable to bind synthetic account');
    if(secret)testPasswords[key]=secret;
    await database().transaction(async tx=>{
      await tx.insert(people).values({id,organisationId:'poc',name:first+' '+last}).onConflictDoNothing();
      await tx.insert(accessGrants).values({personId:id,unitId:unit,unitLabel:label,role,capabilities:[...capabilities]}).onConflictDoNothing();
      const [binding]=await tx.select().from(identityBindings).where(and(eq(identityBindings.issuer,issuer),eq(identityBindings.personId,id)));
      if(binding && binding.subject!==user.id)throw new Error('Subject changed: explicit identity review required');
      if(!binding){await tx.insert(identityBindings).values({issuer,subject:user.id as string,personId:id});await tx.insert(authenticationAudit).values({action:'identity-bound',actor:'bootstrap:auth'});}
    });
  }
  const master=existing.MASTER_KEY??randomBytes(32).toString('base64');
  // The hello connector (connectors/hello) as a draft row (D23): enable it with `bun scripts/connector-add.ts hello --enable` once it runs on :4010.
  process.env.MASTER_KEY=master;
  const helloSecret=previousTest.HELLO_CONNECTOR_SECRET??randomBytes(18).toString('base64url');
  testPasswords.HELLO_CONNECTOR_SECRET=helloSecret;
  if(!(await readConnector('hello')))await database().transaction(async tx=>{await insertConnector(tx,{id:'hello',url:'http://127.0.0.1:4010',secret:sealSecret(helloSecret,'connector:secret:hello'),createdBy:'bootstrap:auth'});await writeAudit(tx,{actor:'bootstrap:auth',action:'connector.added',subject:'connector:hello',details:{url:'http://127.0.0.1:4010',draft:true}});});
  const settings={OIDC_ISSUER:issuer,OIDC_CLIENT_ID:'clew-web',OIDC_CLIENT_SECRET:clientSecret,PUBLIC_URL:publicUrl,MASTER_KEY:master,AUTH_LOCAL_HTTP:'true'};
  await writeSettings(localFile,settings);
  await writeSettings(testFile,{...settings,...testPasswords});
  await pruneAuthentication();
  console.log('Keycloak realm, client and identity bindings are ready. Secrets written to ignored, owner-only files.');
} finally { await closeDatabase(); }
