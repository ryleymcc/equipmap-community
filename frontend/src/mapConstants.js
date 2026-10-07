export const COLORS = [
  '#10b981', // Emerald
  '#3b82f6', // Blue
  '#ef4444', // Red
  '#f59e0b', // Amber
  '#8b5cf6', // Purple
  '#ec4899', // Pink
  '#64748b'  // Slate
];

export function incrementRoomName(name) {
  const match = name.match(/^(.*?)(\d+)$/);
  if (!match) {
    return name + " 1";
  }
  const prefix = match[1];
  const numberStr = match[2];
  const numberVal = parseInt(numberStr, 10);
  const nextVal = numberVal + 1;
  const paddedNextVal = String(nextVal).padStart(numberStr.length, '0');
  return prefix + paddedNextVal;
}
