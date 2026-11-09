import { useCallback, useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate, useSearchParams } from 'react-router';
import {
  BottomSheet,
  Drawer,
  DrawerHeader,
  Heading,
  HStack,
  Icon,
  IconButton,
  Layout,
  LayoutContent,
  LayoutHeader,
  StackItem,
  useMediaQuery,
} from '@clew/ui';
import { mobileQuery, shortQuery } from '../../components/shell';
import { servicesOpen, withoutServices } from '../../service-address';
import { ServiceCatalogue } from './service-catalogue';
import ServiceOverlay from './service-overlay';

/** Sibling overlays: catalogue → selected service → its human confirmation. Astryx owns stacking and focus. */
export default function ServiceOverlays() {
  return (
    <>
      <CatalogueOverlay />
      <ServiceOverlay />
    </>
  );
}

function CatalogueOverlay() {
  const location = useLocation();
  const navigate = useNavigate();
  const [search] = useSearchParams();
  const isOpen = servicesOpen(search);
  const [held, setHeld] = useState(false);
  if (isOpen && !held) setHeld(true);
  const openRef = useRef(isOpen);
  openRef.current = isOpen;
  const [dialog, setDialog] = useState<HTMLDialogElement | null>(null);
  const sheetPanel = useCallback((panel: HTMLDivElement | null) => setDialog(panel?.closest('dialog') ?? null), []);
  useEffect(() => {
    if (!dialog) return;
    const closed = () => {
      if (!openRef.current) setHeld(false);
    };
    dialog.addEventListener('close', closed);
    return () => dialog.removeEventListener('close', closed);
  }, [dialog]);
  const mobile = useMediaQuery(mobileQuery);
  const short = useMediaQuery(shortQuery);
  const title = 'Tjänster i samtalet';
  const onOpenChange = (open: boolean) => {
    if (!open) navigate(withoutServices(location.pathname, search), { replace: true });
  };
  const body = held ? (
    <Layout
      height={short ? 'auto' : 'fill'}
      header={
        mobile ? (
          <LayoutHeader>
            <HStack justify="between" vAlign="center" gap={2}>
              <StackItem size="fill">
                <Heading level={2}>{title}</Heading>
              </StackItem>
              <IconButton
                label="Stäng"
                variant="ghost"
                icon={<Icon icon="close" />}
                onClick={() => onOpenChange(false)}
              />
            </HStack>
          </LayoutHeader>
        ) : (
          <DrawerHeader title={title} onOpenChange={onOpenChange} />
        )
      }
      content={
        <LayoutContent>
          <ServiceCatalogue isOpen={isOpen} />
        </LayoutContent>
      }
    />
  ) : null;
  return mobile ? (
    <BottomSheet ref={sheetPanel} isOpen={isOpen} onOpenChange={onOpenChange} label={title} height="tall">
      {body}
    </BottomSheet>
  ) : (
    <Drawer ref={setDialog} isOpen={isOpen} onOpenChange={onOpenChange} label={title} side="end" width={800}>
      {body}
    </Drawer>
  );
}
