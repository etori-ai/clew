import type { Capability, DirectoryPhone, Employment } from '@clew/contracts';

/**
 * The development stack's directory: what a municipality's source (Metakatalogen in Sundsvall, D68) knows about its
 * people. A person has a unit and a manager flag, the two facts the provisioner turns into D68's `unit:` and
 * `unit-manager:` groups; may work in or manage further units; may be in plain directory groups, which mean nothing in
 * Clew until an administrator maps one to a capability (D85) or names it in an audience (D23); and may hold Clew
 * capabilities that become `capability:` groups; may hold positions from the source's own list, which become
 * `position:` groups and grant nothing (D108 item 5); and may have several current employments, each with its own unit and title (D114). Two hundred and fifty people in forty-eight
 * units: three personas with a Keycloak account (`login`), seven written by hand for the names a real directory
 * holds, and the rest generated deterministically, so every manager has a team, the users page has something to page
 * and a group has anything from no members to eighty.
 *
 * The units are a tree (D99), as a municipality's line organisation is, six levels at its deepest: the municipality
 * and its director; five administrations, each with a head; under three of them departments, each with a head of its
 * own who reports to the administration's (the managers below the managers); an area between a department and its
 * units; the units people work in, each with its manager; and a group under a unit. The depth differs between
 * branches, as it does in an organisation: two administrations have their units directly under them. A unit names the
 * unit above it and nothing else. There is a department nobody leads, so the line passes through it, a unit that is
 * led from the one above it, a unit with two managers, and one unit pushed the flat way. Nothing in Clew reads this
 * file; the provisioner does, and `scripts/auth-setup.ts` for the personas' accounts.
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
/** D108 item 5: a position as the source lists it, its own code and its name. Clew is sent both and nothing else. */
export interface DirectoryPosition {
  code: string;
  label: string;
}
export interface DirectoryPerson {
  active: boolean;
  /** The source's stable id, never reused. `dev:` marks the development stack's people. */
  externalId: string;
  /** What a login is matched on; the Keycloak username in development. */
  userName: string;
  givenName: string;
  familyName: string;
  email: string;
  phoneNumbers?: DirectoryPhone[];
  employments?: Employment[];
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
  /** D108 item 5: the codes of the positions the person holds, of those the directory lists. */
  positions?: string[];
  capabilities: Capability[];
  /** A persona: has a Keycloak account in the development stack and a fixed person id the fixtures key on. */
  login?: boolean;
}
export interface Directory {
  /** Set only after the reader validates the final page of every source collection, including memberships. */
  complete: boolean;
  units: DirectoryUnit[];
  groups: DirectoryGroup[];
  /** D108 item 5: the source's positions, each sent as a `position:` group whether anyone holds it or not. */
  positions?: DirectoryPosition[];
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
/** A department: a unit under an administration with one person on it, its head. */
const dept = (id: string, label: string, area: Area): UnitPlan => ({
  id,
  label,
  area,
  size: 1,
  parent: areaUnit(area),
});
const UNITS: UnitPlan[] = [
  { id: 'unit-skola', label: 'Bergsåkers skola', area: 'utbildning', size: 12, parent: 'unit-grundskola' },
  { id: 'unit-skola-haga', label: 'Hagaskolan', area: 'utbildning', size: 14, parent: 'unit-grundskola' },
  { id: 'unit-skola-nacksta', label: 'Nacksta skola', area: 'utbildning', size: 10, parent: 'unit-grundskola' },
  // A rektor and a biträdande rektor: a unit with two managers.
  {
    id: 'unit-gymnasium',
    label: 'Selångers gymnasium',
    area: 'utbildning',
    size: 16,
    managers: 2,
    parent: 'unit-gymnasie',
  },
  { id: 'unit-forskola', label: 'Granlo förskola', area: 'utbildning', size: 7, parent: 'unit-forskolor' },
  {
    id: 'unit-forskola-skonsberg',
    label: 'Skönsbergs förskola',
    area: 'utbildning',
    size: 6,
    parent: 'unit-forskolor',
  },
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
  {
    id: 'unit-aldreboende',
    label: 'Lindgårdens äldreboende',
    area: 'omsorg',
    size: 13,
    parent: 'unit-aldreboenden-norr',
  },
  { id: 'unit-lss', label: 'LSS-boende Bosvedjan', area: 'omsorg', size: 8, parent: 'unit-funktionsstod' },
  { id: 'unit-socialtjanst', label: 'Socialtjänst barn och unga', area: 'omsorg', size: 9, parent: 'unit-ifo' },
  { id: 'unit-forsorjning', label: 'Försörjningsstöd', area: 'omsorg', size: 6, parent: 'unit-ifo' },
  { id: 'unit-gata', label: 'Gata och park', area: 'stadsbyggnad', size: 10, parent: 'unit-teknik' },
  { id: 'unit-bygglov', label: 'Bygglovsenheten', area: 'stadsbyggnad', size: 5, parent: 'unit-plan-bygg' },
  { id: 'unit-miljo', label: 'Miljö och hälsoskydd', area: 'stadsbyggnad', size: 5, parent: 'unit-plan-bygg' },
  { id: 'unit-fastighet', label: 'Fastighetsservice', area: 'stadsbyggnad', size: 7, parent: 'unit-teknik' },
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
  // The departments between an administration and its units, each with a head of its own who reports to the
  // administration's: the managers below the managers. Kultur och fritid and Kommunstyrelsekontoret have none, so
  // their units stand directly under the administration.
  dept('unit-gymnasie', 'Gymnasie- och vuxenutbildning', 'utbildning'),
  dept('unit-forskolor', 'Förskola', 'utbildning'),
  dept('unit-sarskilt-boende', 'Särskilt boende', 'omsorg'),
  dept('unit-funktionsstod', 'Funktionsstöd', 'omsorg'),
  dept('unit-ifo', 'Individ- och familjeomsorg', 'omsorg'),
  dept('unit-teknik', 'Teknik och service', 'stadsbyggnad'),
  dept('unit-plan-bygg', 'Plan, bygg och miljö', 'stadsbyggnad'),
  // An area between a department and its units, with a head of its own: the fourth level of six.
  { id: 'unit-aldreboenden-norr', label: 'Äldreboenden norr', area: 'omsorg', size: 1, parent: 'unit-sarskilt-boende' },
  // More units people work in, under the departments, and two groups under a unit, each with a manager of its own.
  { id: 'unit-vuxenutbildning', label: 'Vuxenutbildningen', area: 'utbildning', size: 6, parent: 'unit-gymnasie' },
  { id: 'unit-forskola-haga', label: 'Haga förskola', area: 'utbildning', size: 5, parent: 'unit-forskolor' },
  {
    id: 'unit-aldreboende-sol',
    label: 'Solgårdens äldreboende',
    area: 'omsorg',
    size: 8,
    parent: 'unit-aldreboenden-norr',
  },
  { id: 'unit-aldreboende-natt', label: 'Lindgården natt', area: 'omsorg', size: 4, parent: 'unit-aldreboende' },
  { id: 'unit-daglig-verksamhet', label: 'Daglig verksamhet', area: 'omsorg', size: 5, parent: 'unit-funktionsstod' },
  { id: 'unit-park', label: 'Parkskötsel', area: 'stadsbyggnad', size: 4, parent: 'unit-gata' },
];
/**
 * The units of the tree above and below the first twenty-five, the ones people were generated for before the tree: the
 * plain-group rules were written for those first units and are theirs alone.
 */
const TREE_UNITS = new Set(UNITS.slice(UNITS.findIndex(u => u.id === ROOT)).map(u => u.id));
/** The second generated person in each of these units holds another employment and is assigned to both units. */
const SECOND_EMPLOYMENT: Partial<Record<string, Employment>> = {
  'unit-bibliotek': { unitId: 'unit-kommunikation', title: 'Webbredaktör' },
  'unit-skola-haga': { unitId: 'unit-skola-nacksta', title: 'Lärare' },
  'unit-omsorg': { unitId: 'unit-omsorg-norr', title: 'Samordnare' },
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
  // D121: mapped to Kompetenssökning by the development seed (`DEVELOPMENT_REGISTRAR_GROUP` in competence-development.ts).
  { id: 'ad:kompetenssamordnare', label: 'Kompetenssamordnare' },
  // A group the directory holds and nobody is in yet.
  { id: 'ad:projekt-e-arkiv', label: 'Projekt e-arkiv' },
  ...(Object.keys(AREAS) as Area[]).map(area => ({ id: areaGroup(area), label: AREAS[area] })),
];
/**
 * What the people of a unit are called (D110): the titles of those who lead it, in order, and the titles of the rest,
 * taken in turn. They are a municipality's own words and differ between units: the manager of Bygglovsenheten is a
 * byggchef and the manager of a school a rektor, and both are `manager` to Clew. A unit that is not listed here is one
 * of the tree's: led by a verksamhetschef, with nobody else on it.
 */
const SCHOOL_STAFF = ['Lärare', 'Lärare', 'Speciallärare', 'Elevassistent', 'Lärare', 'Skolsköterska', 'Lärare'],
  PRESCHOOL_STAFF = ['Förskollärare', 'Barnskötare', 'Förskollärare', 'Barnskötare', 'Kock'],
  HOME_CARE_STAFF = ['Undersköterska', 'Undersköterska', 'Vårdbiträde', 'Undersköterska', 'Samordnare'],
  CARE_HOME_STAFF = ['Undersköterska', 'Sjuksköterska', 'Undersköterska', 'Vårdbiträde', 'Arbetsterapeut'],
  DIRECTOR: { lead: string[]; staff: string[] } = { lead: ['Förvaltningsdirektör'], staff: ['Verksamhetsutvecklare'] };
const TITLES: Record<string, { lead: string[]; staff: string[] }> = {
  // The school's people as the HR fixture names them (`connectors/hr/fixture.mjs`), for everyone both sources place
  // on the school. The fixture also has a Hassan Ali there as elevassistent; the directory's Hassan is the
  // undersköterska of Hemtjänst Centrum, so those two rows differ, as they did before either had a title.
  'unit-skola': {
    lead: [],
    staff: [
      'Lärare',
      'Lärare',
      'Specialpedagog',
      'Lärare',
      'Lärare',
      'Lärare',
      'Lärare',
      'Fritidspedagog',
      'Lärare',
      'Lärare',
      'Elevassistent',
    ],
  },
  'unit-skola-haga': { lead: ['Rektor'], staff: SCHOOL_STAFF },
  'unit-skola-nacksta': { lead: ['Rektor'], staff: SCHOOL_STAFF },
  'unit-gymnasium': {
    lead: ['Rektor', 'Biträdande rektor'],
    staff: ['Gymnasielärare', 'Gymnasielärare', 'Studie- och yrkesvägledare', 'Gymnasielärare', 'Kurator'],
  },
  'unit-forskola': { lead: ['Rektor'], staff: PRESCHOOL_STAFF },
  'unit-forskola-skonsberg': { lead: ['Rektor'], staff: PRESCHOOL_STAFF },
  'unit-forskola-haga': { lead: ['Rektor'], staff: PRESCHOOL_STAFF },
  'unit-fritidshem': {
    lead: [],
    staff: ['Lärare i fritidshem', 'Fritidsledare', 'Lärare i fritidshem', 'Elevassistent'],
  },
  'unit-skola-fritids': { lead: ['Biträdande rektor'], staff: ['Lärare i fritidshem'] },
  'unit-vuxenutbildning': { lead: ['Rektor'], staff: ['Lärare', 'SFI-lärare', 'Studie- och yrkesvägledare'] },
  'unit-omsorg': { lead: ['Enhetschef'], staff: HOME_CARE_STAFF },
  'unit-omsorg-norr': { lead: ['Enhetschef'], staff: HOME_CARE_STAFF },
  'unit-aldreboende': { lead: ['Enhetschef'], staff: CARE_HOME_STAFF },
  'unit-aldreboende-sol': { lead: ['Enhetschef'], staff: CARE_HOME_STAFF },
  'unit-aldreboende-natt': { lead: ['Gruppchef'], staff: ['Undersköterska', 'Undersköterska', 'Sjuksköterska'] },
  'unit-aldreboenden-norr': { lead: ['Områdeschef'], staff: [] },
  'unit-lss': { lead: ['Enhetschef'], staff: ['Stödassistent', 'Stödassistent', 'Stödpedagog'] },
  'unit-daglig-verksamhet': { lead: ['Enhetschef'], staff: ['Stödassistent', 'Arbetshandledare', 'Stödpedagog'] },
  'unit-socialtjanst': { lead: ['Enhetschef'], staff: ['Socialsekreterare', 'Socialsekreterare', 'Familjebehandlare'] },
  'unit-forsorjning': { lead: ['Enhetschef'], staff: ['Socialsekreterare', 'Handläggare'] },
  'unit-gata': {
    lead: ['Enhetschef'],
    staff: ['Gatuingenjör', 'Anläggningsarbetare', 'Trafikingenjör', 'Projektledare'],
  },
  'unit-park': { lead: ['Arbetsledare'], staff: ['Parkarbetare', 'Trädgårdsmästare', 'Parkarbetare'] },
  'unit-bygglov': { lead: ['Byggchef'], staff: ['Bygglovshandläggare', 'Byggnadsinspektör', 'Bygglovsarkitekt'] },
  'unit-miljo': { lead: ['Miljöchef'], staff: ['Miljö- och hälsoskyddsinspektör', 'Livsmedelsinspektör'] },
  'unit-fastighet': { lead: ['Enhetschef'], staff: ['Fastighetstekniker', 'Vaktmästare', 'Fastighetsförvaltare'] },
  'unit-bibliotek': { lead: ['Bibliotekschef'], staff: ['Bibliotekarie', 'Bibliotekarie', 'Biblioteksassistent'] },
  'unit-kulturskolan': { lead: ['Kulturskolechef'], staff: ['Musiklärare', 'Danslärare', 'Bildlärare'] },
  'unit-fritid': { lead: ['Fritidschef'], staff: ['Fritidsledare', 'Anläggningsskötare', 'Föreningskonsulent'] },
  'unit-it': { lead: ['IT-chef'], staff: ['IT-tekniker', 'Systemutvecklare', 'IT-arkitekt', 'Systemförvaltare'] },
  'unit-ekonomi': { lead: ['Ekonomichef'], staff: ['Ekonom', 'Controller', 'Redovisningsekonom', 'Upphandlare'] },
  'unit-hr': { lead: [], staff: ['HR-specialist', 'HR-konsult', 'Lönespecialist', 'Rehabiliteringssamordnare'] },
  'unit-kommunikation': { lead: ['Kommunikationschef'], staff: ['Kommunikatör', 'Webbredaktör'] },
  'unit-kansli': { lead: ['Kanslichef'], staff: ['Kommunsekreterare', 'Registrator', 'Nämndsekreterare', 'Jurist'] },
  [ROOT]: { lead: ['Kommundirektör'], staff: [] },
  ...Object.fromEntries((Object.keys(AREAS) as Area[]).map(area => [areaUnit(area), DIRECTOR])),
};
/**
 * D108 item 5: the source's positions, a code and a name each, which the provisioner sends as `position:<code>` groups.
 * The codes are this directory's own, as a real source's are its own: Clew builds in no classification of positions.
 * A position says what a person is employed as and gives no access; one nobody holds is still one of the source's.
 */
const POSITIONS: DirectoryPosition[] = [
  { code: 'underskoterska', label: 'Undersköterska' },
  { code: 'sjukskoterska', label: 'Sjuksköterska' },
  { code: 'vardbitrade', label: 'Vårdbiträde' },
  { code: 'stodassistent', label: 'Stödassistent' },
  { code: 'enhetschef', label: 'Enhetschef' },
  { code: 'handlaggare', label: 'Handläggare' },
  { code: 'maskinforare', label: 'Maskinförare' },
  { code: 'larare', label: 'Lärare' },
  // A position the source lists and nobody in this directory holds.
  { code: 'tolk', label: 'Tolk' },
];
/** The position an employment's title is employed as, in this source; a title not listed is a job without one. */
const POSITION_OF_TITLE: Record<string, string> = {
  Undersköterska: 'underskoterska',
  Sjuksköterska: 'sjukskoterska',
  'Medicinskt ansvarig sjuksköterska': 'sjukskoterska',
  Skolsköterska: 'sjukskoterska',
  Vårdbiträde: 'vardbitrade',
  Stödassistent: 'stodassistent',
  Enhetschef: 'enhetschef',
  Handläggare: 'handlaggare',
  Bygglovshandläggare: 'handlaggare',
  Anläggningsarbetare: 'maskinforare',
  Lärare: 'larare',
  Speciallärare: 'larare',
  Gymnasielärare: 'larare',
};
/**
 * The `n`th generated person of these units holds a second position beside the one their title gives: a position is
 * the person's, not a placement's, so one person can be two things on one unit.
 */
const SECOND_POSITION: Partial<Record<string, { n: number; code: string }>> = {
  // An anläggningsarbetare who also handles the permits for digging in the street.
  'unit-gata': { n: 2, code: 'handlaggare' },
  // A stödassistent who is also employed as an undersköterska.
  'unit-lss': { n: 1, code: 'underskoterska' },
};
/** The title of the `n`th generated person of a unit, of which the first `managers` lead it. */
const titleOf = (unitId: string, n: number, managers: number): string => {
  const { lead, staff } = TITLES[unitId] ?? { lead: ['Verksamhetschef'], staff: [] };
  return (n < managers ? lead[n] : staff[(n - managers) % (staff.length || 1)]) ?? 'Handläggare';
};
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
    active: true,
    externalId: 'dev:hillevi',
    userName: 'hillevi',
    givenName: 'Hillevi',
    familyName: 'Berg',
    email: 'hillevi@clew.test',
    phoneNumbers: [
      { type: 'work', value: '010-000 00 01' },
      { type: 'mobile', value: '070-000 00 02' },
    ],
    employments: [{ unitId: 'unit-skola', title: 'Rektor' }],
    department: 'unit-skola',
    manager: true,
    // Also the development stack's registrar (D121): searches competence across the organisation.
    groups: ['ad:alla-chefer', 'ad:rektorer', 'ad:kompetenssamordnare'],
    capabilities: [],
    login: true,
  },
  {
    active: true,
    externalId: 'dev:hassan',
    userName: 'hassan',
    givenName: 'Hassan',
    familyName: 'Ali',
    email: 'hassan@clew.test',
    phoneNumbers: [{ type: 'mobile', value: '070-000 00 03' }],
    employments: [{ unitId: 'unit-omsorg', title: 'Undersköterska' }],
    department: 'unit-omsorg',
    manager: false,
    capabilities: [],
    login: true,
  },
  {
    active: true,
    externalId: 'dev:mikael',
    userName: 'mikael',
    givenName: 'Mikael',
    familyName: 'Lund',
    email: 'mikael@clew.test',
    phoneNumbers: [
      { type: 'work', value: '010-000 00 04' },
      { type: 'work', value: '010-000 00 05' },
      { type: 'Jour', value: '070-000 00 06' },
    ],
    employments: [
      {
        unitId: 'unit-it',
        title: 'Systemförvaltare',
        employmentType: 'Tillsvidare',
        startDate: '2019-02-01',
        employmentPercentage: 60,
      },
      {
        unitId: 'unit-it',
        title: 'Projektsamordnare',
        employmentType: 'Vikariat',
        startDate: '2026-09-01',
        employmentPercentage: 40,
      },
    ],
    department: 'unit-it',
    manager: false,
    groups: ['ad:intranat-redaktorer'],
    capabilities: ['admin.connectors', 'admin.users', 'admin.appearance', 'admin.competence'],
    login: true,
  },
];
/**
 * The names a generator does not come up with and a real directory holds: a hyphen, a particle, an apostrophe,
 * accents, two family names, a name too long for a narrow column, a very short one, and a second person with the same
 * name as somebody else (the first Anna Lindqvist is generated). Employees without a login. Their titles are the
 * ones a column has to hold too (D110): a long one, one with a hyphen and a slash, and a person the source has no
 * title for.
 */
