import { describe, expect, test } from 'bun:test';
import {
  COMPETENCE_IMPORT_MAX_CHARS,
  COMPETENCE_IMPORT_PROBLEMS_MAX,
  COMPETENCE_IMPORT_ROWS_MAX,
  ESCO_SKILL_COLUMNS,
  catalogueMatcher,
  competenceImportRowProblem,
  parseCompetenceImport,
} from '../../packages/contracts/src/index';

/**
 * The file of competence types an administrator imports (D120 item 7), read by the parser the page and the server share:
 * which format the first row says, RFC 4180 (quotes, a delimiter and a line break inside one, a doubled quote, a byte
 * order mark, CRLF and CR), a Swedish spreadsheet's `;`, every problem with its row in Swedish and never a throw, the
 * limits, and the rule both sides use for a row the catalogue holds already. ESCO's file is never part of the repository:
 * the rows below are written here with its published column names.
 */
const ESCO_HEADER = ESCO_SKILL_COLUMNS.join(',');
/** One row of ESCO's skills file as published, with the description in quotes over two lines and a comma in a label. */
const esco = (uri: string, label: string, status = 'released', alt = 'en annan etikett') =>
  [
    'KnowledgeSkillCompetence',
    uri,
    'skill/competence',
    'sector-specific',
    label,
    `"${alt}\nännu en"`,
    '',
    status,
    '2023-12-04T13:56:34.123Z',
    '',
    '',
    'http://data.europa.eu/esco/concept-scheme/member-skills',
    '"Beskrivning med ""citat"", kommatecken och\nradbrytning."',
  ].join(',');
const uri = (n: number) => `http://data.europa.eu/esco/skill/0000000${n}-aaaa-bbbb-cccc-dddddddddddd`;

describe('the format is recognised by the first row (D120 item 7)', () => {
  test("ESCO's skills file: a released row is a skill named by its preferredLabel and kept by its conceptUri", () => {
    const text = [
      ESCO_HEADER,
      esco(uri(1), 'leda ett team'),
      esco(uri(2), 'använda kalkylprogram'),
      esco(uri(3), 'arbeta säkert', 'draft'),
    ].join('\r\n');
    const read = parseCompetenceImport('﻿' + text + '\r\n');
    expect(read.format).toBe('esco');
    expect(read.problems).toEqual([]);
    expect(read.problemCount).toBe(0);
    expect(read.notReleased).toBe(1);
    // A quoted field over two lines is one row: the second type is row 3, as a spreadsheet shows it.
    expect(read.rows).toEqual([
      { row: 2, name: 'leda ett team', area: null, kind: 'skill', validityMonths: null, uri: uri(1) },
      { row: 3, name: 'använda kalkylprogram', area: null, kind: 'skill', validityMonths: null, uri: uri(2) },
    ]);
  });
  test("Clew's own: name, area, kind, validityMonths, uri; a kind by its id or the page's word; empty is none", () => {
    const read = parseCompetenceImport(
      [
        'name,area,kind,validityMonths,uri',
        'HLR,Akut omhändertagande,course,24,',
        '"Heta arbeten, grund",Säkerhet,Certifikat,60,https://example.org/heta',
        'Engelska,Språk,färdighet,,',
      ].join('\n'),
    );
    expect(read.format).toBe('clew');
    expect(read.problems).toEqual([]);
    expect(read.rows).toEqual([
      { row: 2, name: 'HLR', area: 'Akut omhändertagande', kind: 'course', validityMonths: 24, uri: null },
      {
        row: 3,
        name: 'Heta arbeten, grund',
        area: 'Säkerhet',
        kind: 'certificate',
        validityMonths: 60,
        uri: 'https://example.org/heta',
      },
      { row: 4, name: 'Engelska', area: 'Språk', kind: 'skill', validityMonths: null, uri: null },
    ]);
  });
  test('a Swedish spreadsheet separates with a semicolon; columns may come in any order, and the last two may be left out', () => {
    const read = parseCompetenceImport('Kind;Area;Name\rcourse;Brand;Brandskydd\r');
    expect(read.format).toBe('clew');
    expect(read.rows).toEqual([
      { row: 2, name: 'Brandskydd', area: 'Brand', kind: 'course', validityMonths: null, uri: null },
    ]);
  });
  test('a file that is neither is one problem on its first row, and an empty one says so', () => {
    expect(parseCompetenceImport('a,b,c\n1,2,3')).toEqual({
      format: null,
      rows: [],
      problems: [
        {
          row: 1,
          message:
            'Filen känns inte igen. Den första raden ska vara name, area, kind, validityMonths, uri (Clews format) eller rubrikerna i ESCO:s fil med färdigheter (conceptUri, preferredLabel, status …).',
        },
      ],
      problemCount: 1,
      notReleased: 0,
    });
    expect(parseCompetenceImport(' \n\n').problems).toEqual([{ row: 0, message: 'Filen är tom.' }]);
  });
});

