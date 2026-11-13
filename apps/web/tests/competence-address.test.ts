import { describe, expect, test } from 'bun:test';
import {
  COMPETENCE_PATH,
  MATRIX_PATH,
  SEARCH_PATH,
  addHref,
  adding,
  addingType,
  approvalPageHref,
  approveHref,
  approveOf,
  attentionHref,
  attentionOnly,
  holdingsPageHref,
  matrixFileHref,
  matrixHref,
  matrixInputOf,
  matrixQuery,
  requirementHref,
  noSearchHref,
  sameSearch,
  searchBodyOf,
  searchFileBodyOf,
  searchHref,
  searchOf,
  skillHref,
  type SearchAddress,
  skillOf,
  validateHref,
  validateOf,
  withoutAdd,
  withoutApprove,
  withoutRequirement,
  withoutSkill,
  withoutValidate,
} from '../src/competence-address';
import { registerHref, registerOf, registerTypeOf, withoutRegister } from '../src/register-address';

describe('the matrix names its columns and what lies over it in the address (D108 item 11, D116)', () => {
  test('the set of columns is `by`, and `part` past the first; anything else is the first set', () => {
    expect(matrixInputOf('?by=area%3AS%C3%A4kerhet&part=2')).toEqual({ by: 'area:Säkerhet', part: 2 });
    expect(matrixInputOf('?by=position%3Apos-usk')).toEqual({ by: 'position:pos-usk' });
    expect(matrixInputOf('?by=area%3AAkut&part=1')).toEqual({ by: 'area:Akut' });
    for (const part of ['0', '100', 'x', '-1', '1.5']) expect(matrixInputOf(`?by=a&part=${part}`)).toEqual({ by: 'a' });
    expect(matrixInputOf('?by=' + 'a'.repeat(201))).toEqual({});
    expect(matrixInputOf('')).toEqual({});
  });
  test('the page, the read and the file carry the same set, the first part left out', () => {
    expect(matrixQuery({})).toBe('');
    expect(matrixQuery({ by: 'area:Säkerhet', part: 1 })).toBe('?by=area%3AS%C3%A4kerhet');
    expect(matrixHref({ by: 'area:Säkerhet', part: 2 })).toBe(`${MATRIX_PATH}?by=area%3AS%C3%A4kerhet&part=2`);
    // A move within the page keeps what is open beside it: the panel's card stays, the earlier set is replaced.
    expect(matrixHref({ by: 'position:pos-usk' }, '?card=omtanke&by=area%3AAkut&part=2')).toBe(
      `${MATRIX_PATH}?card=omtanke&by=position%3Apos-usk`,
    );
    expect(matrixHref({ by: 'area:Akut', part: 1 }, '?open=x.read&open-input=%7B%7D')).toBe(
      `${MATRIX_PATH}?open=x.read&open-input=%7B%7D&by=area%3AAkut`,
    );
    expect(matrixFileHref({ by: 'position:pos-usk' })).toBe('/api/competence/matrix.csv?by=position%3Apos-usk');
    expect(matrixFileHref({})).toBe('/api/competence/matrix.csv');
    // The file is what the page shows: narrowed when the page is (the review of 2026-11-13).
    expect(matrixFileHref({}, true)).toBe('/api/competence/matrix.csv?only=attention');
    expect(matrixFileHref({ by: 'area:Akut', part: 2 }, true)).toBe(
      '/api/competence/matrix.csv?by=area%3AAkut&part=2&only=attention',
    );
  });
  test('`only=attention` narrows to what needs the manager, keeps the set and the rest, and is never sent to the server', () => {
    expect(attentionOnly('?only=attention')).toBe(true);
    for (const q of ['', '?only=all', '?only=', '?attention=1']) expect(attentionOnly(q)).toBe(false);
    expect(attentionHref(true, '?by=area%3AAkut&card=omtanke')).toBe(
      `${MATRIX_PATH}?by=area%3AAkut&card=omtanke&only=attention`,
    );
    expect(attentionHref(false, '?by=area%3AAkut&only=attention')).toBe(`${MATRIX_PATH}?by=area%3AAkut`);
    expect(attentionHref(false, '?only=attention')).toBe(MATRIX_PATH);
    // The read and the file take the set alone.
    expect(matrixInputOf('?only=attention&by=area%3AAkut')).toEqual({ by: 'area:Akut' });
    expect(matrixHref({}, '?by=area%3AAkut&part=2&only=attention')).toBe(`${MATRIX_PATH}?only=attention`);
    expect(requirementHref('?only=attention')).toBe(`${MATRIX_PATH}?only=attention&requirement=new`);
  });
  test('the dialog that adds a requirement for one person lies over the matrix, its set kept, and closes to it', () => {
    expect(requirementHref('?by=area%3AAkut')).toBe(`${MATRIX_PATH}?by=area%3AAkut&requirement=new`);
    expect(withoutRequirement('?by=area%3AAkut&requirement=new')).toBe(`${MATRIX_PATH}?by=area%3AAkut`);
    expect(withoutRequirement('requirement=new')).toBe(MATRIX_PATH);
  });
  test('a cell opens the registration for its person and its competence; closing drops both and keeps the set', () => {
    const open = registerHref(MATRIX_PATH, 'anna', '?by=area%3AAkut', 't-hlr');
    expect(open).toBe(`${MATRIX_PATH}?by=area%3AAkut&register=anna&competence=t-hlr`);
    const query = open.split('?')[1]!;
    expect([registerOf(query), registerTypeOf(query)]).toEqual(['anna', 't-hlr']);
    expect(withoutRegister(MATRIX_PATH, query)).toBe(`${MATRIX_PATH}?by=area%3AAkut`);
    // From Personal, no competence is named, and one left from before is not carried along.
    expect(registerHref('/staff', 'anna', '?competence=t-hlr')).toBe('/staff?register=anna');
    expect(registerTypeOf('?register=anna')).toBeNull();
  });
});

