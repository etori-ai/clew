import { CapabilityError, UNKNOWN } from '@clew/connectors';
import { InputError } from '../context';

/**
 * What `POST /api/connectors/call` answers for a refusal (D21, D117), or undefined for a failure that is not one. A
 * refusal comes from the registry as a `CapabilityError` (from `clewFor(...).call`) or from Clew as an `InputError`, and
 * is answered in the protocol's words without an error log: an unknown capability, a hidden one and a person the caller
 * may not ask about all read "Okänd förmåga." as `not-found`, so a connector cannot tell a refused person from an
 * unknown one. Anything else, a directory that cannot be read included, is the route's `unavailable`.
 */
export function callbackRefusal(
  error: unknown,
): { code: 'not-found' | 'denied' | 'invalid'; message: string; status: 400 | 404 } | undefined {
  if (!(error instanceof CapabilityError) && !(error instanceof InputError)) return undefined;
  const message = error.message;
  if (message === UNKNOWN) return { code: 'not-found', message, status: 404 };
  return { code: /behörighet|annan modul/.test(message) ? 'denied' : 'invalid', message, status: 400 };
}
