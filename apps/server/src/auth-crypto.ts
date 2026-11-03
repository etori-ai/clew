import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

export const randomToken = () => randomBytes(32).toString('base64url');
export const tokenDigest = (value: string) => createHash('sha256').update(value).digest('hex');
export function equalToken(a: string, b: string) {
  const x = Buffer.from(a), y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}
function masterKey() {
  const key = Buffer.from(process.env.MASTER_KEY ?? '', 'base64');
  if (key.length !== 32) throw new Error('Authentication encryption key unavailable');
  return key;
}
function seal(value: Buffer, key: Buffer, purpose: string) {
  const iv = randomBytes(12), cipher = createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(Buffer.from(purpose));
  const data = Buffer.concat([cipher.update(value), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), data]).toString('base64url');
}
function open(value: string, key: Buffer, purpose: string) {
  const bytes = Buffer.from(value, 'base64url');
  const cipher = createDecipheriv('aes-256-gcm', key, bytes.subarray(0, 12));
  cipher.setAuthTag(bytes.subarray(12, 28)); cipher.setAAD(Buffer.from(purpose));
  return Buffer.concat([cipher.update(bytes.subarray(28)), cipher.final()]);
}
/** One data key per token set, wrapped by a master key outside Postgres. */
export function encryptTokens(value: object, session: string) {
  const dek = randomBytes(32);
  return JSON.stringify({ version: 1, key: seal(dek, masterKey(), 'auth:key:' + session), data: seal(Buffer.from(JSON.stringify(value)), dek, 'auth:tokens:' + session) });
}
export function decryptTokens(value: string, session: string): { access_token: string; refresh_token: string; id_token: string } {
  const envelope = JSON.parse(value);
  if (envelope.version !== 1) throw new Error('Invalid envelope');
  return JSON.parse(open(envelope.data, open(envelope.key, masterKey(), 'auth:key:' + session), 'auth:tokens:' + session).toString());
}
export function authorizationVersion(value: object) {
  return createHmac('sha256', masterKey()).update(JSON.stringify(value)).digest('hex');
}
export function localReturnTo(value: string | null) {
  if (!value || !value.startsWith('/') || value.startsWith('//') || /[\\\r\n]/.test(value)) return '/';
  const url = new URL(value, 'https://clew.invalid');
  if (url.origin !== 'https://clew.invalid' || url.pathname.startsWith('/api/') || url.pathname === '/login') return '/';
  return url.pathname + url.search;
}