describe("a person's own registration and its decision have addresses of their own (D108 item 7)", () => {
  test("the dialog that registers one of the reader's own lies over their page and closes to it", () => {
    expect(addHref('')).toBe(`${COMPETENCE_PATH}?add=new`);
    expect(addHref('?card=omtanke')).toBe(`${COMPETENCE_PATH}?card=omtanke&add=new`);
    expect([adding('?add=new'), adding('?add=other'), adding('')]).toEqual([true, false, false]);
    expect(withoutAdd('?card=omtanke&add=new')).toBe(`${COMPETENCE_PATH}?card=omtanke`);
    expect(withoutAdd('add=new')).toBe(COMPETENCE_PATH);
    // From a row of the reader's own list, the dialog starts on the row's type (renewal); closing drops both.
    expect(addHref('?card=omtanke', 't-hlr')).toBe(`${COMPETENCE_PATH}?card=omtanke&add=new&competence=t-hlr`);
    expect(addHref('?add=new&competence=t-old')).toBe(`${COMPETENCE_PATH}?add=new`);
    expect([addingType('?add=new&competence=t-hlr'), addingType('?competence=t-hlr'), addingType('?add=new')]).toEqual([
      't-hlr',
      null,
      null,
    ]);
    expect(withoutAdd('?card=omtanke&add=new&competence=t-hlr')).toBe(`${COMPETENCE_PATH}?card=omtanke`);
    expect(skillHref('h-1', '?add=new&competence=t-hlr')).toBe(`${COMPETENCE_PATH}?skill=h-1`);
  });
  test('the decision lies over the matrix, its set kept, and closes to it', () => {
    const open = approveHref('h-1', '?by=area%3AAkut');
    expect(open).toBe(`${MATRIX_PATH}?by=area%3AAkut&approve=h-1`);
    expect(approveOf(open.split('?')[1]!)).toBe('h-1');
    expect(approveOf('?approve=' + 'x'.repeat(81))).toBeNull();
    expect(approveOf('')).toBeNull();
    expect(withoutApprove('?by=area%3AAkut&approve=h-1')).toBe(`${MATRIX_PATH}?by=area%3AAkut`);
  });
  test("the page of the approval's read leads to the decision over the matrix, or to the matrix when it names none", () => {
    const input = encodeURIComponent(JSON.stringify({ holding: 'h-1' }));
    expect(approvalPageHref(`?input=${input}&from=%2F`)).toBe(`${MATRIX_PATH}?approve=h-1`);
    for (const bad of ['', '?input=nonsense', `?input=${encodeURIComponent('{"holding":7}')}`, '?input=%7B%7D'])
      expect(approvalPageHref(bad)).toBe(MATRIX_PATH);
  });
});

