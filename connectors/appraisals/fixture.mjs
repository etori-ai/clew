// The appraisal system's synthetic records: who is in the round, with whom, and the action points agreed. Everything is
// keyed on the provisioned user name (SCIM `userName`, D68), which is all another system knows a person by. Days are
// offsets from "today", so the round is always the open one. Edit these tables to change what the fixture answers.

/**
 * The people in the round, with their manager in this system. The five are the people on Bergsåkers skola
 * (`unit-skola`) in the development directory, and their user names follow its rule: given and family name in lower
 * case, å/ä to a and ö to o, joined by a dot (`scripts/provisioner/directory.ts`). Clew drops a row about a person who
 * is not on the reader's own units, so a name here that the directory does not have is simply not shown.
 */
export const PEOPLE = [
  { userName: 'anna.lindqvist', name: 'Anna Lindqvist', manager: 'hillevi' },
  { userName: 'erik.sandstrom', name: 'Erik Sandström', manager: 'hillevi' },
  { userName: 'maria.kallstrom', name: 'Maria Källström', manager: 'hillevi' },
  { userName: 'johan.bystrom', name: 'Johan Byström', manager: 'hillevi' },
  { userName: 'karin.lindqvist', name: 'Karin Lindqvist', manager: 'hillevi' },
];

/** The managers this system knows, by user name, with their names (see `callerOf` in connector.mjs). */
export const MANAGERS = [{ userName: 'hillevi', name: 'Hillevi Berg' }];

/** The open round: it opened `opensIn` days from today (negative: in the past) and is due `dueIn` days from today. */
export const ROUND = { id: 'current', opensIn: -30, dueIn: 50 };

/**
 * Where each person stands in the round. `held`: the day it was held (`day`, an offset). `booked`: the day and the
 * local time it is booked. A person without an entry has no talk yet.
 */
export const TALKS = {
  'anna.lindqvist': { state: 'held', day: -12 },
  'erik.sandstrom': { state: 'booked', day: 3, time: '09:00' },
  'johan.bystrom': { state: 'booked', day: 8, time: '13:30' },
  'karin.lindqvist': { state: 'held', day: -4 },
};

/**
 * The action points. `person`: the employee the talk was with. `owner`: who is to do it. `round`: `earlier` for one
 * agreed in the last round (an open one is carried into this one), `current` for this round's. `doneDaysAgo`: done,
 * that many days ago.
 */
export const COMMITMENTS = [
  {
    id: 'ap-101',
    person: 'erik.sandstrom',
    owner: 'employee',
    round: 'earlier',
    text: 'Prova ett ämnesövergripande projekt med årskurs 8',
    dueIn: -95,
  },
  {
    id: 'ap-102',
    person: 'johan.bystrom',
    owner: 'manager',
    round: 'earlier',
    text: 'Se över ljudmiljön i klassrummet',
    dueIn: -60,
  },
  {
    id: 'ap-103',
    person: 'anna.lindqvist',
    owner: 'employee',
    round: 'earlier',
    text: 'Läsa in sig på det nya stödet för betygssättning',
    dueIn: -120,
    doneDaysAgo: 130,
  },
  {
    id: 'ap-201',
    person: 'anna.lindqvist',
    owner: 'employee',
    round: 'current',
    text: 'Gå handledarutbildningen för nya lärare',
    dueIn: 40,
  },
  {
    id: 'ap-202',
    person: 'anna.lindqvist',
    owner: 'manager',
    round: 'current',
    text: 'Lägga in en planeringsdag i månaden i schemat',
    dueIn: 20,
  },
  {
    id: 'ap-203',
    person: 'karin.lindqvist',
    owner: 'employee',
    round: 'current',
    text: 'Leda ämneslagets uppföljning av läsförståelsen',
    dueIn: 30,
  },
  {
    id: 'ap-204',
    person: 'karin.lindqvist',
    owner: 'manager',
    round: 'current',
    text: 'Boka en extra genomgång av elevhälsans rutiner',
    dueIn: 14,
    doneDaysAgo: 2,
  },
];
