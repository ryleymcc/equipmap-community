import PMSchedulerStudio from './PMSchedulerStudio';

export default function PMSchedulerModal({
  isOpen,
  onClose,
  currentUser,
  onWorkOrderGenerated,
  initialSearch = '',
  initialTask = null,
  initialItem = null,
  initialItemType = null
}) {
  if (!isOpen) return null;

  return (
    <PMSchedulerStudio
      isOpen={isOpen}
      onClose={onClose}
      currentUser={currentUser}
      onWorkOrderGenerated={onWorkOrderGenerated}
      initialSearch={initialSearch}
      initialTask={initialTask}
      initialItem={initialItem}
      initialItemType={initialItemType}
    />
  );
}
