import { useEffect, useRef, useState } from 'react';
import type { DocumentDescriptor } from '@clew/contracts';
import { Icon } from '@astryxdesign/core/Icon';
import { IconButton } from '@astryxdesign/core/IconButton';
import { Toolbar } from '@astryxdesign/core/Toolbar';
import { DocumentTextIcon } from '@heroicons/react/24/outline';
import { VStack } from '@astryxdesign/core/Layout';
import { Text } from '@astryxdesign/core/Text';
import { Selector } from '@astryxdesign/core/Selector';
import { Table, pixel } from '@astryxdesign/core/Table';
import { ScrollableArea } from '@astryxdesign/core/ScrollableArea';
import { checkOfficeContent, columnName } from './document-limits';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import './document.css';

export type DocumentPosition = { page?: number; zoom?: string; asText?: boolean; sheet?: string };
type Props = {
  bytes: ArrayBuffer;
  document: DocumentDescriptor;
  position?: DocumentPosition;
  onPosition?: (position: DocumentPosition) => void;
  onReady?: () => void;
  onError?: () => void;
};
/** File content only is custom (D79); all controls and scrolling belong to Astryx. No connector HTML enters the host. */
export function DocumentSurface(props: Props) {
  const [error, setError] = useState('');
  const callbacks = useRef(props);
  callbacks.current = props;
  const failed = (message: string) => {
    setError(message);
    callbacks.current.onError?.();
  };
  const ready = () => callbacks.current.onReady?.();
  if (error)
    return (
      <Text as="p" role="alert">
        {error} Hämta originalet för att läsa det i ett annat program.
      </Text>
    );
  const common = { ...props, ready, failed };
  if (props.document.mediaType === 'application/pdf') return <PdfDocument {...common} />;
  if (props.document.mediaType.includes('wordprocessingml')) return <WordDocument {...common} />;
  if (props.document.mediaType.includes('spreadsheetml')) return <Workbook {...common} />;
  return <ImageDocument {...common} />;
}
type RendererProps = Props & { ready(): void; failed(message: string): void };
const message = 'Förhandsvisningen kunde inte läsas.';

function ImageDocument({ bytes, document, ready, failed }: RendererProps) {
  const [url, setUrl] = useState('');
  useEffect(() => {
    const value = URL.createObjectURL(new Blob([bytes], { type: document.mediaType }));
    setUrl(value);
    return () => URL.revokeObjectURL(value);
  }, [bytes, document.mediaType]);
  return url ? (
    <img
      className="clew-document-image"
      src={url}
      alt={document.title}
      onLoad={ready}
      onError={() => failed(message)}
    />
  ) : null;
}

