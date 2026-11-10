import type { Capability } from '@clew/contracts';

/**
 * The development stack's directory: what a municipality's source (Metakatalogen in Sundsvall, D68) knows about its
 * people. A person has a unit and a manager flag, the two facts the provisioner turns into D68's `unit:` and
 * `unit-manager:` groups; may work in or manage further units; may be in plain directory groups, which mean nothing in
 * Clew until an administrator maps one to a capability (D85) or names it in an audience (D23); and may hold Clew
 * capabilities that become `capability:` groups. Two hundred and ten people in thirty-five units: three personas with
 * a Keycloak account (`login`), seven written by hand for the names a real directory holds, and the rest generated
 * deterministically, so every manager has a team, the users page has something to page and a group has anything from
 * no members to seventy.
 *
 * The units are a tree (D99), as an organisation is: the municipality, its five administrations, an area between an
 * administration and some of its units, the twenty-five units people work in, and a unit under one of those. A unit
 * names the unit above it and nothing else; there are managers on every level, an area nobody leads, so the line
 * passes through it, and a unit that is led from the one above it. Nothing in Clew reads this file; the provisioner
 * does, and `scripts/auth-setup.ts` for the personas' accounts.
 */
export interface DirectoryUnit {
  id: string;
  label: string;
  /** The unit above this one; absent on a root. */
  parent?: string;
}
/** A plain directory group, as a directory would hold it: no meaning in Clew by itself. */
export interface DirectoryGroup {
  id: string;
  label: string;
}
export interface DirectoryPerson {
  /** The source's stable id, never reused. `dev:` marks the development stack's people. */
  externalId: string;
  /** What a login is matched on; the Keycloak username in development. */
  userName: string;
  givenName: string;
  familyName: string;
  email: string;
  /** The unit the person works in. */
  department: string;
  /** Whether the person manages that unit. */
  manager: boolean;
  /** Further units the person works in as an employee. */
  alsoIn?: string[];
  /** Further units the person manages. */
  alsoManages?: string[];
  /** Plain directory groups the person is in. */
  groups?: string[];
  capabilities: Capability[];
  /** A persona: has a Keycloak account in the development stack and a fixed person id the fixtures key on. */
  login?: boolean;
}
export interface Directory {
  units: DirectoryUnit[];
  groups: DirectoryGroup[];
  people: DirectoryPerson[];
}
/**
 * The administration a unit belongs to; each is a unit of its own above them (`unit-forvaltning-…`) and also a plain
 * group of everyone in it (`ad:forvaltning-…`).
 */
