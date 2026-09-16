/** The slice of an <input> the symbol field rewrites. */
export type SymbolField = { value: string; selectionStart: number | null; selectionEnd: number | null; setSelectionRange(start: number, end: number): void };

/**
 * Uppercase the field in place and return the new value for state.
 *
 * The DOM is written before React sees the change, so the controlled value already matches and React leaves the caret
 * alone. Restoring it later (an animation frame) races fast typing: a second keystroke lands at the end first.
 */
export function uppercaseInPlace(el: SymbolField): string {
  const { value, selectionStart, selectionEnd } = el;
  const upper = value.toUpperCase();
  if (upper === value) return value;
  el.value = upper;
  // Offsets are stale when uppercasing changes the length (ß → SS); the browser's end-of-text caret is right then.
  if (upper.length === value.length && selectionStart !== null && selectionEnd !== null) el.setSelectionRange(selectionStart, selectionEnd);
  return upper;
}
