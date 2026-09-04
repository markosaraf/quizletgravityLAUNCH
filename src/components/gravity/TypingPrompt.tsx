import { memo, useEffect, useRef } from 'react';
import { GAME_STATES } from '@/lib/gravity/constants';
import { useDelayedUnmount } from './useDelayedUnmount';

interface Props {
  gameState: string;
  textValue: string;
  placeholderText: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
}

function TypingPromptBase({
  gameState,
  textValue,
  placeholderText,
  onChange,
  onSubmit,
}: Props) {
  const inputRef = useRef<HTMLTextAreaElement>(null);
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

  if (!mounted) return null;

  return (
    <div className={`GravityTypingPrompt${wantShown ? ' is-showingInput' : ''}`}>
      <div className="GravityTypingPrompt-inner">
        <div className="GravityTypingPrompt-inputWrapper">
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
