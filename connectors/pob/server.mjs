// Serves connector.mjs over HTTP. The configuration is read and checked in config.mjs; README.md has the full table.
import { createServer } from 'node:http';
import { readConfig } from './config.mjs';
import { createConnector } from './connector.mjs';
import { createFixtureCases } from './cases.mjs';
import { createPobCases } from './pob.mjs';
import { listener } from './http.mjs';

const { adapter, port, pob, ...config } = readConfig();

let source;
if (pob) {
  const { startCheck, ...settings } = pob;
  source = createPobCases(settings);
  // POB is asked what fields it has before anyone opens a list: a field name that is wrong for this installation is
  // found here. `strict` refuses to start on it; `warn`, the default while the check itself is unproven, says so.
  if (startCheck !== 'off') {
    let problem;
    try {
      const { described, missing } = await source.check();
      if (!described)
        problem = 'POB has no description of an errand at /entity/case, so the field names are unchecked.';
      else if (missing.length)
        problem = `POB does not seem to have these fields; set them in POB_FIELDS: ${missing.join(', ')}.`;
    } catch {
      problem = 'POB could not be asked for its fields: it did not answer, or it refused the credential.';
    }
    if (problem && startCheck === 'strict') throw new Error(problem);
    if (problem) console.warn('pob connector: ' + problem);
  }
} else source = createFixtureCases();

const { handle } = createConnector({ ...config, source });

createServer(listener(handle)).listen(port, () =>
  console.log(`pob connector listening on :${port} (${adapter} adapter)`),
);
