import { expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { AssistantMarkdown } from '../src/components/conversation/assistant-markdown';

test('an assistant answer shows image descriptions and keeps ordinary links usable', () => {
  const html = renderToStaticMarkup(
    <AssistantMarkdown headingLevelStart={2}>
      {'![Veckoschema](/diagram.svg)\n\nSe ![Bemanning](/staff.svg) och [kalendern](/calendar).'}
    </AssistantMarkdown>,
  );
  expect(html).toContain('Veckoschema');
  expect(html).toContain('Bemanning');
  expect(html).toContain('href="/calendar"');
  expect(html).not.toMatch(/<img\b|as="image"|diagram\.svg|staff\.svg/);
});
