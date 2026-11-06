import { describe, expect, test } from 'bun:test';
import { NextcloudProvider } from '../../packages/calendar/src/nextcloud';

const home = '/remote.php/dav/calendars/hillevi/';
const primary = `${home}personal/`;
const outbox = `${home}outbox/`;
const start = '2026-11-09T00:00:00.000Z';
const end = '2026-11-10T00:00:00.000Z';
const multistatus = (body: string) => `<?xml version="1.0" encoding="utf-8"?>
<d:multistatus xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav" xmlns:n="http://nextcloud.com/ns">
${body}
</d:multistatus>`;
const properties = (href: string, body: string) => `<d:response><d:href>${href}</d:href>
<d:propstat><d:prop>${body}</d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response>`;
const discovery = {
  'PROPFIND /remote.php/dav/principals/users/hillevi/': multistatus(
    properties(
      '/remote.php/dav/principals/users/hillevi/',
      `
    <c:calendar-home-set><d:href>${home}</d:href></c:calendar-home-set>
    <c:schedule-outbox-URL><d:href>${outbox}</d:href></c:schedule-outbox-URL>`,
    ),
  ),
  [`PROPFIND ${home}`]: multistatus(
    properties(home, '<d:resourcetype><d:collection/></d:resourcetype>') +
      properties(primary, '<d:resourcetype><d:collection/><c:calendar/></d:resourcetype>'),
  ),
};

async function withProvider(
  replies: Readonly<Record<string, string>>,
  check: (provider: NextcloudProvider) => Promise<void>,
) {
  const server = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    fetch(request) {
      const body = replies[`${request.method} ${new URL(request.url).pathname}`];
      return body === undefined
        ? new Response('Unknown DAV resource', { status: 404 })
        : new Response(body, { status: 207, headers: { 'Content-Type': 'application/xml; charset=utf-8' } });
    },
  });
  try {
    await check(new NextcloudProvider('hillevi', 'synthetic-test-password', server.url.href));
  } finally {
    await server.stop(true);
  }
}

describe('the CalDAV contract through XML and iCalendar dependencies', () => {
  test('room discovery preserves names, addresses, capacity and equipment in namespaced XML', async () => {
    const rooms = multistatus(
      properties(
        '/remote.php/dav/principals/calendar-rooms/sal-a/',
        `
        <d:displayname>Sal A &amp; B</d:displayname>
        <c:calendar-user-address-set><d:href>mailto:sal-a@clew.test</d:href><d:href>urn:uuid:sal-a</d:href></c:calendar-user-address-set>
        <n:room-seating-capacity>12</n:room-seating-capacity><n:room-features>Projektor,Whiteboard</n:room-features>`,
      ) +
        properties(
          '/remote.php/dav/principals/calendar-rooms/sal-o/',
          `
        <d:displayname>Östra salen</d:displayname>
        <c:calendar-user-address-set><d:href>mailto:sal-o@clew.test</d:href></c:calendar-user-address-set>
        <n:room-seating-capacity>4</n:room-seating-capacity>`,
        ),
    ).replaceAll('\n', '\r\n');
    await withProvider({ 'PROPFIND /remote.php/dav/principals/calendar-rooms/': rooms }, async provider => {
      const resources = await provider.resources();
      expect(resources.map(({ name, email, capacity, equipment }) => ({ name, email, capacity, equipment }))).toEqual([
        { name: 'Sal A & B', email: 'sal-a@clew.test', capacity: 12, equipment: ['Projektor', 'Whiteboard'] },
        { name: 'Östra salen', email: 'sal-o@clew.test', capacity: 4, equipment: [] },
      ]);
    });
  });

  test('a calendar report preserves CRLF iCalendar text, revisions and chronological order', async () => {
    const meeting = (uid: string, title: string, hour: string) =>
      [
        'BEGIN:VCALENDAR',
        'VERSION:2.0',
        'PRODID:-//Clew contract test//EN',
        'BEGIN:VEVENT',
        `UID:${uid}`,
        `SUMMARY:${title}`,
        'DTSTAMP:20261104T080000Z',
        `DTSTART:20261109T${hour}0000Z`,
        `DTEND:20261109T${hour}3000Z`,
        'ORGANIZER:mailto:hillevi@clew.test',
        'END:VEVENT',
        'END:VCALENDAR',
        '',
      ].join('\r\n');
    const report = multistatus(
      properties(
        `${primary}late.ics`,
        `<d:getetag>&quot;rev-late&quot;</d:getetag><c:calendar-data><![CDATA[${meeting('late', 'Möte & planering', '13')}]]></c:calendar-data>`,
      ) +
        properties(
          `${primary}early.ics`,
          `<d:getetag>&quot;rev-early&quot;</d:getetag><c:calendar-data><![CDATA[${meeting('early', 'Utvecklingssamtal', '09')}]]></c:calendar-data>`,
        ),
    );
    await withProvider({ ...discovery, [`REPORT ${primary}`]: report }, async provider => {
      const events = await provider.list(start, end);
      expect(
        events.map(({ uid, title, start, end, revision, canCancel }) => ({
          uid,
          title,
          start,
          end,
          revision,
          canCancel,
        })),
      ).toEqual([
        {
          uid: 'early',
          title: 'Utvecklingssamtal',
          start: '2026-11-09T09:00:00.000Z',
          end: '2026-11-09T09:30:00.000Z',
          revision: '"rev-early"',
          canCancel: true,
        },
        {
          uid: 'late',
          title: 'Möte & planering',
          start: '2026-11-09T13:00:00.000Z',
          end: '2026-11-09T13:30:00.000Z',
          revision: '"rev-late"',
          canCancel: true,
        },
      ]);
    });
  });

  test('free-busy replies retain busy periods and leave an unanswered person unknown', async () => {
    const calendar = [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'PRODID:-//Clew contract test//EN',
      'BEGIN:VFREEBUSY',
      'UID:availability',
      'DTSTAMP:20261104T080000Z',
      'DTSTART:20261109T000000Z',
      'DTEND:20261110T000000Z',
      'FREEBUSY;FBTYPE=BUSY:20261109T090000Z/PT1H',
      'FREEBUSY;FBTYPE=FREE:20261109T100000Z/20261109T110000Z',
      'END:VFREEBUSY',
      'END:VCALENDAR',
      '',
    ].join('\r\n');
    const reply = `<c:schedule-response xmlns:c="urn:ietf:params:xml:ns:caldav" xmlns:d="DAV:">
      <c:response><c:recipient><d:href>mailto:anna@clew.test</d:href></c:recipient>
      <c:request-status>2.0;Success</c:request-status><c:calendar-data><![CDATA[${calendar}]]></c:calendar-data>
      </c:response></c:schedule-response>`;
    await withProvider({ ...discovery, [`POST ${outbox}`]: reply }, async provider => {
      expect(
        await provider.freeBusy(start, end, [
          { ref: 'anna', email: 'anna@clew.test' },
          { ref: 'hassan', email: 'hassan@clew.test' },
        ]),
      ).toEqual([
        { ref: 'anna', state: 'known', busy: [{ start: '2026-11-09T09:00:00.000Z', end: '2026-11-09T10:00:00.000Z' }] },
        { ref: 'hassan', state: 'unknown', busy: [] },
      ]);
    });
  });
});
