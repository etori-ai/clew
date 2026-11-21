import { Dialog, DialogHeader } from '@clew/ui';
import { DialogFrame } from '../shell/dialog-frame';
import { BookingButtons, BookingFields, BookingHint, type Booking } from './booking';

/**
 * "Ny bokning" on a phone (D32, after startsidan's meeting form): the same form the pane beside the grid holds
 * (`booking.tsx`), in a full-screen dialog, since a phone has no room for a pane beside its list. The page keeps the
 * draft (`useBooking`); this only draws it. Modelled on Astryx's form-wizard-dialog: a form dialog that keeps its
 * content when clicked outside.
 */
export function BookingDialog({ booking, isOpen }: { booking: Booking; isOpen: boolean }) {
  const close = (open: boolean) => {
    if (!open) booking.close();
  };
  return (
    <Dialog isOpen={isOpen} onOpenChange={close} width={560} purpose="form" variant="fullscreen">
      <DialogFrame
        header={
          <DialogHeader
            title="Ny bokning"
            subtitle="I din kalender, med inbjudan till dem du väljer."
            onOpenChange={close}
          />
        }
        error={booking.error && !booking.error.uncertain ? booking.error.text : null}
        secondary={isOpen && <BookingHint booking={booking} />}
        primary={isOpen && <BookingButtons booking={booking} />}
      >
        {/* Only the frame stays while the dialog is closed (it names the dialog): the form is the pane's then. */}
        {isOpen && <BookingFields booking={booking} />}
      </DialogFrame>
    </Dialog>
  );
}
