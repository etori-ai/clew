import { describe, expect, test } from 'bun:test';
import {
  BOARDING_IMPORT_COLUMNS,
  BOARDING_LAYER_ITEMS_MAX,
  boardingImportRowProblem,
  boardingLayersOf,
  boardingTieOf,
  parseBoardingImport,
  type BoardingImportRow,
} from '../../packages/contracts/src/index';
import { DEVELOPMENT_LAYERS } from '../../scripts/boarding-development';

/**
 * The file of boarding layers (D124): the page reads it with `parseBoardingImport`, the server checks every row again
 * with `boardingImportRowProblem` and groups them with `boardingLayersOf`. Problems are Swedish and name their row.
 */
const HEADER = BOARDING_IMPORT_COLUMNS.join(';');
const file = (...rows: string[]) => [HEADER, ...rows].join('\r\n');
const row = (extra: Partial<BoardingImportRow> = {}): BoardingImportRow => ({
  row: 2,
  layer: 'Alla nyanställda',
  event: 'introduction',
  condition: 'all',
  value: null,
  title: 'Beställ dator',
  kind: 'order',
  owner: 'manager',
  offsetDays: -14,
  tiedTo: null,
  ...extra,
});

describe('reading a file of layers', () => {
  test('Clew’s columns with `;`, a byte order mark, the page’s Swedish words and a quoted field are read as ids', () => {
    const result = parseBoardingImport(
      '﻿' +
        file(
          'Alla nyanställda;introduction;all;;Beställ dator och telefon;order;manager;-14;',
          'Alla nyanställda;Introduktion;Alla;;"Välkomstsamtal; första dagen";Möte;Chef;0;',
          'Vård och omsorg;introduction;Enhet;unit-omsorg;Läs rutinen för basala hygienrutiner;Bekräftelse;Medarbetaren;+3;',
          'Lärare;introduction;position;larare;HLR;course;person;30;competence.holdings',
          'Alla som slutar;Avslut;all;;Återlämna nycklar;todo;Fadder;-1;',
        ),
    );
    expect(result.problems).toEqual([]);
    expect(result.problemCount).toBe(0);
    expect(result.rows).toEqual([
      row({ title: 'Beställ dator och telefon' }),
      row({ row: 3, title: 'Välkomstsamtal; första dagen', kind: 'meeting', offsetDays: 0 }),
      row({
        row: 4,
        layer: 'Vård och omsorg',
        condition: 'unit',
        value: 'unit-omsorg',
        title: 'Läs rutinen för basala hygienrutiner',
        kind: 'acknowledge',
        owner: 'person',
        offsetDays: 3,
      }),
      row({
        row: 5,
        layer: 'Lärare',
        condition: 'position',
        value: 'larare',
        title: 'HLR',
        kind: 'course',
        owner: 'person',
        offsetDays: 30,
        tiedTo: 'competence.holdings',
      }),
      row({
        row: 6,
        layer: 'Alla som slutar',
        event: 'leaving',
        title: 'Återlämna nycklar',
        kind: 'todo',
        owner: 'buddy',
        offsetDays: -1,
      }),
    ]);
    // A comma file is read the same way, and the last column may be left out.
    const commas = parseBoardingImport(
      'layer,event,condition,value,title,kind,owner,offsetDays\nA,introduction,all,,X,todo,manager,1\n',
    );
    expect(commas.rows).toEqual([row({ layer: 'A', title: 'X', kind: 'todo', offsetDays: 1 })]);
  });

  test('every row with a problem is named by its number in Swedish, and the rest are read', () => {
    const result = parseBoardingImport(
      file(
        'A;introduction;all;;Ok;todo;manager;1;',
        'A;birthday;all;;X;todo;manager;1;',
        'A;introduction;everyone;;X;todo;manager;1;',
        'A;introduction;all;;X;email;manager;1;',
        'A;introduction;all;;X;todo;hr;1;',
        'A;introduction;all;;X;todo;manager;400;',
        'A;introduction;all;;X;todo;manager;1.5;',
        'A;introduction;all;unit-x;X;todo;manager;1;',
        'B;introduction;unit;;X;todo;manager;1;',
        ';introduction;all;;X;todo;manager;1;',
        'A;introduction;all;;;todo;manager;1;',
        'A;introduction;all;;' + 'x'.repeat(121) + ';todo;manager;1;',
        'A;introduction;all;;X;todo;manager;1;;extra',
      ),
    );
    expect(result.rows.map(r => r.row)).toEqual([2]);
    expect(result.problems.map(p => p.row)).toEqual([3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14]);
    const at = (n: number) => result.problems.find(p => p.row === n)!.message;
    expect(at(3)).toStartWith('Händelsen ”birthday” finns inte.');
    expect(at(4)).toStartWith('Villkoret ”everyone” finns inte.');
    expect(at(5)).toStartWith('Typen ”email” finns inte.');
    expect(at(6)).toStartWith('Ansvarig ”hr” finns inte.');
    expect(at(7)).toBe('Antal dagar ska vara ett heltal från -365 till 365.');
    expect(at(8)).toBe('Antal dagar ska vara ett heltal från -365 till 365.');
    expect(at(9)).toBe('Ett lager för alla har inget värde.');
    expect(at(10)).toBe('Värdet saknas.');
    expect(at(11)).toBe('Lagrets namn saknas.');
    expect(at(12)).toBe('Uppgiften saknas.');
    expect(at(13)).toBe('Uppgiften är längre än 120 tecken.');
    expect(at(14)).toBe('Raden har 10 fält, men den första raden har 9.');
  });

  test('a layer is its event and name without regard to case: its rows must agree on whom it applies to', () => {
    const result = parseBoardingImport(
      file(
        'Vård;introduction;unit;unit-omsorg;A;todo;manager;0;',
        'VÅRD;introduction;unit;unit-omsorg;B;todo;manager;1;',
        'vård;introduction;unit;unit-skola;C;todo;manager;2;',
        // The same name for a leaving is another layer.
        'Vård;leaving;all;;D;todo;manager;0;',
      ),
    );
    expect(result.rows.map(r => r.row)).toEqual([2, 3, 5]);
    expect(result.problems).toEqual([{ row: 4, message: 'Samma lager som rad 2, men med ett annat villkor.' }]);
    const grouped = boardingLayersOf(result.rows);
    expect(grouped.problems).toEqual([]);
    expect(grouped.layers.map(l => [l.name, l.event, l.items.map(i => i.title)])).toEqual([
      ['Vård', 'introduction', ['A', 'B']],
      ['Vård', 'leaving', ['D']],
    ]);
  });

  test('rows of only delimiters, as a spreadsheet program appends, are skipped, and the rows keep their numbers', () => {
    const result = parseBoardingImport(
      file(
        'A;introduction;all;;Ok;todo;manager;1;',
        ';;;;;;;;',
        '  ;  ;;;;;;;',
        'A;introduction;all;;X;email;manager;1;',
        ';;;;;;;;',
        ';;;;;;;;;;;;',
      ) + '\r\n;;;;;;;;\r\n',
    );
    expect(result.rows.map(r => r.row)).toEqual([2]);
    expect(result.problems.map(p => p.row)).toEqual([5]);
    expect(result.problemCount).toBe(1);
  });

  test('a layer holds at most a hundred items', () => {
    const rows = Array.from({ length: BOARDING_LAYER_ITEMS_MAX + 1 }, (_, i) =>
      row({ row: i + 2, title: 'Uppgift ' + i }),
    );
    expect(boardingLayersOf(rows).problems).toEqual([
      { row: BOARDING_LAYER_ITEMS_MAX + 2, message: 'Lagret från rad 2 har fler än 100 uppgifter.' },
    ]);
  });

  test('a file that is not Clew’s, an empty one and a quote that never ends are problems with the file', () => {
    expect(parseBoardingImport('name;area;kind\nA;B;C').problems).toEqual([
      { row: 1, message: `Filen känns inte igen. Den första raden ska vara ${BOARDING_IMPORT_COLUMNS.join(', ')}.` },
    ]);
    expect(parseBoardingImport('  \n').problems).toEqual([{ row: 0, message: 'Filen är tom.' }]);
    const open = parseBoardingImport(file('A;introduction;all;;"Ok;todo;manager;1;'));
    expect(open.rows).toEqual([]);
    expect(open.problems).toEqual([
      { row: 2, message: 'Ett citattecken avslutas aldrig. Resten av filen kan inte läsas.' },
    ]);
  });
});

