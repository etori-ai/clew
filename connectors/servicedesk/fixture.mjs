// The generic service desk's records (D52: a kind of system, no vendor; everything is made up), shaped as a typical
// service-desk API answers: every record is an envelope `{ Type, Data, Memo }`, a case ("Service Request" for an order,
// "Incident" for a fault report) or a configuration item (a device registered to a person). People are the development
// directory's user names (scripts/provisioner/directory.ts): Hillevi manages the school, Anna, Erik, Maria, Johan and
// Karin report to her, Hassan works in home care and Mikael in IT. Generated from the day the fixture is seeded, so the
// dates never go stale: every state of D123 is there, one request closed two days ago and one with an expected day.

export const dateIn = date => new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Stockholm' }).format(date);
export const addDays = (day, n) => new Date(Date.parse(day + 'T12:00:00Z') + n * 86400000).toISOString().slice(0, 10);
export const shortDate = day =>
  new Intl.DateTimeFormat('sv-SE', { day: 'numeric', month: 'short', timeZone: 'Europe/Stockholm' }).format(
    new Date(day.length === 10 ? day + 'T12:00:00Z' : day),
  );
/** An instant on a day, in Swedish winter time, as the desk writes it: UTC with a zone. */
export const instantOn = (day, time) => new Date(`${day}T${time}:00+01:00`).toISOString();
/** The desk's number for a case: `SD-`, the year and month it was opened, and a sequence. */
export const caseNumber = (day, n) => `SD-${day.slice(2, 4)}${day.slice(5, 7)}${String(n).padStart(4, '0')}`;

/**
 * The desk's catalogue, by the value an order names (manifest.mjs `CATALOGUE`): the category the case is filed under,
 * the group that handles it and how many days a delivery usually takes.
 */
export const CATALOGUE = {
  laptop: { Category: 'Dator', Subject: 'Bärbar dator', ResponsibleGroup: 'Klientsupport', LeadDays: 10 },
  phone: { Category: 'Mobiltelefon', Subject: 'Mobiltelefon', ResponsibleGroup: 'Mobilsupport', LeadDays: 5 },
  'access-card': { Category: 'Passerkort', Subject: 'Passerkort', ResponsibleGroup: 'Passage och lås', LeadDays: 3 },
  'system-access': {
    Category: 'Behörighet',
    Subject: 'Behörighet till ett system',
    ResponsibleGroup: 'Behörighetsadministration',
    LeadDays: 2,
  },
};

/** One case: what the desk has about an order or a fault report. `Contact` is who it is for, `Requester` who made it. */
const serviceCase = (type, data, memo) => ({ Type: type, Data: { Notes: [], ...data }, Memo: memo });
/** One device the desk has registered to a person. */
const device = (inventory, kind, model, serial, assignedTo, assignedOn) => ({
  Type: 'Configuration Item',
  Data: {
    InventoryNumber: inventory,
    Kind: kind,
    Model: model,
    SerialNumber: serial,
    AssignedTo: assignedTo,
    AssignedOn: assignedOn,
    Status: 'In Use',
  },
  Memo: '',
});

