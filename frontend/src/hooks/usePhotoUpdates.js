import { useEffect } from 'react';

// Keep mounted table/map data consistent with edits made in the photo panel.
export function usePhotoUpdates(setRooms, setEquipment) {
  useEffect(() => {
    const changed = ({ detail: { kind, item } }) => {
      const setItems = kind === 'rooms' ? setRooms : setEquipment;
      setItems(items => items.map(existing => existing.id === item.id ? { ...existing, ...item } : existing));
    };
    window.addEventListener('entity-photo-updated', changed);
    return () => window.removeEventListener('entity-photo-updated', changed);
  }, [setRooms, setEquipment]);
}
