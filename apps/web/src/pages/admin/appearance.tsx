import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  LOGO_ALT_MAX,
  LOGO_MAX_BYTES,
  LOGO_MEDIA_TYPES,
  THEME_FILE_MAX_BYTES,
  checkThemeContrast,
  isThemeHex,
  parseThemeFile,
  themeFileOf,
  themeFromAccent,
  type AppearanceAdminView,
  type AppearanceLogoInputType,
  type InstallationTheme,
  type LogoMediaType,
  type SessionUser,
  type ThemeProblem,
} from '@clew/contracts';
import {
  Badge,
  Banner,
  Button,
  Card,
  FileInput,
  Grid,
  HStack,
  Heading,
  List,
  ListItem,
  ProgressBar,
  Section,
  SegmentedControl,
  SegmentedControlItem,
  Text,
  TextInput,
  Theme,
  Timestamp,
  Toolbar,
  VStack,
  useAnnounce,
} from '@clew/ui';
import { createClewTheme, createHeaderBandTheme } from '@clew/ui/theme';
import { api } from '../../api';
import { adminQueries } from '../../queries';
import { keys } from '../../query-keys';
import { errorMessage } from '../../query-policy';
import { useAdminAction } from '../../mutations';
import { usePageTitle } from '../../page-title';
import { setBranding } from '../../branding';
import { PageHeader } from '../../components/page-header';
import { AdminShell } from './shell';

/**
 * "Utseende" (D98): the installation's theme and the logo in the header, chosen here and stored in Clew's database.
 * A theme is a file of colours in the Design Tokens format, or two colours this page makes the same kind of theme from;
 * either is read and checked in the browser with the code the server refuses a file with (`parseThemeFile`), shown in
 * both appearances, and saved only when it holds. A save redraws the whole app at once. Only Astryx: the preview is a
 * nested `Theme`, and the logo is seen where it is used, in the header, since Astryx has no general image component.
 */
type Candidate = { theme: InstallationTheme } | { problems: ThemeProblem[] } | null;
type Source = 'file' | 'colors';
const kB = (bytes: number) => Math.round(bytes / 1000);
/** The image's type as the browser reports it, or by its extension where a system reports none for an SVG. */
function logoTypeOf(file: File): LogoMediaType | null {
  if ((LOGO_MEDIA_TYPES as readonly string[]).includes(file.type)) return file.type as LogoMediaType;
  if (file.type) return null;
  return /\.svg$/i.test(file.name) ? 'image/svg+xml' : /\.png$/i.test(file.name) ? 'image/png' : null;
}
async function base64Of(file: File): Promise<string> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}
const one = (value: File | File[] | null) => (Array.isArray(value) ? (value[0] ?? null) : value);

/**
 * The same sample in one appearance: the header's band, then a card with both text colours, a progress bar as the
 * product draws its bars, and the two status colours a theme may set. The band is the nested theme the shell itself
 * uses, so the accent is seen with the text that stands on it. Cards alone: a `Section` here bleeds over the padding
 * of the card the previews stand in.
 */
function Preview({ theme, mode, label }: { theme: InstallationTheme; mode: 'light' | 'dark'; label: string }) {
  const branding = { revision: 0, theme, logo: null };
  return (
    <Theme theme={createClewTheme(branding)} mode={mode}>
      <VStack gap={2}>
        <Theme theme={createHeaderBandTheme(branding)} mode={mode}>
          <Card padding={3}>
            <Text weight="semibold">Sidhuvudet</Text>
          </Card>
        </Theme>
        <Card>
          <VStack gap={3}>
            <Heading level={3}>{label}</Heading>
            <Text>Så här ser löpande text ut på en yta.</Text>
            <Text type="supporting">Stödtext i sekundär färg.</Text>
            <ProgressBar label="Förlopp" value={60} variant="neutral" />
            <HStack gap={2} wrap="wrap">
              <Badge variant="info" label="Information" />
              <Badge variant="success" label="Klart" />
              <Badge variant="neutral" label="Neutral" />
            </HStack>
          </VStack>
        </Card>
      </VStack>
    </Theme>
  );
}

