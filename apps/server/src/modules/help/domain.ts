import type { HelpArea, HelpOverview } from './contracts';

/** "a, b och c". */
const join = (parts: string[]) =>
  parts.length <= 1 ? (parts[0] ?? '') : `${parts.slice(0, -1).join(', ')} och ${parts.at(-1)}`;
const lower = (s: string) => (s ? s[0]!.toLowerCase() + s.slice(1) : s);
const words = ['', 'ett', 'två', 'tre', 'fyra', 'fem', 'sex', 'sju', 'åtta', 'nio', 'tio', 'elva', 'tolv'];
const count = (n: number) => words[n] ?? String(n);

/**
 * One area as a list row with its system, and under it what the system pushes and when ("Kommer hit") and what can be
 * done at any time ("Gör själv", the page's own words). The connector's words are kept as they are, set apart by a dot.
 */
function areaLines(area: HelpArea): string[] {
  return [
    `- **${area.title}** (${area.source})`,
    ...(area.schedules.length
      ? [`  - Kommer hit: ${area.schedules.map(s => `${s.label} (${lower(s.when)})`).join(' · ')}`]
      : []),
    ...(area.standing.length ? [`  - Gör själv: ${area.standing.join(' · ')}`] : []),
  ];
}

/**
 * "Det här har du" (D97 item 6): the one section computed for the person, from the systems, areas and tools the
 * registry lets them see. Nobody writes it, so it is right as soon as a system is connected or an audience changes.
 */
function yours(overview: HelpOverview): string[] {
  const systems = [...new Set(overview.areas.map(a => a.source))];
  const lead = systems.length
    ? `Startsidan läser ur ${systems.length === 1 ? 'ett system' : `${count(systems.length)} system`} åt dig: ${join(systems)}.`
    : 'Inget system är anslutet för dig ännu. När ett ansluts kommer dess uppgifter hit utan att du behöver göra något.';
  const rows = [
    ...overview.areas.flatMap(areaLines),
    overview.tools.length ? `- **Verktyg i menyn**: ${join(overview.tools)}.` : '',
  ].filter(Boolean);
  return [lead, ...(rows.length ? ['', ...rows] : [])];
}

/**
 * The help as Markdown (D97): fixed sections that are the same in every installation, and the person's own in the
 * middle. Swedish, because a person reads it. `#` is the view's first heading level, which the surface places (D38).
 */
export function helpText(overview: HelpOverview): string {
  return [
    '# Det här är Startsidan',
    '',
    'Startsidan samlar det som behöver dig från systemen du arbetar i. Du ser varför något har hamnat här, du bestämmer vad som ska hända, och du får ett kvitto när systemet har svarat. Uppgifterna ligger kvar i sina system. Startsidan visar dem och minns vad du har gjort.',
    '',
    '# Fråga eller sök i rutan',
    '',
    'Skriv vad du undrar eller vad du vill göra i rutan överst på Hem, till exempel "Vad har jag i dag?" eller en fråga om en rutin. Svaret hämtas som du, ur det du får se, och källan står under svaret. Du behöver inte veta vilket system något finns i.',
    '',
    '# Korten under Behöver dig',
    '',
    '- **Nu** är det som ska göras i dag. **Senare** har en annan dag, eller ingen dag alls. **Jag föreslår** är förslag, där nej tack också är ett svar. **Till kännedom** är sådant du bara behöver veta.',
    '- Välj ett korts rubrik för att öppna det bredvid sidan. Där står vad det gäller, nästa steg och varför du ser det.',
    '- Passar det inte nu väljer du **Inte nu**, så kommer kortet tillbaka. Är det inte aktuellt väljer du **Avfärda** under Fler val.',
    '- Inget skickas till ett annat system förrän du har valt det. Efteråt visar kortet vad systemet svarade, under Klart.',
    '- Du får högst tre avbrott per dag. Resten samlas till lunch eller nästa morgon.',
    '',
    '# Det här har du',
    '',
    ...yours(overview),
    '',
    '# Hitta tillbaka hit',
    '',
    'Hjälpen finns under ditt namn högst upp på sidan. Du kan också skriva "Vad kan jag göra här?" i rutan.',
  ].join('\n');
}
