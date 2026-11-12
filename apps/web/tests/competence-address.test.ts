import { describe, expect, test } from 'bun:test';
import {
  MATRIX_PATH,
  matrixFileHref,
  matrixHref,
  matrixInputOf,
  matrixQuery,
  requirementHref,
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
