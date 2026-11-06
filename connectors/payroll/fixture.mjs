// Payroll's own employee directory. These synthetic source refs match the HR feed by agreement,
// not by importing another connector's records or trusting the requested person.
export const employees = Array.from({ length: 12 }, (_, i) => ({
  ref: 'hr:emp:' + (1001 + i),
  unitId: 'unit-skola',
}));
