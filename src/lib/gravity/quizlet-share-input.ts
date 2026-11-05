import { normalizeQuizletUrl } from './quizlet-parser';

/** Preserve unsupported input for the server's useful error, but extract valid share links. */
export function quizletPasteValue(text: string): string {
  try { return normalizeQuizletUrl(text).url; }
  catch { return text.replace(/[\r\n]+/g, ' '); }
}