describe('a skill is changed and confirmed over its page, named in the address (D120 item 2)', () => {
  test('`validate` over the matrix names the skill whose level is confirmed, the set of columns kept', () => {
    expect(validateHref('h-1', '?by=area%3AS%C3%A5k&part=2')).toBe(
      `${MATRIX_PATH}?by=area%3AS%C3%A5k&part=2&validate=h-1`,
    );
    expect(validateOf('?validate=h-1')).toBe('h-1');
    expect(validateOf('?validate=' + 'x'.repeat(81))).toBeNull();
    expect(validateOf('')).toBeNull();
    expect(withoutValidate('?by=area%3AAkut&validate=h-1')).toBe(`${MATRIX_PATH}?by=area%3AAkut`);
  });
  test('`skill` over the reader’s own page names the skill they change; it replaces `add`', () => {
    expect(skillHref('h-2', '?add=new&card=x')).toBe(`${COMPETENCE_PATH}?card=x&skill=h-2`);
    expect(skillOf('?skill=h-2')).toBe('h-2');
    expect(skillOf('?skill=')).toBeNull();
    expect(withoutSkill('?skill=h-2&card=x')).toBe(`${COMPETENCE_PATH}?card=x`);
  });
});

describe('Kompetenssökning keeps the whole search in the address, by ids and codes (D121, D43)', () => {
  const none: SearchAddress = {
    typeIds: [],
    unitId: null,
    minLevel: null,
    status: [],
    until: null,
    sort: 'name',
    order: 'asc',
    page: 1,
    pageSize: 25,
    unreadable: null,
  };
  test('the search is read from the address; a code it cannot mean is the default', () => {
    expect(searchOf('')).toEqual(none);
    expect(
      searchOf(
        '?type=t-hlr,t-eng&unit=u-1&level=2&status=expired,expiring&until=90&sort=until&order=desc&page=3&size=50',
      ),
    ).toEqual({
      typeIds: ['t-hlr', 't-eng'],
      unitId: 'u-1',
      minLevel: 2,
      // In the contract's order, whatever the address's.
      status: ['expiring', 'expired'],
      until: 90,
      sort: 'until',
      order: 'desc',
      page: 3,
      pageSize: 50,
      unreadable: null,
    });
    // An encoded comma reads as one, and a type named twice is one.
    expect(searchOf('?type=a%2Cb%2Ca').typeIds).toEqual(['a', 'b']);
    for (const odd of [
      '?page=0',
      '?page=-2',
      '?page=x',
      '?page=1.5',
      '?page=100001',
      '?size=30',
      '?level=4',
      '?status=gone',
      '?until=60',
      '?sort=age',
      '?order=up',
    ])
      expect(searchOf(odd)).toEqual(none);
  });
  test('an id that is no id, or more types than one search takes, is unreadable and asks nothing', () => {
    expect(searchOf('?type=a,' + 'x'.repeat(81))).toMatchObject({ typeIds: [], unreadable: 'type' });
    expect(searchOf('?type=a,b%1B')).toMatchObject({ typeIds: [], unreadable: 'type' });
    expect(searchOf('?type=a,b,c,d,e,f')).toMatchObject({ typeIds: [], unreadable: 'types' });
    expect(searchOf('?type=a&unit=u%0A1')).toMatchObject({ typeIds: ['a'], unitId: null, unreadable: 'unit' });
    expect(searchBodyOf(searchOf('?type=a,b,c,d,e,f'))).toBeNull();
    expect(searchBodyOf(searchOf('?type=a&unit=u%0A1'))).toBeNull();
    expect(searchBodyOf(searchOf('?unit=u-1'))).toBeNull();
  });
  test('a change keeps the rest of the address, starts from the first page unless it is a step, and leaves the defaults out', () => {
    expect(searchHref({ page: 2 }, '?type=a')).toBe(`${SEARCH_PATH}?type=a&page=2`);
    expect(searchHref({ page: 1 }, '?type=a&page=4&card=x')).toBe(`${SEARCH_PATH}?card=x&type=a`);
    expect(searchHref({ pageSize: 100 }, '?type=a&page=4')).toBe(`${SEARCH_PATH}?type=a&size=100`);
    expect(searchHref({ pageSize: 25 }, '?type=a&page=4&size=50')).toBe(`${SEARCH_PATH}?type=a`);
    // A filter, a type or an order starts again from the first page; the lists keep plain commas.
    expect(searchHref({ status: ['expired', 'valid'] }, '?type=a&page=3')).toBe(
      `${SEARCH_PATH}?type=a&status=valid,expired`,
    );
    expect(searchHref({ typeIds: ['a', 'b'] }, '?type=a&page=3&size=50')).toBe(`${SEARCH_PATH}?type=a,b&size=50`);
    expect(searchHref({ sort: 'until', order: 'desc' }, '?type=a&page=2')).toBe(
      `${SEARCH_PATH}?type=a&sort=until&order=desc`,
    );
    expect(searchHref({ sort: 'name', order: 'asc' }, '?type=a&sort=unit')).toBe(`${SEARCH_PATH}?type=a`);
    expect(
      searchHref({ unitId: null, minLevel: null, status: [], until: null }, '?type=a&unit=u&level=2&until=30'),
    ).toBe(`${SEARCH_PATH}?type=a`);
    // Two addresses of one search are one in the written form, so a change to the same search writes nothing.
    expect(sameSearch('?status=expired,valid&type=a%2Cb')).toBe(sameSearch('?type=a,b&status=valid,expired'));
    expect(noSearchHref('?type=a&unit=u&sort=unit&size=50&page=2')).toBe(`${SEARCH_PATH}?sort=unit&size=50`);
  });
  test('the body asks for what the address names, the defaults left out, and the file for every page of it', () => {
    const body = searchBodyOf(searchOf('?type=a,b&level=3&status=valid&until=30&sort=level&order=desc&page=2'));
    expect(body).toEqual({
      typeIds: ['a', 'b'],
      minLevel: 3,
      status: ['valid'],
      until: 30,
      sort: 'level',
      order: 'desc',
      page: 2,
      pageSize: 25,
    });
    expect(searchFileBodyOf(body!)).toEqual({
      typeIds: ['a', 'b'],
      minLevel: 3,
      status: ['valid'],
      until: 30,
      sort: 'level',
      order: 'desc',
    });
    expect(searchBodyOf(searchOf('?type=a'))).toEqual({ typeIds: ['a'], page: 1, pageSize: 25 });
  });
  test('a hit opens the person’s holdings on the read’s page, the search as the way back, and no name in the address', () => {
    const href = holdingsPageHref('anna.lindqvist', `${SEARCH_PATH}?page=2`);
    const url = new URL(href, 'https://clew.test');
    expect(url.pathname).toBe('/tools/competence.holdings');
    expect(JSON.parse(url.searchParams.get('input')!)).toEqual({ person: 'anna.lindqvist' });
    expect(url.searchParams.has('title')).toBe(false);
    expect(url.searchParams.get('from')).toBe(`${SEARCH_PATH}?page=2`);
  });
});