function PdfDocument({ bytes, ready, failed, position, onPosition }: RendererProps) {
  const [pdf, setPdf] = useState<PDFDocumentProxy | null>(null);
  const [page, setPage] = useState(position?.page ?? 1),
    [zoom, setZoom] = useState(position?.zoom ?? '1'),
    [text, setText] = useState(''),
    [asText, setAsText] = useState(position?.asText ?? false),
    [busy, setBusy] = useState(true);
  useEffect(() => {
    onPosition?.({ page, zoom, asText });
  }, [page, zoom, asText]);
  const canvas = useRef<HTMLCanvasElement>(null),
    layer = useRef<HTMLDivElement>(null),
    host = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(320);
  useEffect(() => {
    let cancelled = false;
    let task: ReturnType<(typeof import('pdfjs-dist'))['getDocument']> | undefined;
    void import('pdfjs-dist')
      .then(async lib => {
        const worker = await import('pdfjs-dist/build/pdf.worker.min.mjs?url');
        if (cancelled) return;
        lib.GlobalWorkerOptions.workerSrc = worker.default;
        task = lib.getDocument({ data: bytes.slice(0), enableXfa: false, useSystemFonts: true });
        const loaded = await task.promise;
        if (cancelled) return;
        if (loaded.numPages > 300) throw new Error('Dokumentet har fler än 300 sidor.');
        setPdf(loaded);
      })
      .catch(() => {
        if (!cancelled) failed('PDF-filen är skadad, lösenordsskyddad eller för stor.');
      });
    return () => {
      cancelled = true;
      void task?.destroy();
    };
  }, [bytes]);
  // Content fit is the rendering engine's viewport, not application layout (D79).
  useEffect(() => {
    if (!host.current) return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setWidth(Math.max(100, entry.contentRect.width));
    });
    observer.observe(host.current);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    if (!pdf) return;
    let cancelled = false;
    let render: ReturnType<Awaited<ReturnType<PDFDocumentProxy['getPage']>>['render']> | undefined;
    let textLayer: import('pdfjs-dist').TextLayer | undefined;
    setBusy(true);
    void (async () => {
      const p = await pdf.getPage(page);
      const viewport = p.getViewport({ scale: Math.min(2, width / p.getViewport({ scale: 1 }).width) * Number(zoom) });
      if (viewport.width * viewport.height > 4_000_000 || viewport.height > 8000)
        throw new Error('PDF page exceeds the render budget');
      if (cancelled || !canvas.current || !layer.current) return;
      const c = canvas.current,
        target = layer.current,
        ratio = Math.min(2, window.devicePixelRatio || 1);
      c.width = Math.floor(viewport.width * ratio);
      c.height = Math.floor(viewport.height * ratio);
      c.style.width = `${viewport.width}px`;
      c.style.height = `${viewport.height}px`;
      target.replaceChildren();
      target.style.setProperty('--total-scale-factor', String(viewport.scale));
      render = p.render({ canvas: c, viewport, transform: [ratio, 0, 0, ratio, 0, 0] });
      const content = await p.getTextContent();
      if (cancelled) return;
      setText(content.items.map(item => ('str' in item ? item.str + (item.hasEOL ? '\n' : ' ') : '')).join(''));
      const { TextLayer } = await import('pdfjs-dist');
      if (cancelled) return;
      textLayer = new TextLayer({ textContentSource: content, container: target, viewport });
      await Promise.all([render.promise, textLayer.render()]);
      if (!cancelled) {
        setBusy(false);
        ready();
      }
    })().catch(() => {
      if (!cancelled) failed(message);
    });
    return () => {
      cancelled = true;
      render?.cancel();
      textLayer?.cancel();
    };
  }, [pdf, page, width, zoom]);
  return (
    <VStack gap={2}>
      <Toolbar
        label="PDF-verktyg"
        size="sm"
        dividers={['bottom']}
        startContent={
          <>
            <IconButton
              label="Föregående sida"
              tooltip="Föregående sida"
              icon={<Icon icon="chevronLeft" />}
              variant="ghost"
              isDisabled={!pdf || page === 1}
              onClick={() => setPage(page - 1)}
            />
            <Text role="status" aria-label={`Sida ${page} av ${pdf?.numPages ?? '…'}`}>
              {page} / {pdf?.numPages ?? '…'}
            </Text>
            <IconButton
              label="Nästa sida"
              tooltip="Nästa sida"
              icon={<Icon icon="chevronRight" />}
              variant="ghost"
              isDisabled={!pdf || page >= pdf.numPages}
              onClick={() => setPage(page + 1)}
            />
          </>
        }
        endContent={
          <>
            <Selector
              label="Förstoring"
              isLabelHidden
              variant="ghost"
              width={112}
              value={zoom}
              onChange={setZoom}
              options={[
                { value: '1', label: 'Sidbredd' },
                { value: '1.5', label: '150 %' },
                { value: '2', label: '200 %' },
              ]}
            />
            <IconButton
              label={asText ? 'Visa sidan' : 'Visa sidans text'}
              tooltip={asText ? 'Visa sidan' : 'Visa sidans text'}
              icon={<Icon icon={DocumentTextIcon} />}
              aria-pressed={asText}
              variant="ghost"
              onClick={() => setAsText(!asText)}
            />
          </>
        }
      />
      {busy && <Text role="status">Läser sidan …</Text>}
      <div ref={host} className="clew-document-host">
        <div hidden={asText}>
          <ScrollableArea axis="inline" label="PDF-sida">
            <div className="clew-pdf-page">
              <canvas ref={canvas} aria-hidden="true" />
              <div ref={layer} className="clew-pdf-text" aria-hidden="true" />
            </div>
          </ScrollableArea>
        </div>
        {asText && <Text as="p">{text || 'Sidan saknar maskinläsbar text. Originalet kan behöva läsas med OCR.'}</Text>}
      </div>
    </VStack>
  );
}

const frameContent =
  '<!doctype html><html lang="sv"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src \'none\'; img-src data:; font-src data:; style-src \'unsafe-inline\'; base-uri \'none\'; form-action \'none\'"><style>body{margin:0;background:white;color:black} .docx-wrapper{padding:0!important;background:white!important} section.docx{box-shadow:none!important;margin:0!important} </style></head><body></body></html>';
