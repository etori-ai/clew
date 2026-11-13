// Which learning platform the connector reads, decided from the environment before anything is served. The choice is
// always said: a deployment that names no adapter does not start, because the stand-in answers with made-up people whose
// user names may be real ones in the installation, and Clew would copy their made-up holdings into its register.

/** The adapters: the real Moodle API, and the in-memory stand-in of learning.mjs, for development and tests only. */
export const ADAPTERS = ['moodle', 'fixture'];

const set = value => typeof value === 'string' && value.trim() !== '';

/**
 * The adapter the environment names. Throws, with the variable to change, when none is named, when the name is unknown,
 * when `moodle` lacks its address or token, and when `fixture` is named beside a Moodle address or token: a deployment
 * meant for a real Moodle never falls back to made-up data.
 */
export function adapterOf(env) {
  const adapter = set(env.MOODLE_ADAPTER) ? env.MOODLE_ADAPTER.trim() : '';
  if (!adapter)
    throw new Error(
      'MOODLE_ADAPTER is not set. Set it to "moodle" to read a Moodle site (with MOODLE_URL and MOODLE_TOKEN), or to ' +
        '"fixture" for the in-memory stand-in, whose people and holdings are made up: development and tests only.',
    );
  if (!ADAPTERS.includes(adapter))
    throw new Error(`Unknown MOODLE_ADAPTER "${adapter}". Known: ${ADAPTERS.join(', ')}.`);
  const given = ['MOODLE_URL', 'MOODLE_TOKEN'].filter(name => set(env[name]));
  if (adapter === 'moodle' && given.length < 2)
    throw new Error(
      `MOODLE_ADAPTER is "moodle" but ${['MOODLE_URL', 'MOODLE_TOKEN'].filter(n => !given.includes(n)).join(' and ')} ` +
        `${given.length ? 'is' : 'are'} not set.`,
    );
  if (adapter === 'fixture' && given.length)
    throw new Error(
      `MOODLE_ADAPTER is "fixture" but ${given.join(' and ')} ${given.length > 1 ? 'are' : 'is'} set. The stand-in ` +
        'reads no Moodle and answers with made-up people: set MOODLE_ADAPTER=moodle to read the site, or remove ' +
        `${given.join(' and ')} to run the stand-in.`,
    );
  return adapter;
}
