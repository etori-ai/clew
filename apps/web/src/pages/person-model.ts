import type { PersonProfile } from '@clew/contracts';

/**
 * A person's profile as the page writes it (D114), as pure functions: no React, no request. The page draws; this file
 * decides the words.
 */

type Employment = PersonProfile['employments'][number];

const percent = new Intl.NumberFormat('sv-SE', { style: 'unit', unit: 'percent', maximumFractionDigits: 2 });
/**
 * An employment's percentage of full time, as the house writes a number: at most two decimals, so a fraction a
 * provisioner multiplied by 100 reads as meant ("57 %", never "56,99999999999999 %").
 */
export const employmentPercent = (value: number) => percent.format(value);

/** What an employment is called in its list: its title, else its unit, else, for a unit since removed, the word alone. */
export const employmentLabel = (employment: Employment) => employment.title ?? employment.unitLabel ?? 'Anställning';