describe('what is wrong is a problem with its row, and the rest is read (D120 item 7)', () => {
  test("every rule of Clew's format, in Swedish, and a row with a problem is not among the rows", () => {
    const read = parseCompetenceImport(
      [
        'name,area,kind,validityMonths,uri',
        ',Säkerhet,course,,', // 2
        'A,,course,,', // 3
        'B,X,kurser,,', // 4
        'C,X,,,', // 5
        'D,X,course,0,', // 6
        'E,X,course,601,', // 7
        'F,X,skill,12,', // 8
        'G,X,course,,inte en adress', // 9
        `${'H'.repeat(121)},X,course,,`, // 10
        'I,X,course,12,,extra', // 11
        'Bra,X,course,,', // 12
        'bra,Y,degree,,', // 13
        'K,X,course,,https://example.org/k', // 14
        'L,X,course,,https://example.org/k', // 15
        'M,X,course,"12"x,', // 16
        'N\u0007,X,course,,', // 17
      ].join('\n'),
    );
    expect(read.rows.map(r => r.name)).toEqual(['Bra', 'K']);
    expect(read.problems).toEqual([
      { row: 2, message: 'Namn saknas.' },
      { row: 3, message: 'Område saknas.' },
      {
        row: 4,
        message:
          'Typen ”kurser” finns inte. Använd certificate, degree, course, authorisation, skill eller Certifikat, Examen, Kurs, Behörighet, Färdighet.',
      },
      {
        row: 5,
        message:
          'Typ saknas. Använd certificate, degree, course, authorisation, skill eller Certifikat, Examen, Kurs, Behörighet, Färdighet.',
      },
      { row: 6, message: 'Giltighetstiden ska vara ett heltal från 1 till 600 månader.' },
      { row: 7, message: 'Giltighetstiden ska vara ett heltal från 1 till 600 månader.' },
      { row: 8, message: 'En färdighet har ingen giltighetstid.' },
      {
        row: 9,
        message: 'Adressen ska vara en fullständig adress, till exempel http://data.europa.eu/esco/skill/….',
      },
      { row: 10, message: 'Namnet är längre än 120 tecken.' },
      { row: 11, message: 'Raden har 6 fält, men den första raden har 5.' },
      { row: 13, message: 'Samma namn som rad 12.' },
      { row: 15, message: 'Samma adress som rad 14.' },
      { row: 16, message: 'Raden har ett citattecken på fel ställe.' },
      { row: 17, message: 'Namnet innehåller tecken som inte kan sparas.' },
    ]);
    expect(read.problemCount).toBe(14);
  });
  test('an ESCO row without a label or an address is a problem; a draft one is left out without one', () => {
    const read = parseCompetenceImport(
      [ESCO_HEADER, esco('', 'utan adress'), esco(uri(5), ''), esco(uri(6), 'utkast', 'draft')].join('\n'),
    );
    expect(read.rows).toEqual([]);
    expect(read.notReleased).toBe(1);
    expect(read.problems).toEqual([
      { row: 2, message: 'Adress (conceptUri) saknas.' },
      { row: 3, message: 'Namn saknas.' },
    ]);
  });
  test('a quote that never ends is said on the row it began, and what came before is kept', () => {
    const read = parseCompetenceImport('name,area,kind\nA,X,course\n"B,X,course\nC,X,course\n');
    expect(read.rows.map(r => r.name)).toEqual(['A']);
    expect(read.problems).toEqual([
      { row: 3, message: 'Ett citattecken avslutas aldrig. Resten av filen kan inte läsas.' },
    ]);
  });
  test('the problems listed stop at their limit and the rest are counted', () => {
    const lines = ['name,area,kind', ...Array.from({ length: COMPETENCE_IMPORT_PROBLEMS_MAX + 5 }, () => ',X,course')];
    const read = parseCompetenceImport(lines.join('\n'));
    expect(read.problems).toHaveLength(COMPETENCE_IMPORT_PROBLEMS_MAX);
    expect(read.problemCount).toBe(COMPETENCE_IMPORT_PROBLEMS_MAX + 5);
  });
  test('the limits: a file over the rows or the size is refused as a whole, never thrown', () => {
    const many = [
      'name,area,kind',
      ...Array.from({ length: COMPETENCE_IMPORT_ROWS_MAX + 1 }, (_, i) => `T${i},X,course`),
    ];
    const tooMany = parseCompetenceImport(many.join('\n'));
    expect(tooMany.rows).toEqual([]);
    expect(tooMany.problems).toEqual([{ row: 0, message: 'Filen har fler än 30 000 rader. Dela upp den.' }]);
    const exactly = parseCompetenceImport(many.slice(0, -1).join('\n'));
    expect(exactly.rows).toHaveLength(COMPETENCE_IMPORT_ROWS_MAX);
    const huge = parseCompetenceImport('x'.repeat(COMPETENCE_IMPORT_MAX_CHARS + 1));
    expect(huge.problems).toEqual([{ row: 0, message: 'Filen är för stor. Den får vara högst 40 miljoner tecken.' }]);
  });
  test('a file that is not UTF-8 is said so as a whole: what the browser read in place of its letters is not kept', () => {
    expect(parseCompetenceImport('name,area,kind\nV\ufffdrd,X,course').problems).toEqual([
      { row: 0, message: 'Filen innehåller tecken som inte kunde läsas. Spara den som CSV i UTF-8 och välj den igen.' },
    ]);
  });
  test('a file the size of ESCO’s is read whole', () => {
    const rows = Array.from({ length: 14_000 }, (_, i) => esco(uri(i), `färdighet ${i}`));
    const read = parseCompetenceImport([ESCO_HEADER, ...rows].join('\n'));
    expect(read.rows).toHaveLength(14_000);
    expect(read.problemCount).toBe(0);
    expect(read.rows.at(-1)).toMatchObject({ row: 14_001, name: 'färdighet 13999' });
  });
  test('whatever the text, it answers and never throws', () => {
    for (const text of [
      '"',
      '""',
      ',,,',
      '\r\r\n\n',
      'name,area,kind\n"',
      'conceptUri,preferredLabel,status\n"a"b"',
      '\u0000',
    ])
      expect(() => parseCompetenceImport(text)).not.toThrow();
  });
});

