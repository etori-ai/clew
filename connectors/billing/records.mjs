// The billing record port and the made-up records behind it. A source answers in BillingPreprocessor's own shape
// (`BillingRecord`, API 4.5), so connector.mjs reads the fixture and the API alike. The records are synthetic: the
// descriptions follow what Lön och pension bills, every name and number is invented.

/** The source did not answer, or answered something that cannot be read. Nothing is known about a write. */
export class SourceUnavailable extends Error {
  name = 'SourceUnavailable';
}
/** The record does not exist in the configured category, or the gateway hides it. */
export class SourceNotFound extends Error {
  name = 'SourceNotFound';
}
/** The source answered and refused the change. Nothing was changed. */
export class SourceRefused extends Error {
  name = 'SourceRefused';
}

/** The made-up customers' names, per type, as Draken's table names them; the API adapter is given its own table. */
export const FIXTURE_CUSTOMERS = {
  INTERNAL: {
    10: 'Kommunledningskontoret',
    60: 'Barn- och utbildningsförvaltningen',
    70: 'Vård- och omsorgsförvaltningen',
  },
  EXTERNAL: {},
};

export const STATUSES = ['NEW', 'APPROVED', 'INVOICED', 'REJECTED'];

/** The next 15th after `day` (YYYY-MM-DD): BillingPreprocessor's default `transferDate`. */
export function nextFifteenth(day) {
  const [y, m, d] = day.split('-').map(Number);
  const month = d < 15 ? m - 1 : m;
  const at = new Date(Date.UTC(y, month, 15));
  return at.toISOString().slice(0, 10);
}

const SEED = [
  {
    id: '6b1f3c1e-2a51-4d1e-9a3e-0c5a7d2e9b01',
    status: 'NEW',
    daysAgo: 1,
    description: 'Extra löneutbetalning - Direktinsättning',
    customerId: '10',
    customerReference: '1TOV31LIN',
    referenceName: 'Tove Lind',
    errandNumber: 'LoP-26110214',
    rows: [
      { text: 'Ärendenummer: LoP-26110214', quantity: 1, costPerUnit: 4200, costCenter: '15400', activity: '5756' },
    ],
  },
  {
    id: '9c2d4e5f-3b62-4e2f-8b4f-1d6b8e3f0c12',
    status: 'NEW',
    daysAgo: 2,
    description: 'Extra löneutbetalning - Systemet',
    customerId: '10',
    customerReference: '1JON22EK',
    referenceName: 'Jonas Ek',
    errandNumber: 'LoP-26110198',
    rows: [
      { text: 'Ärendenummer: LoP-26110198', quantity: 3, costPerUnit: 300, costCenter: '15400', activity: '5757' },
    ],
  },
  {
    id: 'a3e5f607-4c73-4f30-9c50-2e7c9f401d23',
    status: 'NEW',
    daysAgo: 4,
    description: 'Extra beställning',
    customerId: '60',
    customerReference: '1MAR14SUN',
    referenceName: 'Maria Sundin',
    errandNumber: 'LoP-26110171',
    rows: [
      { text: 'Ärendenummer: LoP-26110171', quantity: 2, costPerUnit: 1850, costCenter: '22100', activity: '5756' },
      { text: 'Utvecklingskostnad 2%', quantity: 2, costPerUnit: 37, costCenter: '22100', activity: '5756' },
    ],
  },
  {
    id: 'b4f60718-5d84-4041-8d61-3f8da0512e34',
    status: 'NEW',
    daysAgo: 6,
    description: 'Extra löneutbetalning - Direktinsättning',
    customerId: '70',
    customerReference: '1PER09HOL',
    referenceName: 'Per Holm',
    errandNumber: 'LoP-26110142',
    rows: [
      { text: 'Ärendenummer: LoP-26110142', quantity: 1, costPerUnit: 12500, costCenter: '31200', activity: '5756' },
    ],
  },
  {
    id: 'c5071829-6e95-4152-9e72-40aeb1623f45',
    status: 'APPROVED',
    daysAgo: 9,
    description: 'Extra löneutbetalning - Systemet',
    customerId: '10',
    customerReference: '1SAR03NOR',
    referenceName: 'Sara Nord',
    errandNumber: 'LoP-26110107',
    approvedBy: 'Lena Attestsson',
    rows: [
      { text: 'Ärendenummer: LoP-26110107', quantity: 2, costPerUnit: 300, costCenter: '15400', activity: '5757' },
    ],
  },
];

