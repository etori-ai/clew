import type { Figure } from '@clew/contracts';
import { Heading, Text } from '@clew/ui';
/** "Läget": four figures, always the same shape, lightness as well as hue for status. */
export function Lage({ figures }: { figures: Figure[] }) {
  return <section aria-labelledby="lage-heading" className="today">
    <Heading level={2} id="lage-heading">Läget</Heading>
    <div className="lage">
      {figures.map(f => <div key={f.id} className="lage-tile" data-tone={f.tone} role="group" aria-label={`${f.label}: ${f.value}, ${f.comparison}`}>
        <Text type="supporting">{f.label}</Text>
        <Text type="large" weight="semibold" hasTabularNumbers>{f.value}</Text>
        <Text type="supporting">{f.comparison}</Text>
      </div>)}
    </div>
  </section>;
}