function ThemeCard({ data, onSaved }: { data: AppearanceAdminView; onSaved: (view: AppearanceAdminView) => void }) {
  const announce = useAnnounce();
  const [source, setSource] = useState<Source>('file');
  const [file, setFile] = useState<File | null>(null);
  const [accent, setAccent] = useState('');
  const [muted, setMuted] = useState('');
  const [candidate, setCandidate] = useState<Candidate>(null);
  const action = useAdminAction({ invalidate: [keys.admin.appearance], toastId: 'appearance:theme' });
  const offer = (next: Candidate) => {
    setCandidate(next);
    action.reset();
    if (next && 'problems' in next)
      announce(`Temat kan inte användas. ${next.problems.length} fel hittades.`, 'assertive');
    else if (next) announce('Temat håller. Förhandsvisningen visas.');
  };
  const choose = async (value: File | File[] | null) => {
    const chosen = one(value);
    setFile(chosen);
    if (!chosen) return offer(null);
    let parsed: unknown;
    try {
      parsed = JSON.parse(await chosen.text());
    } catch {
      return offer({ problems: [{ code: 'format', message: 'Filen är inte giltig JSON.' }] });
    }
    const result = parseThemeFile(parsed);
    offer(result.ok ? { theme: result.theme } : { problems: result.problems });
  };
  const colorsReady = isThemeHex(accent) && isThemeHex(muted);
  const fromColors = () => {
    const theme = themeFromAccent(accent, muted, 'Egna färger');
    const problems = checkThemeContrast(theme.colors);
    offer(problems.length ? { problems } : { theme });
  };
  const hexStatus = (value: string) =>
    value.trim() && !isThemeHex(value)
      ? ({ type: 'error', message: 'Skriv färgen som sex hexadecimala siffror, till exempel #005595.' } as const)
      : undefined;
  const ready = candidate && 'theme' in candidate ? candidate.theme : null;
  // The field says what became of the file it holds: a chosen file is never left as a bare name.
  const fileStatus = !file
    ? undefined
    : ready
      ? ({
          type: 'success',
          message: `Temat håller: ${ready.name ?? 'Eget tema'}, ${Object.keys(ready.colors).length} färger.`,
        } as const)
      : candidate
        ? ({ type: 'error', message: 'Temat kan inte användas. Felen står under fältet.' } as const)
        : undefined;
  const save = () =>
    ready &&
    action.run(async () => {
      onSaved(await api.admin.setTheme(themeFileOf(ready)));
      setFile(null);
      setCandidate(null);
      return 'Temat är sparat och gäller nu för alla.';
    });
  const reset = () =>
    action.run(async () => {
      onSaved(await api.admin.clearTheme());
      return 'Temat är återställt till Neutral.';
    });
  return (
    <Card padding={0}>
      <Toolbar
        label="Tema"
        size="sm"
        dividers={['bottom']}
        startContent={
          <VStack gap={0}>
            <Text weight="semibold">Tema</Text>
            <Text type="supporting">
              Färgerna som hela Clew ritas i, för alla som använder installationen. Typsnitt, storlekar och färgerna för
              varning och fel är alltid Clews egna.
            </Text>
          </VStack>
        }
      />
      <Section variant="transparent" padding={4}>
        <VStack gap={4}>
          <Text>
            {data.theme
              ? `Nuvarande tema: ${data.theme.name ?? 'Eget tema'}, ${Object.keys(data.theme.colors).length} färger.`
              : 'Nuvarande tema: Neutral, Clews standardtema.'}
          </Text>
          <SegmentedControl
            label="Så anges temat"
            value={source}
            onChange={v => {
              setSource(v as Source);
              offer(null);
              setFile(null);
            }}
          >
            <SegmentedControlItem value="file" label="Temafil" />
            <SegmentedControlItem value="colors" label="Två färger" />
          </SegmentedControl>
          {source === 'file' ? (
            <FileInput
              label="Temafil"
              value={file}
              onChange={v => void choose(v)}
              accept=".json,.tokens,application/json"
              maxSize={THEME_FILE_MAX_BYTES}
              placeholder="Välj en temafil"
              status={fileStatus}
              description={`En fil i Design Tokens-format (.tokens.json) med grupperna light.color och dark.color. Högst ${kB(THEME_FILE_MAX_BYTES)} kB. Hämta mallen nedan för att se vilka färger som kan sättas.`}
            />
          ) : (
            <VStack gap={3}>
              <Grid columns={{ minWidth: 280, max: 2 }} gap={3}>
                <TextInput
                  label="Stark färg"
                  value={accent}
                  onChange={setAccent}
                  description="Kommunens huvudfärg, till exempel #005595. Vit text ska gå att läsa på den."
                  placeholder="#005595"
                  autoComplete="off"
                  hasAutoCorrect={false}
                  autoCapitalize="none"
                  status={hexStatus(accent)}
                />
                <TextInput
                  label="Ljus färg"
                  value={muted}
                  onChange={setMuted}
                  description="En ljus ton av samma färg, till exempel #daeff1. Den bär accenten i mörkt läge."
                  placeholder="#daeff1"
                  autoComplete="off"
                  hasAutoCorrect={false}
                  autoCapitalize="none"
                  status={hexStatus(muted)}
                />
              </Grid>
              <HStack>
                <Button
                  variant="secondary"
                  label="Förhandsvisa"
                  onClick={fromColors}
                  isDisabled={!colorsReady}
                  tooltip={colorsReady ? undefined : 'Skriv båda färgerna först.'}
                />
              </HStack>
            </VStack>
          )}
          {candidate && 'problems' in candidate && (
            <Banner
              status="error"
              container="card"
              collapsible={false}
              title="Temat kan inte användas"
              description="Rätta det som står nedan och välj temat igen. Inget har sparats."
            >
              <List aria-label="Fel i temat" hasDividers>
                {candidate.problems.map((p, i) => (
                  <ListItem key={i} label={p.message} />
                ))}
              </List>
            </Banner>
          )}
          {ready && (
            <VStack gap={2}>
              <Heading level={2}>Förhandsvisning</Heading>
              <Grid columns={{ minWidth: 280, max: 2 }} gap={3}>
                <Preview theme={ready} mode="light" label="Ljust läge" />
                <Preview theme={ready} mode="dark" label="Mörkt läge" />
              </Grid>
            </VStack>
          )}
          {action.error && <Banner status="error" container="card" collapsible={false} title={action.error} />}
          <HStack gap={2} wrap="wrap">
            <Button
              label="Använd temat"
              onClick={() => void save()}
              isDisabled={!ready}
              tooltip={ready ? undefined : 'Välj en temafil eller två färger som håller först.'}
              isLoading={action.busy}
            />
            <Button
              variant="secondary"
              label={data.theme ? 'Hämta nuvarande temafil' : 'Hämta mall för temafil'}
              href="/api/appearance/theme-file"
            />
            {data.theme && <Button variant="secondary" label="Återställ till Neutral" onClick={() => void reset()} />}
          </HStack>
        </VStack>
      </Section>
    </Card>
  );
}

