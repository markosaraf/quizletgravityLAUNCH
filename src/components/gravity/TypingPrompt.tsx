import { memo, useEffect, useRef } from 'react';
import { GAME_STATES } from '@/lib/gravity/constants';
import { useDelayedUnmount } from './useDelayedUnmount';

// ══════════════════════════════════════════════════════════════════
// ★ FIX (mobile): device helper — is the primary input a finger?
// ══════════════════════════════════════════════════════════════════
// 'pointer: coarse' = phones / tablets where typing happens on the virtual
// keyboard. On those devices the browser scroll-locks the page to the
// focused typing field while the keyboard is open, so the field must NOT be
// auto-focused — the user taps it when they want to type. Desktops (fine
// pointer) keep the original always-focused behavior.
function isCoarsePointerDevice() {
  if (typeof window === 'undefined') return false;
  try {
    if (window.matchMedia && window.matchMedia('(pointer: coarse)').matches) {
      return true;
    }
  } catch {
    // very old browser without matchMedia — fall through
  }
  return 'ontouchstart' in window;
}

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
  //
  // ★ FIX (mobile): auto-focus is now DESKTOP-ONLY. On phones this effect
  // used to re-fire at every LEVEL_UP → FREE_FALL transition and re-opened
  // the keyboard, which scroll-locked the page back down to the field right
  // as the new asteroid was about to spawn. On mobile the user now taps the
  // field to type instead — the keyboard only opens on purpose.
  useEffect(() => {
    if (isFreeFall && mounted && !isCoarsePointerDevice()) {
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
              the input (without scrolling) once it is mounted — desktop
              only. */}
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
              // ★ FIX (mobile): auto-refocus is now DESKTOP-ONLY.
              // Previously this re-focused the field 0ms after ANY blur,
              // which (a) kept the field permanently focused with the
              // keyboard always open and (b) instantly undid the
              // intentional blur that GravityApp performs on each correct
              // submission — the keyboard re-opened and the browser
              // re-applied its scroll-lock to the field, yanking the page
              // away from the top on EVERY submission (even wrong ones).
              // On mobile the keyboard now STAYS CLOSED after a correct
              // submission until the user taps the field again; desktop
              // keeps the original never-lose-focus behavior.
              if (isFreeFall && !isCoarsePointerDevice()) {
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
