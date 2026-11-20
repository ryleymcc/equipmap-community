import { useEffect, useId, useRef, useState } from 'react';
import { Eye, EyeOff, MapPinOff } from 'lucide-react';
import './PinVisibility.css';

const MODES = [
  { value: 'off', label: 'No pins', Icon: MapPinOff },
  { value: 'pins', label: 'Pins only', Icon: EyeOff },
  { value: 'names', label: 'Pins + names', Icon: Eye },
];

export default function PinVisibility({ value, onChange }) {
  const [open, setOpen] = useState(false);
  const picker = useRef(null);
  const trigger = useRef(null);
  const selected = useRef(null);
  const restoreFocus = useRef(false);
  const optionsId = useId();
  const { label, Icon } = MODES.find(mode => mode.value === value);

  useEffect(() => {
    if (!open) {
      if (restoreFocus.current) trigger.current?.focus({ preventScroll: true });
      restoreFocus.current = false;
      return;
    }
    selected.current?.focus({ preventScroll: true });
    const dismiss = event => {
      if (!picker.current?.contains(event.target)) setOpen(false);
    };
    document.addEventListener('pointerdown', dismiss);
    return () => document.removeEventListener('pointerdown', dismiss);
  }, [open]);

  const close = () => {
    restoreFocus.current = true;
    setOpen(false);
  };

  return (
    <div ref={picker} className="trigger-btn map-pin-visibility" data-open={open} data-mode={value}
      onBlur={event => {
        if (event.relatedTarget && !event.currentTarget.contains(event.relatedTarget)) setOpen(false);
      }}
      onKeyDown={event => {
        if (open && event.key === 'Escape') {
          event.preventDefault();
          close();
        }
      }}>
      <button ref={trigger} className="map-pin-visibility-trigger" type="button" inert={open}
        aria-expanded={open} aria-controls={optionsId} aria-label={`Pin visibility: ${label}`}
        title={`Pin visibility: ${label}`} onClick={() => setOpen(true)}>
        <Icon size={20} aria-hidden="true" />
      </button>
      <div className="map-pin-visibility-options" id={optionsId} role="group" aria-label="Pin visibility options" inert={!open}>
        <span className="map-pin-visibility-selection" aria-hidden="true" />
        {MODES.map(mode => (
          <button key={mode.value} ref={mode.value === value ? selected : null} type="button"
            aria-pressed={mode.value === value} onClick={() => {
              onChange(mode.value);
              close();
            }}>
            {mode.label}
          </button>
        ))}
      </div>
    </div>
  );
}