describe('a row as the server is sent it', () => {
  test('holds when every value is Clew’s id and every text is as the page cleaned it', () => {
    expect(boardingImportRowProblem(row())).toBeNull();
    expect(boardingImportRowProblem(row({ condition: 'employment_type', value: 'Tillsvidare' }))).toBeNull();
  });
  test('is refused for the page’s words, text not cleaned, a value where none belongs and an offset out of range', () => {
    expect(boardingImportRowProblem(row({ kind: 'Möte' as never }))).toStartWith('Typen finns inte.');
    expect(boardingImportRowProblem(row({ event: 'Avslut' as never }))).toStartWith('Händelsen finns inte.');
    expect(boardingImportRowProblem(row({ title: '  Beställ dator ' }))).toBe(
      'Raden innehåller text som inte är rensad.',
    );
    expect(boardingImportRowProblem(row({ value: 'unit-x' }))).toBe('Ett lager för alla har inget värde.');
    expect(boardingImportRowProblem(row({ condition: 'position', value: null }))).toBe('Värdet saknas.');
    expect(boardingImportRowProblem(row({ offsetDays: 366 }))).toBe(
      'Antal dagar ska vara ett heltal från -365 till 365.',
    );
    expect(boardingImportRowProblem(row({ tiedTo: 'x'.repeat(301) }))).toBe('Kopplingen är längre än 300 tecken.');
  });
});

