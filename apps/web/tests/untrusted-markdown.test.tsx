import { expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { UntrustedMarkdown } from '@clew/ui';

test('an assistant answer shows image descriptions and keeps ordinary links usable', () => {
  const html = renderToStaticMarkup(
    <UntrustedMarkdown headingLevelStart={2}>
      {'![Veckoschema](/diagram.svg)\n\nSe ![Bemanning](/staff.svg) och [kalendern](/calendar).'}
    </UntrustedMarkdown>,
  );
  expect(html).toContain('Veckoschema');
  expect(html).toContain('Bemanning');
  expect(html).toContain('href="/calendar"');
  expect(html).not.toMatch(/<img\b|as="image"|diagram\.svg|staff\.svg/);
});