const AREAS = {
  utbildning: 'Barn och utbildning',
  omsorg: 'Vård och omsorg',
  stadsbyggnad: 'Stadsbyggnad',
  kultur: 'Kultur och fritid',
  ledning: 'Kommunstyrelsekontoret',
} as const;
type Area = keyof typeof AREAS;
interface UnitPlan extends DirectoryUnit {
  /** The administration the unit belongs to; the municipality itself belongs to none. */
  area?: Area;
  /** How many people work in the unit, the hand-written ones included. */
  size: number;
  /** How many of the unit's own people manage it: one unless said. */
  managers?: number;
  /**
   * The unit whose manager manages this one too, so nobody in it is a manager: the flat way, where the manager is
   * pushed into both units' manager groups. The tree's way is a `parent` and no manager, as the fritidshem has.
   */
  managedBy?: string;
}
const ROOT = 'unit-kommun';
const areaUnit = (area: Area) => 'unit-forvaltning-' + area;
const UNITS: UnitPlan[] = [
  { id: 'unit-skola', label: 'Bergsåkers skola', area: 'utbildning', size: 12, parent: 'unit-grundskola' },
  { id: 'unit-skola-haga', label: 'Hagaskolan', area: 'utbildning', size: 14, parent: 'unit-grundskola' },
  { id: 'unit-skola-nacksta', label: 'Nacksta skola', area: 'utbildning', size: 10, parent: 'unit-grundskola' },
  // A rektor and a biträdande rektor: a unit with two managers.
  { id: 'unit-gymnasium', label: 'Selångers gymnasium', area: 'utbildning', size: 16, managers: 2 },
  { id: 'unit-forskola', label: 'Granlo förskola', area: 'utbildning', size: 7 },
  { id: 'unit-forskola-skonsberg', label: 'Skönsbergs förskola', area: 'utbildning', size: 6 },
  // Led from the school above it: nobody here is a manager, and the school's rektor is not pushed as one here either.
  {
    id: 'unit-fritidshem',
    label: 'Skönsmons fritidshem',
    area: 'utbildning',
    size: 4,
    parent: 'unit-skola-nacksta',
    managers: 0,
  },
  { id: 'unit-omsorg', label: 'Hemtjänst Centrum', area: 'omsorg', size: 14, parent: 'unit-hemtjanst' },
  { id: 'unit-omsorg-norr', label: 'Hemtjänst Norr', area: 'omsorg', size: 12, parent: 'unit-hemtjanst' },
  { id: 'unit-aldreboende', label: 'Lindgårdens äldreboende', area: 'omsorg', size: 13 },
  { id: 'unit-lss', label: 'LSS-boende Bosvedjan', area: 'omsorg', size: 8 },
  { id: 'unit-socialtjanst', label: 'Socialtjänst barn och unga', area: 'omsorg', size: 9 },
  { id: 'unit-forsorjning', label: 'Försörjningsstöd', area: 'omsorg', size: 6 },
  { id: 'unit-gata', label: 'Gata och park', area: 'stadsbyggnad', size: 10 },
  { id: 'unit-bygglov', label: 'Bygglovsenheten', area: 'stadsbyggnad', size: 5 },
  { id: 'unit-miljo', label: 'Miljö och hälsoskydd', area: 'stadsbyggnad', size: 5 },
  { id: 'unit-fastighet', label: 'Fastighetsservice', area: 'stadsbyggnad', size: 7 },
  { id: 'unit-bibliotek', label: 'Stadsbiblioteket', area: 'kultur', size: 6 },
  { id: 'unit-kulturskolan', label: 'Kulturskolan', area: 'kultur', size: 5 },
  { id: 'unit-fritid', label: 'Idrott och fritid', area: 'kultur', size: 5 },
  { id: 'unit-it', label: 'IT och digitalisering', area: 'ledning', size: 7 },
  { id: 'unit-ekonomi', label: 'Ekonomiavdelningen', area: 'ledning', size: 6 },
  { id: 'unit-hr', label: 'HR-avdelningen', area: 'ledning', size: 4, managedBy: 'unit-ekonomi' },
  { id: 'unit-kommunikation', label: 'Kommunikationsavdelningen', area: 'ledning', size: 4 },
  { id: 'unit-kansli', label: 'Kommunkansliet', area: 'ledning', size: 5 },
  // The tree above and below those twenty-five (D99). They come last, so the people generated for the units above keep
  // their names: the municipality and its director, the administrations and their heads, an area with a head and one
  // without, and a unit under Hillevi's school with a manager of its own, who reports to her.
  { id: ROOT, label: 'Kommunen', size: 1 },
  ...(Object.keys(AREAS) as Area[]).map((area): UnitPlan => ({
    id: areaUnit(area),
    label: AREAS[area],
    area,
    size: area === 'utbildning' ? 2 : 1,
    parent: ROOT,
  })),
  { id: 'unit-grundskola', label: 'Grundskola', area: 'utbildning', size: 1, parent: areaUnit('utbildning') },
  { id: 'unit-hemtjanst', label: 'Hemtjänst', area: 'omsorg', size: 0, parent: areaUnit('omsorg') },
  { id: 'unit-skola-fritids', label: 'Bergsåkers fritidshem', area: 'utbildning', size: 2, parent: 'unit-skola' },
];
/** The units people were generated for before the tree: their plain-group rules are theirs alone. */
const TREE_UNITS = new Set([
  ROOT,
  ...(Object.keys(AREAS) as Area[]).map(areaUnit),
  'unit-grundskola',
  'unit-hemtjanst',
  'unit-skola-fritids',
]);
/** The second generated person of the unit on the left also works in the unit on the right. */
const SECOND_UNIT: Record<string, string> = {
  'unit-bibliotek': 'unit-kommunikation',
  'unit-skola-haga': 'unit-skola-nacksta',
  'unit-omsorg': 'unit-omsorg-norr',
};
const areaGroup = (area: Area) => 'ad:forvaltning-' + area;
const GROUPS: DirectoryGroup[] = [
  { id: 'ad:alla-chefer', label: 'Alla chefer' },
  { id: 'ad:rektorer', label: 'Rektorer' },
  { id: 'ad:krisledning', label: 'Krisledningsgruppen' },
  { id: 'ad:skyddsombud', label: 'Skyddsombud' },
  { id: 'ad:intranat-redaktorer', label: 'Intranätsredaktörer' },
  { id: 'ad:fackliga-fortroendevalda', label: 'Fackliga förtroendevalda' },
  { id: 'ad:elevhalsa', label: 'Elevhälsoteamet' },
  { id: 'ad:nattpersonal', label: 'Nattpersonal' },
  { id: 'ad:systemforvaltare', label: 'Systemförvaltare' },
  // A group the directory holds and nobody is in yet.
  { id: 'ad:projekt-e-arkiv', label: 'Projekt e-arkiv' },
  ...(Object.keys(AREAS) as Area[]).map(area => ({ id: areaGroup(area), label: AREAS[area] })),
];
/** A generated person's place: the unit, their number among the unit's generated people, and whether they manage it. */
interface Seat {
  unit: UnitPlan;
  n: number;
  manager: boolean;
}
const CRISIS_UNITS = ['unit-it', 'unit-kommunikation', 'unit-kansli', 'unit-omsorg', 'unit-gata'];
const NIGHT_UNITS = ['unit-omsorg', 'unit-omsorg-norr', 'unit-aldreboende', 'unit-lss'];
/** Who is in which plain group, one rule a group. A seat that matches several is in several; most match none. */
const MEMBERSHIPS: Array<[group: string, when: (seat: Seat) => boolean]> = [
  ['ad:alla-chefer', s => s.manager],
  ['ad:rektorer', s => s.manager && s.unit.area === 'utbildning'],
  ['ad:krisledning', s => s.manager && CRISIS_UNITS.includes(s.unit.id)],
  ['ad:skyddsombud', s => s.n === 2 && s.unit.size >= 5],
  ['ad:intranat-redaktorer', s => s.unit.id === 'unit-kommunikation' || (s.n === 3 && s.unit.size >= 10)],
  ['ad:fackliga-fortroendevalda', s => s.n === 4 && s.unit.size >= 8],
  ['ad:elevhalsa', s => s.n === 5 && s.unit.area === 'utbildning'],
  ['ad:nattpersonal', s => s.n >= 3 && s.n % 3 === 0 && NIGHT_UNITS.includes(s.unit.id)],
  ['ad:systemforvaltare', s => !s.manager && (s.unit.id === 'unit-it' || (s.n === 1 && s.unit.area === 'ledning'))],
];
// Hillevi is the manager persona (rektor); Hassan the employee persona (undersköterska, mobile); Mikael the
// systemförvaltare persona: administration is a capability, not a work role (D23, D85).
const personas: DirectoryPerson[] = [
  {
    externalId: 'dev:hillevi',
    userName: 'hillevi',
    givenName: 'Hillevi',
    familyName: 'Berg',
    email: 'hillevi@clew.test',
    department: 'unit-skola',
    manager: true,
    groups: ['ad:alla-chefer', 'ad:rektorer'],
    capabilities: [],
    login: true,
  },
  {
    externalId: 'dev:hassan',
    userName: 'hassan',
    givenName: 'Hassan',
    familyName: 'Ali',
    email: 'hassan@clew.test',
    department: 'unit-omsorg',
    manager: false,
    capabilities: [],
    login: true,
  },
  {
    externalId: 'dev:mikael',
    userName: 'mikael',
    givenName: 'Mikael',
    familyName: 'Lund',
    email: 'mikael@clew.test',
    department: 'unit-it',
    manager: false,
    groups: ['ad:intranat-redaktorer'],
    capabilities: ['admin.connectors', 'admin.users', 'admin.appearance'],
    login: true,
  },
];
/**
 * The names a generator does not come up with and a real directory holds: a hyphen, a particle, an apostrophe,
 * accents, two family names, a name too long for a narrow column, a very short one, and a second person with the same
 * name as somebody else (the first Anna Lindqvist is generated). Employees without a login.
 */