function WordDocument({ bytes, document, ready, failed, position, onPosition }: RendererProps) {
  const frame = useRef<HTMLIFrameElement>(null);
  const [loaded, setLoaded] = useState(false),
    [zoom, setZoom] = useState(position?.zoom ?? '1');
  useEffect(() => {
    onPosition?.({ zoom });
  }, [zoom]);
  const zoomRef = useRef(zoom);
  zoomRef.current = zoom;
  useEffect(() => {
    if (!loaded || !frame.current?.contentDocument) return;
    let cancelled = false;
    const element = frame.current,
      doc = element.contentDocument!;
    doc.title = document.title;
    const fit = () => {
      const page = doc.querySelector<HTMLElement>('section.docx');
      if (page)
        doc.body.style.zoom = String(Math.min(1, element.clientWidth / page.offsetWidth) * Number(zoomRef.current));
    };
    const observer = new ResizeObserver(fit);
    observer.observe(element);
    void (async () => {
      await checkOfficeContent(bytes);
      const { renderAsync } = await import('docx-preview');
      if (cancelled) return;
      await renderAsync(bytes, doc.body, doc.head, {
        useBase64URL: true,
        renderAltChunks: false,
        renderChanges: false,
        renderComments: false,
        ignoreFonts: true,
      });
      if (cancelled) return;
      // Links in untrusted documents are inert; downloads and navigation belong to the host.
      doc.querySelectorAll('a').forEach(a => a.removeAttribute('href'));
      fit();
      ready();
    })().catch(() => {
      if (!cancelled) failed(message);
    });
    return () => {
      cancelled = true;
      observer.disconnect();
    };
  }, [bytes, loaded]);
  useEffect(() => {
    const el = frame.current,
      doc = el?.contentDocument,
      page = doc?.querySelector<HTMLElement>('section.docx');
    if (el && doc && page) doc.body.style.zoom = String(Math.min(1, el.clientWidth / page.offsetWidth) * Number(zoom));
  }, [zoom]);
  return (
    <VStack gap={2}>
      <Text type="supporting">
        Förhandsvisning av Word-dokument. Sidbrytningar och typsnitt kan skilja sig från originalet.
      </Text>
      <Selector
        label="Förstoring"
        value={zoom}
        onChange={setZoom}
        options={[
          { value: '1', label: 'Anpassa bredd' },
          { value: '1.5', label: '150 %' },
          { value: '2', label: '200 %' },
        ]}
      />
      <iframe
        ref={frame}
        title={document.title}
        sandbox="allow-same-origin"
        srcDoc={frameContent}
        className="clew-document-frame"
        onLoad={() => setLoaded(true)}
      />
    </VStack>
  );
}

type Sheet = { name: string; totalRows: number; columns: number; truncated: boolean; rows: string[][] };
function Workbook({ bytes, ready, failed, position, onPosition }: RendererProps) {
  const [sheets, setSheets] = useState<Sheet[]>([]),
    [chosen, setChosen] = useState(position?.sheet ?? '0'),
    [truncated, setTruncated] = useState(false),
    [loaded, setLoaded] = useState(false);
  useEffect(() => {
    onPosition?.({ sheet: chosen });
  }, [chosen]);
  useEffect(() => {
    const worker = new Worker(new URL('./workbook.worker.ts', import.meta.url), { type: 'module' });
    const timer = setTimeout(() => {
      worker.terminate();
      failed('Kalkylbladet tog för lång tid att läsa.');
    }, 15000);
    worker.onmessage = event => {
      clearTimeout(timer);
      if (event.data.error) failed('Kalkylbladet kunde inte läsas eller är för stort.');
      else {
        setSheets(event.data.sheets);
        setTruncated(event.data.truncated);
        setLoaded(true);
        ready();
      }
      worker.terminate();
    };
    worker.onerror = () => {
      clearTimeout(timer);
      worker.terminate();
      failed(message);
    };
    const copy = bytes.slice(0);
    worker.postMessage(copy, [copy]);
    return () => {
      clearTimeout(timer);
      worker.terminate();
    };
  }, [bytes]);
  const sheet = sheets[Number(chosen)];
  type Row = { id: string; cells: string[] };
  return (
    <VStack gap={2}>
      <Text type="supporting">
        Cellvärden ur originalet. Formler räknas inte om; sparade resultat kan saknas eller vara gamla. Diagram, format
        och dolda rader återges inte som i Excel.
      </Text>
      {sheets.length ? (
        <Selector
          label="Kalkylblad"
          value={chosen}
          onChange={setChosen}
          options={sheets.map((s, i) => ({ value: String(i), label: s.name }))}
        />
      ) : (
        <Text role="status">{loaded ? 'Arbetsboken har inga kalkylblad.' : 'Läser kalkylblad …'}</Text>
      )}
      {sheet && (
        <>
          <Text role="status">
            {sheet.rows.length} av {sheet.totalRows} rader · {sheet.columns} kolumner
            {sheet.truncated || truncated
              ? '. Förhandsvisningen är begränsad. Hämta originalet för hela arbetsboken.'
              : ''}
          </Text>
          <Table<Row>
            aria-label={sheet.name}
            density="compact"
            dividers="grid"
            idKey="id"
            data={sheet.rows.map((cells, i) => ({ id: String(i + 1), cells }))}
            columns={[
              { key: 'id', header: 'Rad', width: pixel(64) },
              ...Array.from({ length: sheet.columns }, (_, i) => ({
                key: String(i),
                header: columnName(i),
                width: pixel(180),
                renderCell: (row: Row) => <Text>{row.cells[i] || '–'}</Text>,
              })),
            ]}
          />
        </>
      )}
    </VStack>
  );
}
