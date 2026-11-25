// The table that names a customer number, per type, from BILLING_CUSTOMERS: the same table Draken keeps in its own code
// for each year (`invoiceData-<year>.ts`, `customers.internal` by `customerId` and `customers.external` by `companyId`).
// The numbers of internal and external customers overlap, so each type has its own.
//
//   BILLING_CUSTOMERS='{"INTERNAL":{"10":"Kommunstyrelsekontoret"},"EXTERNAL":{"14":"Mitthem"}}'

const TYPES = ['INTERNAL', 'EXTERNAL'];

/** The table from its JSON text; an unset variable is an empty table. A table written wrong stops the start. */
export function customersFrom(text) {
  if (!text) return { INTERNAL: {}, EXTERNAL: {} };
  let value;
  try {
    value = JSON.parse(text);
  } catch {
    throw new Error('BILLING_CUSTOMERS must be valid JSON.');
  }
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('BILLING_CUSTOMERS must be an object with INTERNAL and EXTERNAL.');
  const table = { INTERNAL: {}, EXTERNAL: {} };
  for (const [type, names] of Object.entries(value)) {
    if (!TYPES.includes(type))
      throw new Error(`BILLING_CUSTOMERS: unknown type "${type}". Known: ${TYPES.join(', ')}.`);
    if (!names || typeof names !== 'object' || Array.isArray(names))
      throw new Error(`BILLING_CUSTOMERS.${type} must be an object of customer number to name.`);
    for (const [number, name] of Object.entries(names)) {
      if (!/^[0-9A-Za-z-]{1,40}$/.test(number) || typeof name !== 'string' || !name.trim() || name.length > 120)
        throw new Error(`BILLING_CUSTOMERS.${type}: "${number}" needs a name of at most 120 characters.`);
      table[type][number] = name.trim();
    }
  }
  return table;
}
