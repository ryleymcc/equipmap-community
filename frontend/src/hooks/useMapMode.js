import { useState, useCallback } from 'react';

export function useMapMode() {
  const [mapMode, setMapMode] = useState({ type: 'view' });

  // Getters for compatibility
  const editMode = mapMode.type === 'add-placement' || mapMode.type === 'add-form';
  const activeActionType = (mapMode.type === 'add-placement' || mapMode.type === 'add-form') ? mapMode.activeActionType : null;
  const newPinCoord = mapMode.type === 'add-form' ? mapMode.newPinCoord : null;
  const editingRoom = (mapMode.type === 'edit' || mapMode.type === 'relocate') && mapMode.itemType === 'room' ? mapMode.item : null;
  const editingEquipment = (mapMode.type === 'edit' || mapMode.type === 'relocate') && mapMode.itemType === 'equipment' ? mapMode.item : null;
  const editingTicket = (mapMode.type === 'edit' || mapMode.type === 'relocate') && mapMode.itemType === 'ticket' ? mapMode.item : null;
  const isRelocating = mapMode.type === 'relocate';

  const setModeView = useCallback(() => {
    setMapMode({ type: 'view' });
  }, []);

  const setModeAddPlacement = useCallback((activeActionType) => {
    setMapMode({ type: 'add-placement', activeActionType });
  }, []);

  const setModeAddForm = useCallback((activeActionType, newPinCoord) => {
    setMapMode({ type: 'add-form', activeActionType, newPinCoord });
  }, []);

  const setModeEdit = useCallback((itemType, item) => {
    setMapMode({ type: 'edit', itemType, item });
  }, []);

  const setModeRelocate = useCallback((itemType, item) => {
    setMapMode({ type: 'relocate', itemType, item });
  }, []);

  return {
    mapMode,
    setMapMode,
    editMode,
    activeActionType,
    newPinCoord,
    editingRoom,
    editingEquipment,
    editingTicket,
    isRelocating,
    setModeView,
    setModeAddPlacement,
    setModeAddForm,
    setModeEdit,
    setModeRelocate
  };
}
