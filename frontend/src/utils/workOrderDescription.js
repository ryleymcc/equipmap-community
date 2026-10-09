const normalizeText = (value) => String(value ?? '')
  .replace(/\s+/g, ' ')
  .trim()
  .toLowerCase();

/**
 * Removes an imported work-order title only when it is the first standalone
 * description line. This keeps real instructions intact while hiding the
 * duplicated title from the instructions/scope field.
 */
export function stripRepeatedWorkOrderTitle(title, description) {
  if (typeof description !== 'string') return description ?? '';

  const normalizedTitle = normalizeText(title);
  if (!normalizedTitle) return description;

  const lines = description.replace(/\r\n?/g, '\n').split('\n');
  const firstContentIndex = lines.findIndex((line) => line.trim());

  if (
    firstContentIndex === -1
    || normalizeText(lines[firstContentIndex]) !== normalizedTitle
  ) {
    return description;
  }

  return lines
    .slice(firstContentIndex + 1)
    .join('\n')
    .replace(/^\n+/, '')
    .trimEnd();
}
