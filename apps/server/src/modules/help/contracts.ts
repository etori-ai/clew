import { Type, type Static } from '@sinclair/typebox';

/** The help takes nothing: it is the same read for the card's step, the person dialog, the menu and the question box (D97). */
export const HelpInputSchema = Type.Object({}, { additionalProperties: false });
export type HelpInput = Static<typeof HelpInputSchema>;
/** The help as one Markdown text, drawn by the declared `text` view (D38). */
export const HelpOutputSchema = Type.Object({ body: Type.String() });
export type HelpOutput = Static<typeof HelpOutputSchema>;

/** One of the person's areas as the help names it: its system, what it pushes and what can be done at any time. */
export interface HelpArea {
  title: string;
  /** Swedish label of the system the area reads: "Personalsystemet". */
  source: string;
  schedules: Array<{ label: string; when: string }>;
  /** Titles of the capabilities under "Gör själv". */
  standing: string[];
}
/** What the registry knows about one person's page: the only thing the help's text is computed from (D97 item 6). */
export interface HelpOverview {
  /** The areas of the connected systems, the calendar's among them, in the registry's order. Startsidan's own areas are not. */
  areas: HelpArea[];
  /** The rows an administrator put under Verktyg (D40), by their labels. */
  tools: string[];
}
