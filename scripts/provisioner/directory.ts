import type { Capability } from '@clew/contracts';

/**
 * The development stack's directory: what a municipality's source (Metakatalogen in Sundsvall, D68) knows about its
 * people. A person has a unit and a manager flag, the two facts the provisioner turns into D68's `unit:` and
 * `unit-manager:` groups; may work in or manage further units; may be in plain directory groups, which mean nothing in
 * Clew until an administrator maps one to a capability (D85) or names it in an audience (D23); and may hold Clew
 * capabilities that become `capability:` groups. Fifty people in eleven units: three personas with a Keycloak account
 * (`login`) and forty-seven generated deterministically, so every manager has a team and the users page has something
 * to page. Nothing in Clew reads this file; the provisioner does, and `scripts/auth-setup.ts` for the personas' accounts.
 */
export interface DirectoryUnit {
  id: string;
  label: string;
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
/** The units and how many people each has, personas included. Unit `unit-hr` is managed by the ekonomi manager. */
const UNITS: Array<DirectoryUnit & { size: number }> = [
  { id: 'unit-skola', label: 'Bergsåkers skola', size: 6 },
  { id: 'unit-omsorg', label: 'Hemtjänst Centrum', size: 7 },
  { id: 'unit-it', label: 'IT och digitalisering', size: 5 },
  { id: 'unit-forskola', label: 'Granlo förskola', size: 5 },
  { id: 'unit-bibliotek', label: 'Stadsbiblioteket', size: 4 },
  { id: 'unit-ekonomi', label: 'Ekonomiavdelningen', size: 4 },
  { id: 'unit-hr', label: 'HR-avdelningen', size: 3 },
  { id: 'unit-gata', label: 'Gata och park', size: 5 },
  { id: 'unit-bygglov', label: 'Bygglovsenheten', size: 4 },
  { id: 'unit-socialtjanst', label: 'Socialtjänst barn och unga', size: 4 },
  { id: 'unit-kommunikation', label: 'Kommunikationsavdelningen', size: 3 },
];
const GROUPS: DirectoryGroup[] = [
  { id: 'ad:alla-chefer', label: 'Alla chefer' },
  { id: 'ad:intranat-redaktorer', label: 'Intranätsredaktörer' },
  { id: 'ad:skyddsombud', label: 'Skyddsombud' },
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
    groups: ['ad:alla-chefer'],
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
    capabilities: ['admin.connectors', 'admin.users'],
    login: true,
  },
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
];
const FAMILY = ['Lindqvist', 'Nyström', 'Pettersson', 'Sjöberg'];
const ascii = (s: string) => s.toLowerCase().replace(/[åä]/g, 'a').replace(/ö/g, 'o').replace(/é/g, 'e');
/**
 * Fills every unit up to its size after the personas. The first generated person of a unit without a persona manager
 * is its manager (except HR, whose manager is ekonomi's); the second person of every other unit is a skyddsombud; the
 * second in the library also works in communications; everyone in communications edits the intranet; the IT manager
 * administers connectors. Deterministic, so the tests can count.
 */
function generated(): DirectoryPerson[] {
  const people: DirectoryPerson[] = [];
  let k = 0;
  UNITS.forEach((unit, index) => {
    const taken = personas.filter(p => p.department === unit.id).length,
      personaManager = personas.some(p => p.department === unit.id && p.manager);
    for (let i = taken; i < unit.size; i++, k++) {
      const givenName = GIVEN[k % GIVEN.length]!,
        familyName = FAMILY[Math.floor(k / GIVEN.length)]!,
        userName = ascii(givenName) + '.' + ascii(familyName),
        manager = i === taken && !personaManager && unit.id !== 'unit-hr',
        groups = [
          ...(manager ? ['ad:alla-chefer'] : []),
          ...(index % 2 === 0 && i === taken + 1 ? ['ad:skyddsombud'] : []),
          ...(unit.id === 'unit-kommunikation' ? ['ad:intranat-redaktorer'] : []),
        ];
      people.push({
        externalId: 'dev:' + userName,
        userName,
        givenName,
        familyName,
        email: userName + '@clew.test',
        department: unit.id,
        manager,
        ...(unit.id === 'unit-ekonomi' && manager ? { alsoManages: ['unit-hr'] } : {}),
        ...(unit.id === 'unit-bibliotek' && i === taken + 1 ? { alsoIn: ['unit-kommunikation'] } : {}),
        ...(groups.length ? { groups } : {}),
        capabilities: unit.id === 'unit-it' && manager ? ['admin.connectors'] : [],
      });
    }
  });
  return people;
}
export const developmentDirectory: Directory = {
  units: UNITS.map(({ id, label }) => ({ id, label })),
  groups: GROUPS,
  people: [...personas, ...generated()],
};
export const fullName = (p: DirectoryPerson) => `${p.givenName} ${p.familyName}`;