describe('what an item is tied to (`tiedTo`)', () => {
  const TIE_PROBLEM =
    'Kopplingen ska vara en förmåga, som servicedesk.order eller servicedesk.order?item=laptop, eller en adress som börjar med https://.';
  test('a capability by its name, with answers its dialog starts from; an https address; nothing', () => {
    expect(boardingTieOf('servicedesk.equipment')).toEqual({
      kind: 'capability',
      capability: 'servicedesk.equipment',
      values: {},
    });
    expect(boardingTieOf('servicedesk.order?item=laptop&note=Till%20Sara')).toEqual({
      kind: 'capability',
      capability: 'servicedesk.order',
      values: { item: 'laptop', note: 'Till Sara' },
    });
    expect(boardingTieOf('https://intranet.example.org/vardegrund?flik=2#start')).toEqual({
      kind: 'link',
      href: 'https://intranet.example.org/vardegrund?flik=2#start',
    });
    expect(boardingTieOf(null)).toBeNull();
    expect(boardingTieOf('')).toBeNull();
  });
  test('anything else says nothing usable: words, another scheme, a broken answer, a key twice', () => {
    for (const text of [
      'HLR',
      'competence:HLR',
      'Servicedesk.order',
      'servicedesk.order?',
      'servicedesk.order?item',
      'servicedesk.order?=laptop',
      'servicedesk.order?item=',
      'servicedesk.order?item=a&item=b',
      'servicedesk.order?item=%E0',
      'servicedesk.order?_item=laptop',
      'servicedesk.order item=laptop',
      'http://intranet.example.org/',
      'https://',
      'https://user:secret@intranet.example.org/',
      'javascript:alert(1)',
      'mailto:hr@example.org',
      'a.' + 'b'.repeat(79),
    ])
      expect(boardingTieOf(text)).toBeNull();
  });
  test('a file names one or nothing: anything else is a problem with its row, in Swedish', () => {
    expect(boardingImportRowProblem(row({ tiedTo: 'servicedesk.order?item=laptop' }))).toBeNull();
    expect(boardingImportRowProblem(row({ tiedTo: 'https://intranet.example.org/' }))).toBeNull();
    expect(boardingImportRowProblem(row({ tiedTo: 'HLR' }))).toBe(TIE_PROBLEM);
    const result = parseBoardingImport(
      file(
        'Alla nyanställda;introduction;all;;Beställ dator;order;manager;-14;servicedesk.order?item=laptop',
        'Alla nyanställda;introduction;all;;Kurs;course;person;30;Kursen i HLR',
        'Alla nyanställda;introduction;all;;Läs;acknowledge;person;3;http://intranet.example.org/',
      ),
    );
    expect(result.rows.map(r => r.tiedTo)).toEqual(['servicedesk.order?item=laptop']);
    expect(result.problems).toEqual([
      { row: 3, message: TIE_PROBLEM },
      { row: 4, message: TIE_PROBLEM },
    ]);
  });
});

describe('the development stack’s layers', () => {
  test('read without a problem: three introduction layers and one leaving layer', () => {
    const result = parseBoardingImport(DEVELOPMENT_LAYERS);
    expect(result.problems).toEqual([]);
    expect(
      boardingLayersOf(result.rows).layers.map(l => [l.name, l.event, l.condition, l.value, l.items.length]),
    ).toEqual([
      ['Alla nyanställda', 'introduction', 'all', null, 8],
      ['Barn och utbildning', 'introduction', 'unit', 'unit-forvaltning-utbildning', 2],
      ['Lärare', 'introduction', 'position', 'larare', 2],
      ['Alla som slutar', 'leaving', 'all', null, 4],
    ]);
  });
});