const named = (
  givenName: string,
  familyName: string,
  userName: string,
  department: string,
  title?: string,
): DirectoryPerson => ({
  active: true,
  externalId: 'dev:' + userName,
  userName,
  givenName,
  familyName,
  email: userName + '@clew.test',
  employments: [{ unitId: department, ...(title ? { title } : {}) }],
  department,
  manager: false,
  capabilities: [],
});
const handwritten: DirectoryPerson[] = [
  ...personas,
  named('Ann-Sofie', 'af Sandeberg', 'ann-sofie.afsandeberg', 'unit-kansli', 'Kommunjurist/dataskyddsombud'),
  named('José', 'Hernández García', 'jose.hernandez', 'unit-gata', 'Mät- och kartingenjör'),
  named('Zoë', "O'Connor", 'zoe.oconnor', 'unit-kulturskolan', 'Musiklärare'),
  named('Åsa', 'Öberg-Ångström', 'asa.oberg-angstrom', 'unit-aldreboende', 'Medicinskt ansvarig sjuksköterska'),
  named('Anna', 'Lindqvist', 'anna.lindqvist2', 'unit-omsorg-norr', 'Undersköterska'),
  named(
    'Maximiliana Alexandra',
    'von Schwerin-Gyllenstierna',
    'maximiliana.vonschwerin',
    'unit-ekonomi',
    'Verksamhetsutvecklare med ansvar för digitalisering och välfärdsteknik',
  ),
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
const GIVEN_MORE = [
  'Agnes',
  'Björn',
  'Cecilia',
  'Daniel',
  'Ebba',
  'Filip',
  'Gunilla',
  'Hugo',
  'Ines',
  'Jonas',
  'Klara',
  'Liam',
  'Malin',
  'Noor',
  'Oskar',
  'Pia',
  'Rasmus',
  'Selma',
  'Tobias',
  'Vera',
];
const FAMILY_MORE = [
  'Åkesson',
  'Björk',
  'Dahlberg',
  'Engström',
  'Forsberg',
  'Holm',
  'Jakobsson',
  'Mohammed',
  'Nordin',
  'Wikström',
];
/**
 * Hillevi's school starts with named people, not generated ones: the same five people with the same user names and
 * addresses as the calendar accounts in `packages/calendar/src/accounts.ts` and `.devcontainer/calendar/seed.php`, so
 * the people the planner proposes talks for (D96 item 3) have calendars. The generator's counter still advances past
 * them, so every other unit keeps its people, and the rest of the school is generated; the calendar seeds give those
 * generated people accounts too, from `unitCalendarPeople()` in `scripts/calendar-fixtures.ts`.
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
 * with every person, so a unit is not one family; after two hundred the second lists take over in the same way.
 */
const nameOf = (k: number) => {
  // The first two hundred people have the first lists' names; the people after them, added with the deeper tree,
  // have the second lists', so nobody who was there changes name and no user name is taken twice.
  const [given, family] = k < GIVEN.length * FAMILY.length ? [GIVEN, FAMILY] : [GIVEN_MORE, FAMILY_MORE],
    j = k % (GIVEN.length * FAMILY.length);
  return {
    givenName: given[j % given.length]!,
    familyName: family[(j + Math.floor(j / given.length)) % family.length]!,
  };
};
/**
 * Fills every unit up to its size after the hand-written people. The first generated people of a unit manage it (one,
 * or as many as the unit says; none where a persona does or another unit's manager does, and that manager then
 * manages both). Plain groups follow `MEMBERSHIPS`, a second job `SECOND_EMPLOYMENT`; the IT manager administers
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
      const employments: Employment[] = [{ unitId: unit.id, title: titleOf(unit.id, n, managers) }];
      const secondEmployment = n === 1 ? SECOND_EMPLOYMENT[unit.id] : undefined;
      if (secondEmployment) employments.push(secondEmployment);
      const secondPosition = SECOND_POSITION[unit.id]?.n === n ? SECOND_POSITION[unit.id]!.code : undefined;
      people.push({
        active: true,
        externalId: 'dev:' + userName,
        userName,
        givenName,
        familyName,
        email: userName + '@clew.test',
        employments,
        department: unit.id,
        manager: seat.manager,
        ...(seat.manager && alsoManages.length ? { alsoManages } : {}),
        ...(secondEmployment ? { alsoIn: [secondEmployment.unitId] } : {}),
        ...(groups.length ? { groups } : {}),
        ...(secondPosition ? { positions: [secondPosition] } : {}),
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
/**
 * A person's positions (D108 item 5): those their employments are employed as, by title in the directory's order, then
 * any other they hold. A person whose titles name no position holds none, as most of the directory does.
 */
const withPositions = (p: DirectoryPerson): DirectoryPerson => {
  const byTitle = (p.employments ?? []).flatMap(job => {
      const code = job.title && POSITION_OF_TITLE[job.title];
      return code ? [code] : [];
    }),
    positions = [...new Set([...byTitle, ...(p.positions ?? [])])];
  return positions.length ? { ...p, positions } : p;
};
/** A unit that names no unit above it stands under its administration. */
const parentOf = (unit: UnitPlan) =>
  unit.parent ?? (unit.area && unit.id !== areaUnit(unit.area) ? areaUnit(unit.area) : undefined);
/** The installation assigns these namespaces to the development writer. */
export const developmentScope = {
  userPrefix: 'dev:',
  groupPrefixes: ['unit:unit-', 'unit-manager:unit-', 'ad:', 'position:'],
  groupKeys: [
    'capability:admin.users',
    'capability:admin.connectors',
    'capability:admin.appearance',
    'capability:admin.competence',
  ],
};
export const developmentDirectory: Directory = {
  complete: true,
  units: UNITS.map(unit => {
    const parent = parentOf(unit);
    return { id: unit.id, label: unit.label, ...(parent ? { parent } : {}) };
  }),
  groups: GROUPS,
  positions: POSITIONS,
  people: [...handwritten, ...generated()].map(inArea).map(withPositions),
};
export const fullName = (p: DirectoryPerson) => `${p.givenName} ${p.familyName}`;