export function seed(today) {
  const d = n => addDays(today, n);
  const opened = (n, time) => instantOn(d(n), time);
  const cases = [
    // Hillevi ordered a computer for Anna, who reports to her: on its way, with a day it is expected.
    serviceCase(
      'Service Request',
      {
        Number: caseNumber(d(-8), 41),
        Status: 'In Delivery',
        Category: 'Dator',
        Subject: 'Bärbar dator',
        Item: 'laptop',
        ResponsibleGroup: 'Klientsupport',
        Contact: 'anna',
        Requester: 'hillevi',
        OpenedAt: opened(-8, '09:14'),
        ExpectedOn: d(3),
        Notes: [{ At: opened(-2, '13:30'), Text: 'Datorn är skickad till skolans expedition.' }],
      },
      'Anna behöver en egen dator nu när hon har klassen i år 4. Samma modell som de andra lärarna.',
    ),
    // Hillevi's printer: the desk has asked her something and waits for the answer.
    serviceCase(
      'Incident',
      {
        Number: caseNumber(d(-3), 47),
        Status: 'Awaiting Customer',
        Category: 'Skrivare',
        Subject: 'Skrivaren på expeditionen skriver inte ut',
        ResponsibleGroup: 'Klientsupport',
        Contact: 'hillevi',
        Requester: 'hillevi',
        OpenedAt: opened(-3, '07:52'),
        Notes: [
          {
            At: opened(-1, '10:05'),
            Text: 'Står det någon felkod i skrivarens fönster? Svara gärna med en bild så kommer en tekniker ut.',
          },
        ],
      },
      'Skrivaren tar emot jobben men inget kommer ut. Papper finns.',
    ),
    // A permission Hillevi asked for herself, received and not yet started.
    serviceCase(
      'Service Request',
      {
        Number: caseNumber(d(-1), 52),
        Status: 'Registered',
        Category: 'Behörighet',
        Subject: 'Behörighet till ett system',
        Item: 'system-access',
        ResponsibleGroup: 'Behörighetsadministration',
        Contact: 'hillevi',
        Requester: 'hillevi',
        OpenedAt: opened(-1, '15:40'),
      },
      'Läsbehörighet till ekonomisystemets rapporter för skolans kostnadsställe.',
    ),
    // Hillevi's new phone, delivered two days ago: what was recently delivered stays in her list for a month.
    serviceCase(
      'Service Request',
      {
        Number: caseNumber(d(-12), 33),
        Status: 'Delivered',
        Category: 'Mobiltelefon',
        Subject: 'Mobiltelefon',
        Item: 'phone',
        ResponsibleGroup: 'Mobilsupport',
        Contact: 'hillevi',
        Requester: 'hillevi',
        OpenedAt: opened(-12, '11:20'),
        ClosedAt: opened(-2, '14:10'),
        Notes: [{ At: opened(-2, '14:10'), Text: 'Telefonen är utlämnad. Den gamla lämnas till expeditionen.' }],
      },
      'Den gamla telefonen laddar inte längre.',
    ),
    // Anna's own fault report: being handled, with a day it is expected done.
    serviceCase(
      'Incident',
      {
        Number: caseNumber(d(-2), 49),
        Status: 'In Progress',
        Category: 'Dator',
        Subject: 'Datorn startar om sig själv',
        ResponsibleGroup: 'Klientsupport',
        Contact: 'anna',
        Requester: 'anna',
        OpenedAt: opened(-2, '08:31'),
        ExpectedOn: d(1),
      },
      'Lånedatorn startar om flera gånger om dagen, oftast när jag kopplar in projektorn.',
    ),
    // Hassan's phone is ready to collect: the desk waits for him.
    serviceCase(
      'Service Request',
      {
        Number: caseNumber(d(-6), 44),
        Status: 'Ready for Pickup',
        Category: 'Mobiltelefon',
        Subject: 'Mobiltelefon',
        Item: 'phone',
        ResponsibleGroup: 'Mobilsupport',
        Contact: 'hassan',
        Requester: 'hassan',
        OpenedAt: opened(-6, '13:02'),
        ExpectedOn: d(0),
        Notes: [{ At: opened(0, '07:45'), Text: 'Telefonen finns att hämta i IT-receptionen, plan 2.' }],
      },
      'Telefonen till hemtjänstens planering har spräckt skärm.',
    ),
    // Hassan's fault report from last week, solved.
    serviceCase(
      'Incident',
      {
        Number: caseNumber(d(-9), 38),
        Status: 'Resolved',
        Category: 'Programvara',
        Subject: 'Planeringsappen loggar ut',
        ResponsibleGroup: 'Verksamhetssystem',
        Contact: 'hassan',
        Requester: 'hassan',
        OpenedAt: opened(-9, '06:58'),
        ClosedAt: opened(-5, '16:20'),
        Notes: [{ At: opened(-5, '16:20'), Text: 'Löst med en ny version av appen.' }],
      },
      'Appen loggar ut mig mitt i passet.',
    ),
    // Mikael's order for himself, being handled.
    serviceCase(
      'Service Request',
      {
        Number: caseNumber(d(-4), 46),
        Status: 'In Progress',
        Category: 'Behörighet',
        Subject: 'Behörighet till ett system',
        Item: 'system-access',
        ResponsibleGroup: 'Behörighetsadministration',
        Contact: 'mikael',
        Requester: 'mikael',
        OpenedAt: opened(-4, '10:12'),
      },
      'Administratörsbehörighet i testmiljön för schemasystemet.',
    ),
  ];
  const since = n => d(-n);
  const items = [
    device('INV-104211', 'Bärbar dator', 'Bärbar dator 14 tum', 'SN5Q4471K2', 'hillevi', since(410)),
    device('INV-207118', 'Mobiltelefon', 'Smarttelefon 6,1 tum', 'SN8H2205T9', 'hillevi', since(2)),
    device('INV-310045', 'Dockningsstation', 'Dockningsstation USB-C', 'SN3D0912A7', 'hillevi', since(410)),
    device('INV-104388', 'Bärbar dator', 'Bärbar dator 13 tum', 'SN5Q9935M1', 'anna', since(1460)),
    device('INV-410090', 'Headset', 'Headset med mikrofon', 'SN1K7716B3', 'anna', since(300)),
    device('INV-104402', 'Bärbar dator', 'Bärbar dator 14 tum', 'SN5Q2290P8', 'erik', since(620)),
    device('INV-207131', 'Mobiltelefon', 'Smarttelefon 6,1 tum', 'SN8H5521C4', 'erik', since(240)),
    device('INV-510017', 'Skärm', 'Skärm 27 tum', 'SN9W3304L6', 'erik', since(620)),
    device('INV-104415', 'Bärbar dator', 'Bärbar dator 14 tum', 'SN5Q6618R5', 'maria', since(700)),
    device('INV-207140', 'Mobiltelefon', 'Smarttelefon 6,1 tum', 'SN8H6640D2', 'maria', since(180)),
    device('INV-104420', 'Bärbar dator', 'Bärbar dator 15 tum', 'SN5Q1187S3', 'johan', since(95)),
    device('INV-610008', 'Surfplatta', 'Surfplatta 11 tum', 'SN6T4459F1', 'johan', since(95)),
    device('INV-104433', 'Bärbar dator', 'Bärbar dator 14 tum', 'SN5Q7731H9', 'karin', since(830)),
    device('INV-207152', 'Mobiltelefon', 'Smarttelefon 6,1 tum', 'SN8H9902G7', 'karin', since(830)),
    device('INV-510029', 'Skärm', 'Skärm 24 tum', 'SN9W8815N2', 'karin', since(830)),
    device('INV-207166', 'Mobiltelefon', 'Smarttelefon 5,8 tum', 'SN8H3378J5', 'hassan', since(510)),
    device('INV-610021', 'Surfplatta', 'Surfplatta 10 tum', 'SN6T2207V8', 'hassan', since(510)),
    device('INV-104447', 'Bärbar dator', 'Bärbar dator 15 tum', 'SN5Q5502W4', 'mikael', since(260)),
    device('INV-207178', 'Mobiltelefon', 'Smarttelefon 6,1 tum', 'SN8H7764X1', 'mikael', since(260)),
    device('INV-510033', 'Skärm', 'Skärm 27 tum', 'SN9W6620Y3', 'mikael', since(260)),
    device('INV-310052', 'Dockningsstation', 'Dockningsstation USB-C', 'SN3D4418Z6', 'mikael', since(260)),
  ];
  return { seededOn: today, sequence: 100, cases, items };
}