function LogoCard({ data, onSaved }: { data: AppearanceAdminView; onSaved: (view: AppearanceAdminView) => void }) {
  const [light, setLight] = useState<File | null>(null);
  const [dark, setDark] = useState<File | null>(null);
  const [alt, setAlt] = useState(data.logo?.alt ?? '');
  const action = useAdminAction({ invalidate: [keys.admin.appearance], toastId: 'appearance:logo' });
  // As on the theme field: a chosen image is answered, with what it is and that it is not saved yet.
  const typeStatus = (file: File | null) => {
    if (!file) return undefined;
    const type = logoTypeOf(file);
    if (!type) return { type: 'error', message: 'Bilden ska vara PNG eller SVG.' } as const;
    const size = `${type === 'image/png' ? 'PNG' : 'SVG'}, ${Math.max(1, kB(file.size))} kB`;
    return { type: 'success', message: `${size}. Sparas när du väljer Spara logotypen.` } as const;
  };
  const image = async (file: File) => ({ mediaType: logoTypeOf(file)!, data: await base64Of(file) });
  const valid = (!light || logoTypeOf(light) !== null) && (!dark || logoTypeOf(dark) !== null);
  const ready =
    valid && alt.trim().length > 0 && alt.trim().length <= LOGO_ALT_MAX && (light !== null || data.logo !== null);
  const save = () =>
    action.run(async () => {
      const input: AppearanceLogoInputType = {
        alt: alt.trim(),
        ...(light ? { light: await image(light) } : {}),
        ...(dark ? { dark: await image(dark) } : {}),
      };
      onSaved(await api.admin.setLogo(input));
      setLight(null);
      setDark(null);
      return 'Logotypen är sparad och visas nu i sidhuvudet.';
    });
  const remove = () =>
    action.run(async () => {
      onSaved(await api.admin.clearLogo());
      setAlt('');
      return 'Logotypen är borttagen.';
    });
  const removeDark = () =>
    data.logo &&
    action.run(async () => {
      onSaved(await api.admin.setLogo({ alt: data.logo!.alt, dark: null }));
      return 'Varianten för mörkt läge är borttagen.';
    });
  const description = `PNG eller SVG, högst ${kB(LOGO_MAX_BYTES)} kB. Använd originalfilen från den grafiska profilen.`;
  return (
    <Card padding={0}>
      <Toolbar
        label="Logotyp"
        size="sm"
        dividers={['bottom']}
        startContent={
          <VStack gap={0}>
            <Text weight="semibold">Logotyp</Text>
            <Text type="supporting">
              Visas i sidhuvudet på varje sida, även på inloggningssidan. Ger ett anslutet system sidhuvudet en egen
              logotyp visas den i stället.
            </Text>
          </VStack>
        }
      />
      <Section variant="transparent" padding={4}>
        <VStack gap={4}>
          <Text>
            {data.logo
              ? `Nuvarande logotyp: ${data.logo.alt}${data.logo.darkSrc ? ', med en variant för mörkt läge' : ''}.`
              : 'Ingen logotyp är vald.'}
          </Text>
          <Grid columns={{ minWidth: 280, max: 2 }} gap={3}>
            <FileInput
              label="Logotyp"
              value={light}
              onChange={v => setLight(one(v))}
              accept=".png,.svg,image/png,image/svg+xml"
              maxSize={LOGO_MAX_BYTES}
              placeholder="Välj en bild"
              description={description}
              isRequired={!data.logo}
              status={typeStatus(light)}
            />
            <FileInput
              label="Logotyp för mörkt läge"
              value={dark}
              onChange={v => setDark(one(v))}
              accept=".png,.svg,image/png,image/svg+xml"
              maxSize={LOGO_MAX_BYTES}
              placeholder="Välj en bild"
              description="En ljus variant som syns mot mörk bakgrund. Utan den visas logotypen på en ljus platta i mörkt läge."
              isOptional
              status={typeStatus(dark)}
            />
          </Grid>
          <TextInput
            label="Logotypens namn"
            value={alt}
            onChange={setAlt}
            description="Läses upp av skärmläsare i stället för bilden, till exempel kommunens namn."
            isRequired
            status={
              alt.trim().length > LOGO_ALT_MAX
                ? { type: 'error', message: `Namnet får vara högst ${LOGO_ALT_MAX} tecken.` }
                : undefined
            }
          />
          {action.error && <Banner status="error" container="card" collapsible={false} title={action.error} />}
          <HStack gap={2} wrap="wrap">
            <Button
              label="Spara logotypen"
              onClick={() => void save()}
              isDisabled={!ready}
              tooltip={ready ? undefined : 'Välj en bild i PNG eller SVG och ge logotypen ett namn först.'}
              isLoading={action.busy}
            />
            {data.logo?.darkSrc && (
              <Button variant="secondary" label="Ta bort varianten för mörkt läge" onClick={() => void removeDark()} />
            )}
            {data.logo && <Button variant="secondary" label="Ta bort logotypen" onClick={() => void remove()} />}
          </HStack>
        </VStack>
      </Section>
    </Card>
  );
}

