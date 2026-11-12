import { describe, expect, test } from 'bun:test';
import {
  COMPETENCE_PATH,
  MATRIX_PATH,
  addHref,
  adding,
  approvalPageHref,
  approveHref,
  approveOf,
  matrixFileHref,
  matrixHref,
  matrixInputOf,
  matrixQuery,
  requirementHref,
  withoutAdd,
  withoutApprove,
  withoutRequirement,
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
