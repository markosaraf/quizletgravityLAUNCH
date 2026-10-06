import { memo, useEffect, useRef } from 'react';
import { GAME_STATES } from '@/lib/gravity/constants';
import { useDelayedUnmount } from './useDelayedUnmount';
import { SpecialCharBar } from './SpecialCharBar';

interface Props {
  gameState: string;
  textValue: string;
  placeholderText: string;
  specialChars: string[];
  onChange: (value: string) => void;
  onSubmit: () => void;
}

function TypingPromptBase({
  gameState,
  textValue,
  placeholderText,
  specialChars,
  onChange,
  onSubmit,
}: Props) {
  const inputRef = useRef<HTMLTextAreaElement>(null);
  // caret position to restore after a special-char button inserts text
  // (the value is controlled, so the caret must be re-set after the
  // store round-trips the new value back into the textarea)
  const pendingCaretRef = useRef<number | null>(null);
  const isFreeFall = gameState === GAME_STATES.FREE_FALL;
  // The prompt stays visible through LEVEL_UP (original behavior)
  const wantShown = isFreeFall || gameState === GAME_STATES.LEVEL_UP;
  const mounted = useDelayedUnmount(wantShown, 400);

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

  if (!mounted) return null;

  return (
    <div className={`GravityTypingPrompt${wantShown ? ' is-showingInput' : ''}`}>
      <div className="GravityTypingPrompt-inner">
        <div className="GravityTypingPrompt-inputWrapper">
          {/* Special characters that exist in the current set — click to
              insert at the caret. Only rendered when the set has some. */}
          <SpecialCharBar chars={specialChars} onInsert={insertSpecialChar} />
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
              // preventScroll avoids the mobile auto-scroll-to-input jump
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