export function AdminAppearancePage({ user }: { user: SessionUser }) {
  const client = useQueryClient();
  const query = useQuery(adminQueries.appearance);
  usePageTitle('Utseende');
  const data = query.data;
  const error = query.isError && !data ? errorMessage(query.error, 'Utseendet kunde inte läsas.') : null;
  // A save is drawn at once: the page's own copy, and the theme and logo of the whole app.
  const onSaved = (view: AppearanceAdminView) => {
    client.setQueryData(keys.admin.appearance, view);
    setBranding(view);
  };
  return (
    <AdminShell user={user} section="utseende" crumbs={[{ label: 'Utseende' }]} pending={query.isPending}>
      <PageHeader
        title="Utseende"
        meta={
          <Text type="supporting">
            Temat och logotypen gäller hela installationen och ändras direkt, utan omstart.
            {data?.updatedAt && data.updatedBy ? (
              <>
                {' '}
                Senast ändrat av {data.updatedBy} <Timestamp value={data.updatedAt} format="date_time" />.
              </>
            ) : null}
          </Text>
        }
      />
      {error && (
        <Text as="p" role="alert" color="accent">
          {error}
        </Text>
      )}
      {data && <ThemeCard data={data} onSaved={onSaved} />}
      {data && <LogoCard key={data.logo?.alt ?? ''} data={data} onSaved={onSaved} />}
    </AdminShell>
  );
}
