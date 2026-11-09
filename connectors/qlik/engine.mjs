// Qlik's Engine API (QIX) behind the statistics port (D82): JSON-RPC 2.0 over one WebSocket per read.
// It opens the app, builds one session hypercube from configuration (unit and month as dimensions, the rates and
// the headcount as measures), pages through it and closes. Qlik computes; this file only maps cells to rows.
//
// The identity is whatever the token says: a Qlik Cloud OAuth token, or a JWT for a Qlik Sense Enterprise virtual
// proxy. D82 asks for a service identity whose section access reaches nothing but this aggregate.
import { StatisticsUnavailable, toStatRow } from './statistics.mjs';

// Qlik refuses more than 10,000 cells in one GetHyperCubeData call (error 7009).
const CELLS_PER_PAGE = 10_000;
const MAX_ROWS = 50_000;
const MEASURES = ['total', 'short', 'long', 'headcount'];
const PERIOD = /^\d{4}-(0[1-9]|1[0-2])$/;
// Day zero of Qlik's date serial numbers.
const QLIK_EPOCH = Date.UTC(1899, 11, 30);

/** Node's own WebSocket (undici) takes request headers in its second argument; nothing else is installed. */
const nodeSocket = (url, headers) => new WebSocket(url, { headers });

function measureDef(def) {
  return def.startsWith('library:') ? { qLibraryId: def.slice('library:'.length) } : { qDef: { qDef: def } };
}

/** The hypercube the connector asks for: dimensions unit and period, then the configured measures in a fixed order. */
export function hypercubeFor(cube) {
  const measures = MEASURES.filter(m => cube.measures[m]);
  return {
    measures,
    qProp: {
      qInfo: { qType: 'clew-sick-leave' },
      qHyperCubeDef: {
        qDimensions: [{ qDef: { qFieldDefs: [cube.unit] } }, { qDef: { qFieldDefs: [cube.period] } }],
        qMeasures: measures.map(m => measureDef(cube.measures[m])),
        qSuppressZero: false,
        qSuppressMissing: true,
        qInitialDataFetch: [],
      },
    },
  };
}

function periodOf(cell) {
  const text = typeof cell?.qText === 'string' ? cell.qText.trim() : '';
  if (PERIOD.test(text)) return text;
  if (/^\d{4}-\d{2}-\d{2}/.test(text)) return text.slice(0, 7);
  if (typeof cell?.qNum === 'number' && Number.isFinite(cell.qNum)) {
    const d = new Date(QLIK_EPOCH + Math.floor(cell.qNum) * 86_400_000);
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
  }
  return '';
}

const numberOf = cell => (typeof cell?.qNum === 'number' && Number.isFinite(cell.qNum) ? cell.qNum : null);

/** One hypercube row (an array of cells) to the port's row, or null. */
export function toRowFromCells(cells, measures, ratesAs = 'fraction') {
  if (!Array.isArray(cells)) return null;
  const raw = { unit: cells[0]?.qText, period: periodOf(cells[1]) };
  measures.forEach((m, i) => {
    const n = numberOf(cells[2 + i]);
    raw[m] = n === null ? null : m === 'headcount' ? Math.round(n) : ratesAs === 'fraction' ? n * 100 : n;
  });
  return toStatRow(raw);
}

function rpcOver(ws) {
  let next = 1;
  const pending = new Map();
  const failAll = () => {
    for (const p of pending.values()) p.reject(new StatisticsUnavailable('The engine connection closed.'));
    pending.clear();
  };
  ws.addEventListener('message', event => {
    let message;
    try {
      message = JSON.parse(String(event.data));
    } catch {
      return;
    }
    // Notifications (OnConnected and the like) carry no id.
    if (message?.id === undefined) return;
    const p = pending.get(message.id);
    if (!p) return;
    pending.delete(message.id);
    if (message.error) p.reject(new StatisticsUnavailable(`Engine error ${message.error.code ?? 'unknown'}.`));
    else p.resolve(message.result);
  });
  ws.addEventListener('close', failAll);
  ws.addEventListener('error', failAll);
  return (handle, method, params = {}) =>
    new Promise((resolve, reject) => {
      const id = next++;
      pending.set(id, { resolve, reject });
      ws.send(JSON.stringify({ jsonrpc: '2.0', id, handle, method, params }));
    });
}

const opened = ws =>
  new Promise((resolve, reject) => {
    if (ws.readyState === 1) return resolve();
    ws.addEventListener('open', () => resolve(), { once: true });
    ws.addEventListener('error', () => reject(new StatisticsUnavailable('The engine refused the connection.')), {
      once: true,
    });
    ws.addEventListener('close', () => reject(new StatisticsUnavailable('The engine closed the connection.')), {
      once: true,
    });
  });