/** One seed row as BillingPreprocessor answers it, dated from `today`. */
function recordOf(seed, today, category) {
  const created = new Date(Date.parse(today + 'T09:00:00.000+01:00') - seed.daysAgo * 86_400_000).toISOString();
  const invoiceRows = seed.rows.map(row => ({
    descriptions: [row.text],
    quantity: row.quantity,
    costPerUnit: row.costPerUnit,
    totalAmount: row.quantity * row.costPerUnit,
    accountInformation: [
      { costCenter: row.costCenter, subaccount: '936300', department: '920360', activity: row.activity },
    ],
  }));
  return {
    id: seed.id,
    category,
    type: 'INTERNAL',
    status: seed.status,
    ...(seed.approvedBy ? { approvedBy: seed.approvedBy, approved: created } : {}),
    invoice: {
      customerId: seed.customerId,
      description: seed.description,
      ourReference: 'Lön och pension',
      customerReference: seed.customerReference,
      totalAmount: invoiceRows.reduce((sum, row) => sum + row.totalAmount, 0),
      invoiceRows,
    },
    created,
    modified: created,
    extraParameters: {
      errandNumber: seed.errandNumber,
      referenceName: seed.referenceName,
    },
    transferDate: nextFifteenth(today),
  };
}

/**
 * The made-up records, kept in memory: a restart begins again from the seed. `list` and `get` answer only the
 * configured category, as the API filtered by it does. A record that is `INVOICED` is refused any change, as it has
 * left for Raindance. `fault: 'unavailable'` makes every call fail, to try what a person sees then.
 */
export function createFixtureRecords({ category = 'SALARY_AND_PENSION', today = () => '2026-11-24', fault = '' } = {}) {
  let records = SEED.map(seed => recordOf(seed, today(), category));
  const calls = [];
  const check = (userName, what) => {
    calls.push({ userName, what });
    if (fault === 'unavailable') throw new SourceUnavailable('The fixture is set to be unavailable.');
  };
  const find = id => records.find(r => r.id === id && r.category === category);
  return {
    /** Every call's user name, for the tests: X-Sent-By against the API. */
    calls,
    async list(userName) {
      check(userName, 'list');
      return structuredClone(records.filter(r => r.category === category && r.status === 'NEW'));
    },
    async get(userName, id) {
      check(userName, 'get');
      const record = find(id);
      if (!record) throw new SourceNotFound('No such record.');
      return structuredClone(record);
    },
    async put(userName, record) {
      check(userName, 'put');
      const current = find(record.id);
      if (!current) throw new SourceNotFound('No such record.');
      if (current.status === 'INVOICED') throw new SourceRefused('The record is invoiced and cannot be changed.');
      if (!STATUSES.includes(record.status)) throw new SourceRefused('Unknown status.');
      const at = new Date().toISOString();
      const next = structuredClone({
        ...record,
        category,
        modified: at,
        ...(record.status === 'APPROVED' && current.status !== 'APPROVED' ? { approved: at } : {}),
      });
      if (next.status === 'NEW') delete next.approved;
      records = records.map(r => (r.id === record.id ? next : r));
      return structuredClone(next);
    },
    /** For trying by hand: back to the seed, dated today. */
    reset() {
      records = SEED.map(seed => recordOf(seed, today(), category));
    },
    /** For trying by hand: the approved records leave for Raindance, as the monthly transfer does. */
    transfer() {
      records = records.map(r => (r.status === 'APPROVED' ? { ...r, status: 'INVOICED' } : r));
    },
  };
}