const named = (givenName: string, familyName: string, userName: string, department: string): DirectoryPerson => ({
  externalId: 'dev:' + userName,
  userName,
  givenName,
  familyName,
  email: userName + '@clew.test',
  department,
  manager: false,
  capabilities: [],
});
const handwritten: DirectoryPerson[] = [
  ...personas,
  named('Ann-Sofie', 'af Sandeberg', 'ann-sofie.afsandeberg', 'unit-kansli'),
  named('José', 'Hernández García', 'jose.hernandez', 'unit-gata'),
  named('Zoë', "O'Connor", 'zoe.oconnor', 'unit-kulturskolan'),
  named('Åsa', 'Öberg-Ångström', 'asa.oberg-angstrom', 'unit-aldreboende'),
  named('Anna', 'Lindqvist', 'anna.lindqvist2', 'unit-omsorg-norr'),
  named('Maximiliana Alexandra', 'von Schwerin-Gyllenstierna', 'maximiliana.vonschwerin', 'unit-ekonomi'),
  named('Bo', 'Ek', 'bo.ek', 'unit-fritid'),
];
const GIVEN = [
  'Anna',
  'Erik',
  'Fatima',
  'Johan',
  'Karin',
  'Lars',
  'Maria',
  'Omar',
  'Petra',
  'Sven',
  'Yusuf',
  'Elin',
  'Nils',
  'Sara',
  'Amir',
  'Birgitta',
  'Leila',
  'Mattias',
  'Hanna',
  'Dragan',
];
const FAMILY = [
  'Lindqvist',
  'Nyström',
  'Pettersson',
  'Sjöberg',
  'Andersson',
  'Bergström',
  'Eriksson',
  'Hosseini',
  'Karlsson',
  'Lundgren',
];
/**
 * Hillevi's school starts with named people, not generated ones: the same five people with the same user names and
 * addresses as the calendar accounts in `packages/calendar/src/accounts.ts` and `.devcontainer/calendar/seed.php`, so
 * the people the planner proposes talks for (D96 item 3) have calendars. The generator's counter still advances past
 * them, so every other unit keeps its people, and the rest of the school is generated.
 */