describe('the server checks a row with the same rules (D120 item 7)', () => {
  test('a row as the page sends it holds; a changed one is refused in the words the page uses', () => {
    const row = { name: 'HLR', area: 'Akut', kind: 'course', validityMonths: 24, uri: null };
    expect(competenceImportRowProblem(row)).toBeNull();
    expect(competenceImportRowProblem({ ...row, name: '  ' })).toBe('Namn saknas.');
    expect(competenceImportRowProblem({ ...row, kind: 'Kurs' })).toStartWith('Typen finns inte.');
    expect(competenceImportRowProblem({ ...row, kind: 'skill' })).toBe('En färdighet har ingen giltighetstid.');
    expect(competenceImportRowProblem({ ...row, validityMonths: 2.5 })).toBe(
      'Giltighetstiden ska vara ett heltal från 1 till 600 månader.',
    );
    expect(competenceImportRowProblem({ ...row, uri: 'javascript alert' })).toStartWith('Adressen ska vara');
    expect(competenceImportRowProblem({ ...row, area: 'A'.repeat(81) })).toBe('Området är längre än 80 tecken.');
  });
  test('the catalogue holds a row by its address whatever the type, or by a name in use or merged', () => {
    const held = catalogueMatcher([
      { name: 'HLR', uri: null, archived: false, merged: false },
      { name: 'Gammal', uri: null, archived: true, merged: false },
      { name: 'Truckkort', uri: null, archived: true, merged: true },
      { name: 'Arkiverad med adress', uri: uri(1), archived: true, merged: false },
    ]);
    expect(held({ name: 'hlr', uri: null })).toBe(true);
    expect(held({ name: '  HLR ', uri: null })).toBe(true);
    expect(held({ name: 'Gammal', uri: null })).toBe(false);
    expect(held({ name: 'truckkort', uri: null })).toBe(true);
    expect(held({ name: 'Ny', uri: uri(1) })).toBe(true);
    expect(held({ name: 'Ny', uri: uri(2) })).toBe(false);
  });
});
