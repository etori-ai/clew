import { checkConnector, type CheckOptions } from '@clew/connectors/check';
import { fetchManifest, manifestFailure, type FetchLike } from '@clew/connectors/remote';
import type { Transport } from '../model';

/**
 * The service side of connector administration (D23, the `Transport` port): the manifest read at the registered address
 * and the conformance check behind "Anslut system" and "Testa anslutning", signed as the composition root signs. The
 * signers are handed in per connector, so the unit suite runs this with test keys and a fetch of its own.
 */
export interface ServiceTransportOptions {
  /** The request assertion for one connector, carrying the `uses` its served manifest declares (D144). */
  assert: (id: string, uses: string[]) => CheckOptions['assert'];
  /** An assertion the connector must refuse. */
  assertForeign: (id: string) => CheckOptions['assertForeign'];
  /** The installation's own assertion for the reads the manifest declares under `installation` (D119). */
  assertInstallation?: (id: string) => NonNullable<CheckOptions['assertInstallation']>;
  acceptsEmptyInput?: CheckOptions['acceptsEmptyInput'];
  fetch?: FetchLike;
}
export function serviceTransport(options: ServiceTransportOptions): Transport {
  return {
    fetchManifest: (url, id) => fetchManifest(url, id, options.fetch),
    async check({ url, id, secret }) {
      // `uses` is read from what the service serves before anything is signed. A service that serves nothing Clew can
      // load fails the check with that same failure, in the check's own words, so adding it still stores its draft and
      // testing it records why (CB-9), where the error used to end the request.
      const served = await fetchManifest(url, id, options.fetch).then(
        manifest => ({ uses: manifest.uses ?? [] }),
        (error: unknown) => ({ error }),
      );
      const failed = 'error' in served ? served.error : undefined;
      const report = await checkConnector({
        url,
        id,
        key: secret,
        assert: options.assert(id, 'uses' in served ? served.uses : []),
        assertForeign: options.assertForeign(id),
        ...(options.assertInstallation ? { assertInstallation: options.assertInstallation(id) } : {}),
        ...(options.acceptsEmptyInput ? { acceptsEmptyInput: options.acceptsEmptyInput } : {}),
        ...('error' in served
          ? { fetch: () => Promise.reject(failed) }
          : options.fetch
            ? { fetch: options.fetch }
            : {}),
      });
      return 'error' in served && !report.manifest ? { ...report, failure: manifestFailure(failed) } : report;
    },
  };
}
