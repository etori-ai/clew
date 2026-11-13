/**
 * The development stack's boarding data (D124), synthetic and in one place: the layers `boarding-seed.ts` imports, as
 * the file an administrator would upload (Clew's own CSV, read by the same parser the page and the server use), and
 * the one introduction it starts. Data only, so the seed and the tests read the same lists. The units and positions
 * are the synthetic directory's (`scripts/provisioner/directory.ts`).
 */
export const DEVELOPMENT_ORGANISATION = 'poc';
/**
 * Three introduction layers (everyone; the education administration and every unit below it, Hillevi's school among
 * them; teachers by position) and one leaving layer for everyone.
 */
export const DEVELOPMENT_LAYERS = [
  'layer;event;condition;value;title;kind;owner;offsetDays;tiedTo',
  'Alla nyanställda;introduction;all;;Beställ dator och telefon;order;manager;-14;',
  'Alla nyanställda;introduction;all;;Beställ passerkort;order;manager;-10;',
  'Alla nyanställda;introduction;all;;Skicka ett välkomstbrev;todo;manager;-7;',
  'Alla nyanställda;introduction;all;;Välkomstsamtal;meeting;manager;0;',
  'Alla nyanställda;introduction;all;;Lunch med faddern;meeting;buddy;1;',
  'Alla nyanställda;introduction;all;;Läs om kommunens värdegrund;acknowledge;person;2;',
  'Alla nyanställda;introduction;all;;Informationssäkerhet;course;person;30;competence.holdings',
  'Alla nyanställda;introduction;all;;Uppföljningssamtal efter tre månader;meeting;manager;90;',
  'Barn och utbildning;introduction;unit;unit-forvaltning-utbildning;Läs skolans krisplan;acknowledge;person;3;',
  'Barn och utbildning;introduction;unit;unit-forvaltning-utbildning;Introduktion i lärplattformen;course;person;7;',
  'Lärare;introduction;position;larare;Få tillgång till schemat;order;manager;-5;',
  'Lärare;introduction;position;larare;Gå igenom elevhälsans rutiner;meeting;buddy;5;',
  'Alla som slutar;leaving;all;;Avslutningssamtal;meeting;manager;-14;',
  'Alla som slutar;leaving;all;;Lämna över pågående arbete;todo;person;-7;',
  'Alla som slutar;leaving;all;;Lämna tillbaka dator, telefon och passerkort;todo;person;0;',
  'Alla som slutar;leaving;all;;Be om att behörigheterna tas bort;order;manager;1;',
].join('\n');
/**
 * The one open introduction of the development stack: Hillevi started it a week ago for Erik at her school, with Anna
 * as his buddy, and the items due more than two days ago are done but one, so the plan shows done, open and overdue
 * items. The new teacher whose employment starts in three weeks (`DEVELOPMENT_NEW_HIRE`) has none: she is the
 * suggestion.
 */
export const DEVELOPMENT_PLAN = {
  manager: 'hillevi',
  person: 'erik',
  buddy: 'anna',
  /** The plan's first day, in days from the day the seed runs. */
  startedDaysAgo: 7,
  /** The item due before the others are ticked off that is left open, so the plan has an overdue item. */
  leftOpen: 'Lunch med faddern',
} as const;