const isoOrNull = value => {
  const t = typeof value === 'string' ? Date.parse(value) : NaN;
  return Number.isFinite(t) ? new Date(t).toISOString() : null;
};

/**
 * token: a string, or a function that returns one for each read (for a source that renews it).
 * url: the engine's base, `wss://<tenant>` (Qlik Cloud) or `wss://<host>/<virtual proxy>` (Qlik Sense Enterprise);
 * the app id is appended as `/app/<id>`. cube: { unit, period, measures: { total, short?, long?, headcount? } }, a
 * measure being an expression or `library:<master measure id>`. ratesAs: whether the rate measures answer a fraction
 * (0.052, Qlik's usual) or a percentage (5.2).
 */
export function createQlikStatistics({
  url,
  appId,
  token,
  cube,
  ratesAs = 'fraction',
  socket = nodeSocket,
  timeoutMs = 8000,
} = {}) {
  let base;
  try {
    base = new URL(url ?? '');
  } catch {
    throw new Error('QLIK_URL must be a ws:// or wss:// URL.');
  }
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(base.hostname);
  if (base.protocol !== 'wss:' && !(base.protocol === 'ws:' && local))
    throw new Error('QLIK_URL must use wss:// (ws:// only on localhost).');
  if (!appId) throw new Error('QLIK_APP_ID is required.');
  // The headcount is required: without it the connector cannot hold back a group smaller than the minimum.
  if (
    !cube ||
    typeof cube.unit !== 'string' ||
    typeof cube.period !== 'string' ||
    !cube.measures?.total ||
    !cube.measures?.headcount
  )
    throw new Error('QLIK_SICK_LEAVE_CUBE must name unit, period, measures.total and measures.headcount.');
  if (ratesAs !== 'fraction' && ratesAs !== 'percent') throw new Error('QLIK_RATES_AS must be fraction or percent.');

  const target = `${base.toString().replace(/\/$/, '')}/app/${encodeURIComponent(appId)}`;
  const { measures, qProp } = hypercubeFor(cube);
  const width = 2 + measures.length;
  const pageHeight = Math.floor(CELLS_PER_PAGE / width);

  async function readOnce(ws) {
    await opened(ws);
    const call = rpcOver(ws);
    const doc = (await call(-1, 'OpenDoc', { qDocName: appId }))?.qReturn?.qHandle;
    if (typeof doc !== 'number') throw new StatisticsUnavailable('OpenDoc returned no handle.');
    const app = await call(doc, 'GetAppLayout');
    const object = (await call(doc, 'CreateSessionObject', { qProp }))?.qReturn?.qHandle;
    if (typeof object !== 'number') throw new StatisticsUnavailable('CreateSessionObject returned no handle.');
    const size = (await call(object, 'GetLayout'))?.qLayout?.qHyperCube?.qSize?.qcy;
    if (!Number.isInteger(size) || size < 0) throw new StatisticsUnavailable('The hypercube has no size.');
    if (size > MAX_ROWS) throw new StatisticsUnavailable('The hypercube is larger than expected.');
    const rows = [];
    for (let top = 0; top < size; top += pageHeight) {
      const result = await call(object, 'GetHyperCubeData', {
        qPath: '/qHyperCubeDef',
        qPages: [{ qLeft: 0, qTop: top, qWidth: width, qHeight: Math.min(pageHeight, size - top) }],
      });
      for (const cells of result?.qDataPages?.[0]?.qMatrix ?? []) {
        const row = toRowFromCells(cells, measures, ratesAs);
        if (row) rows.push(row);
      }
    }
    return { reloadedAt: isoOrNull(app?.qLayout?.qLastReloadTime), rows };
  }

  return {
    async read() {
      let ws;
      let timer;
      try {
        const bearer = typeof token === 'function' ? await token() : token;
        ws = socket(target, bearer ? { authorization: `Bearer ${bearer}` } : {});
        const timeout = new Promise((_, reject) => {
          timer = setTimeout(() => reject(new StatisticsUnavailable('The engine did not answer in time.')), timeoutMs);
        });
        return await Promise.race([readOnce(ws), timeout]);
      } catch (error) {
        throw error instanceof StatisticsUnavailable
          ? error
          : new StatisticsUnavailable('The engine could not be read.');
      } finally {
        clearTimeout(timer);
        try {
          ws?.close();
        } catch {}
      }
    },
  };
}