const SCHOOL: Array<Pick<DirectoryPerson, 'userName' | 'givenName' | 'familyName'>> = [
  { userName: 'anna', givenName: 'Anna', familyName: 'Lindqvist' },
  { userName: 'erik', givenName: 'Erik', familyName: 'Sandström' },
  { userName: 'maria', givenName: 'Maria', familyName: 'Källström' },
  { userName: 'johan', givenName: 'Johan', familyName: 'Byström' },
  { userName: 'karin', givenName: 'Karin', familyName: 'Lindqvist' },
];
const ascii = (s: string) => s.toLowerCase().replace(/[åä]/g, 'a').replace(/ö/g, 'o').replace(/é/g, 'e');
/**
 * The `k`th generated name. Each given name meets each family name once in two hundred, and the family name moves on
 * with every person, so a unit is not one family.
 */
const nameOf = (k: number) => ({
  givenName: GIVEN[k % GIVEN.length]!,
  familyName: FAMILY[(k + Math.floor(k / GIVEN.length)) % FAMILY.length]!,
});
/**
 * Fills every unit up to its size after the hand-written people. The first generated people of a unit manage it (one,
 * or as many as the unit says; none where a persona does or another unit's manager does, and that manager then
 * manages both). Plain groups follow `MEMBERSHIPS`, a second unit `SECOND_UNIT`; the IT manager administers
 * connectors and the second person at the kansli administers users. Deterministic, so the tests can count.
 */
function generated(): DirectoryPerson[] {
  const people: DirectoryPerson[] = [];
  let k = 0;
  for (const unit of UNITS) {
    const placed = handwritten.filter(p => p.department === unit.id),
      managers = unit.managedBy || placed.some(p => p.manager) ? 0 : (unit.managers ?? 1),
      alsoManages = UNITS.filter(u => u.managedBy === unit.id).map(u => u.id);
    for (let n = 0; n < unit.size - placed.length; n++, k++) {
      const named = unit.id === 'unit-skola' ? SCHOOL[n] : undefined,
        { givenName, familyName } = named ?? nameOf(k),
        userName = named?.userName ?? ascii(givenName) + '.' + ascii(familyName),
        seat: Seat = { unit, n, manager: n < managers },
        // A manager in the tree is a manager like any other; the other rules were written for the first units.
        groups = TREE_UNITS.has(unit.id)
          ? seat.manager
            ? ['ad:alla-chefer']
            : []
          : MEMBERSHIPS.filter(([, when]) => when(seat)).map(([group]) => group);
      people.push({
        externalId: 'dev:' + userName,
        userName,
        givenName,
        familyName,
        email: userName + '@clew.test',
        department: unit.id,
        manager: seat.manager,
        ...(seat.manager && alsoManages.length ? { alsoManages } : {}),
        ...(n === 1 && SECOND_UNIT[unit.id] ? { alsoIn: [SECOND_UNIT[unit.id]!] } : {}),
        ...(groups.length ? { groups } : {}),
        capabilities:
          unit.id === 'unit-it' && seat.manager
            ? ['admin.connectors']
            : unit.id === 'unit-kansli' && n === 1
              ? ['admin.users']
              : [],
      });
    }
  }
  return people;
}
/** Everyone is in their administration's group, the hand-written people too; the municipality's own belong to none. */
const inArea = (p: DirectoryPerson): DirectoryPerson => {
  const area = UNITS.find(u => u.id === p.department)!.area;
  return area ? { ...p, groups: [...(p.groups ?? []), areaGroup(area)] } : p;
};
/** A unit that names no unit above it stands under its administration. */
const parentOf = (unit: UnitPlan) =>
  unit.parent ?? (unit.area && unit.id !== areaUnit(unit.area) ? areaUnit(unit.area) : undefined);
export const developmentDirectory: Directory = {
  units: UNITS.map(unit => {
    const parent = parentOf(unit);
    return { id: unit.id, label: unit.label, ...(parent ? { parent } : {}) };
  }),
  groups: GROUPS,
  people: [...handwritten, ...generated()].map(inArea),
};
export const fullName = (p: DirectoryPerson) => `${p.givenName} ${p.familyName}`;
