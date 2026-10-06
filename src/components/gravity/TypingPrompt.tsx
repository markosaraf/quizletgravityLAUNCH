import { memo, useEffect, useRef } from 'react';
import { GAME_STATES } from '@/lib/gravity/constants';
import { useDelayedUnmount } from './useDelayedUnmount';
import { SpecialCharBar } from './SpecialCharBar';

/**
 * An "inserter" types a special character into a typing field at its
 * caret. Each field publishes its inserter through a ref (insertRef) and
 * the shared special-character squares route every click to whichever
 * field is currently active (see GameplayView).
 */
type CharInserter = (char: string) => void;

interface Props {
  gameState: string;
  textValue: string;
  placeholderText: string;
  specialChars: string[];
  /** this field publishes its inserter here so the squares can reach it */
  insertRef: { current: CharInserter | null };
  /** called when a special-character square is clicked (already routed
      by GameplayView to the active field) */
  onInsertChar: (char: string) => void;
  onChange: (value: string) => void;
  onSubmit: () => void;
}

function TypingPromptBase({
  gameState,
  textValue,
  placeholderText,
  specialChars,
  insertRef,
  onInsertChar,
  onChange,
  onSubmit,
}: Props) {
  const inputRef = useRef<HTMLTextAreaElement>(null);
  // caret position to restore after a special-char square inserts text
  // (the value is controlled, so the caret must be re-set after the
  // store round-trips the new value back into the textarea)
  const pendingCaretRef = useRef<number | null>(null);
  const isFreeFall = gameState === GAME_STATES.FREE_FALL;
  const isCopyState = gameState === GAME_STATES.COPY_ANSWER;
  // The input itself is only shown while the player is actively typing
  // (original behavior: stays visible through LEVEL_UP).
  const inputShown = isFreeFall || gameState === GAME_STATES.LEVEL_UP;
  // The special-character squares, however, ALWAYS rest in the same place —
  // they stay mounted through COPY_ANSWER (the missed-word flow) instead of
  // jumping to the top with the copy-the-answer field.
  const barShown = inputShown || isCopyState;
  const mounted = useDelayedUnmount(barShown, 400);

  // keep the input focused during gameplay (original behavior).
  // focus({ preventScroll: true }) stops mobile browsers from auto-scrolling
  // the page down to the typing field every time focus is (re-)acquired.
  // Depends on `mounted` so the ref is guaranteed to be attached when the
  // focus timer fires (covers the initial mount after the enter-transition).
  useEffect(() => {
    if (isFreeFall && mounted) {
      const t = setTimeout(
        () => inputRef.current?.focus({ preventScroll: true }),
        0,
      );
      return () => clearTimeout(t);
    }
  }, [isFreeFall, mounted]);

  // restore the caret after a special-character insertion
  useEffect(() => {
    if (pendingCaretRef.current === null) return;
    const pos = pendingCaretRef.current;
    pendingCaretRef.current = null;
    const el = inputRef.current;
    if (el) {
      el.setSelectionRange(pos, pos);
      el.focus({ preventScroll: true });
    }
  }, [textValue]);

  /** insert a special character at the caret (replacing any selection) */
  const insertSpecialChar = (char: string) => {
    const el = inputRef.current;
    if (!el) return;
    const start = el.selectionStart ?? el.value.length;
    const end = el.selectionEnd ?? start;
    pendingCaretRef.current = start + char.length;
    onChange(el.value.slice(0, start) + char + el.value.slice(end));
  };

  // publish this field's inserter (re-registered on every render so the
  // closure never goes stale; cleared again when the field unmounts)
  useEffect(() => {
    insertRef.current = insertSpecialChar;
    return () => {
      insertRef.current = null;
    };
  });

  if (!mounted) return null;

  return (
    <div
      className={`GravityTypingPrompt${inputShown ? ' is-showingInput' : ''}${
        barShown ? ' is-showingBar' : ''
      }${isCopyState ? ' is-copyState' : ''}`}
    >
      <div className="GravityTypingPrompt-inner">
        <div className="GravityTypingPrompt-inputWrapper">
          {/* Special characters that exist in the current set — click to
              insert at the caret of the ACTIVE field. These squares stay
              in this exact spot even while the copy-the-answer view is
              open (the input below hides but keeps occupying its space,
              so nothing here ever moves). */}
          <SpecialCharBar chars={specialChars} onInsert={onInsertChar} />
          {/* no autoFocus: it calls focus() without preventScroll, which
              auto-scrolls to the field on mobile. The effect above focuses
              the input (without scrolling) once it is mounted. */}
          <textarea
            ref={inputRef}
            autoCapitalize="none"
            autoComplete="off"
            autoCorrect="off"
            className="GravityTypingPrompt-input"
            rows={1}
            spellCheck={false}
            value={textValue}
            placeholder={placeholderText}
            onChange={(e) => onChange(e.currentTarget.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                if (textValue !== '' && isFreeFall) onSubmit();
              }
            }}
            onBlur={() => {
              // refocus so gameplay never loses the input (original behavior);
              // preventScroll avoids the mobile auto-scroll-to-input jump.
              // Guarded by isFreeFall, so it never fights the copy field
              // for focus while the copy-the-answer view is open.
              if (isFreeFall) {
                setTimeout(
                  () => inputRef.current?.focus({ preventScroll: true }),
                  0,
                );
              }
            }}
          />
        </div>
      </div>
    </div>
  );
}

export const TypingPrompt = memo(TypingPromptBase);
