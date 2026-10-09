import { useEffect, useRef } from 'react';

// Shared by work-order details and completion, including nested dialogs.
export default function useDialogFocus(dialogRef, active = true) {
  const openerRef = useRef(null);

  useEffect(() => {
    openerRef.current = document.activeElement;
    return () => {
      if (openerRef.current instanceof HTMLElement && openerRef.current.isConnected) {
        openerRef.current.focus();
      }
    };
  }, []);

  useEffect(() => {
    if (!active) return;
    const focusable = () => Array.from(dialogRef.current?.querySelectorAll(
      'button, input, textarea, select, a[href], [tabindex]'
    ) || []).filter(element => !element.disabled && element.tabIndex >= 0 && element.getClientRects().length);
    const timer = window.setTimeout(() => (focusable()[0] || dialogRef.current)?.focus(), 0);
    const handleTab = event => {
      if (event.key !== 'Tab') return;
      const controls = focusable();
      const first = controls[0];
      const last = controls[controls.length - 1];
      if (!first) {
        event.preventDefault();
        dialogRef.current?.focus();
      } else if (!dialogRef.current?.contains(document.activeElement) ||
        (event.shiftKey && document.activeElement === first) ||
        (!event.shiftKey && document.activeElement === last)) {
        event.preventDefault();
        (event.shiftKey ? last : first).focus();
      }
    };
    document.addEventListener('keydown', handleTab);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener('keydown', handleTab);
    };
  }, [active, dialogRef]);
}
