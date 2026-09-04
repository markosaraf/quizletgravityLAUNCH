'use client';

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { GAME_STATES } from '@/lib/gravity/constants';
import { gravityStore } from '@/lib/gravity/store';
import type { GameData, GravitySet, GravityTerm } from '@/lib/gravity/types';
import { getStoredPartialAnswer } from '@/lib/gravity/parse';
import { GameplayView, useGameplaySize } from './GameplayView';
import { ModeControls, SiteHeader } from './ModeControls';
import { StartView, GameOverView, type LeaderboardEntry } from './StartScreens';
import { ImportScreen } from './ImportScreen';

// ══════════════════════════════════════════════════════════════════
// ★ FIX (mobile): helper — jump to the ABSOLUTE top and PIN there
// ══════════════════════════════════════════════════════════════════
// The pin re-asserts scrollTop = 0 on every animation frame for ~1.5s,
// which outlasts the browser's keyboard-open/close scroll adjustments AND
// covers the moment the next asteroid spawns (~1s after a correct answer).
// Any touch / click / wheel / key press cancels the pin INSTANTLY, so
// scrolling down to the typing field — or just typing the next answer —
// works exactly as before (never fights the user's finger).
const TOP_PIN_MS = 1500;

function jumpToTopAndPin() {
  // window is the page scroller; the extra scrollTop resets cover older
  // mobile Safari versions where <html>/<body> track their own position.
  const forceTop = () => {
    window.scrollTo(0, 0);
    document.documentElement.scrollTop = 0;
    document.body.scrollTop = 0;
  };
  forceTop();

  // ANY direct user input cancels the pin — never fight the user's finger.
  // (touch/pointer/wheel = they are scrolling down to the typing field;
  // keydown = they are typing the next answer.)
  let cancelled = false;
  const events = [
    'touchstart',
    'pointerdown',
    'mousedown',
    'wheel',
    'keydown',
  ] as const;
  const cancel = () => {
    cancelled = true;
    for (const ev of events) window.removeEventListener(ev, cancel);
  };
  for (const ev of events) {
    window.addEventListener(ev, cancel, { once: true, passive: true });
  }

  // Re-assert top on every animation frame for TOP_PIN_MS. Mobile browsers
  // revert programmatic scrolls asynchronously (keyboard resize, caret
  // scroll-into-view), so a single scrollTo call is not enough — every
  // attempted scroll-away during the pin gets an instant jump back to 0.
  const startedAt = performance.now();
  const pin = () => {
    if (cancelled) return;
    if (performance.now() - startedAt >= TOP_PIN_MS) {
      for (const ev of events) window.removeEventListener(ev, cancel);
      return;
    }
    if (
      window.scrollY !== 0 ||
      document.documentElement.scrollTop !== 0 ||
      document.body.scrollTop !== 0
    ) {
      forceTop();
    }
    requestAnimationFrame(pin);
  };
  requestAnimationFrame(pin);
}

// ══════════════════════════════════════════════════════════════════
// ★ FIX (mobile): device helper — is the primary input a finger?
// ══════════════════════════════════════════════════════════════════
// 'pointer: coarse' = phones / tablets where typing happens on the virtual
// keyboard. Those are exactly the browsers that scroll-lock the page to the
// focused typing field while the keyboard is open. Desktops (fine pointer)
// keep the old always-focused behavior.
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

export function GravityApp() {
  const [started, setStarted] = useState(false);
  const gameplayRef = useRef<HTMLDivElement>(null);
  const size = useGameplaySize(gameplayRef, started);
  const data = useSyncExternalStore(
    gravityStore.subscribe,
    gravityStore.getSnapshot,
    () => null as unknown as GameData,
  );

  // ---- session leaderboard (in-memory only; not persisted across devices) ----
  // Each entry = one completed game. tryIndex is the 0-based chronological
  // index of the try; we use it to highlight the just-finished try on the
  // leaderboard.
  const [leaderboard, setLeaderboard] = useState<LeaderboardEntry[]>([]);
  const [currentTryIndex, setCurrentTryIndex] = useState(-1);
  // Dedup key — tracks the last GAME_OVER we recorded so we don't double-count
  // when the store fires multiple change() calls during the GAME_OVER state.
  // State (not a ref) so the "adjust state during render" pattern is lint-clean.
  const [lastRecordedKey, setLastRecordedKey] = useState<string | null>(null);

  // Record the score when a game ends. Uses the "adjust state during render"
  // pattern (see React docs:
  // https://react.dev/learn/you-might-not-need-an-effect#adjusting-some-state-when-a-prop-changes)
  // instead of an effect+setState, to satisfy the set-state-in-effect rule.
  const currentKey =
    data && data.gameState === GAME_STATES.GAME_OVER
      ? `${data.gameState}:${data.points}:${data.level}`
      : null;
  if (currentKey !== lastRecordedKey) {
    setLastRecordedKey(currentKey);
    if (currentKey !== null && data) {
      const tryIndex = leaderboard.length;
      setLeaderboard([
        ...leaderboard,
        { tryIndex, points: data.points, level: data.level },
      ]);
      setCurrentTryIndex(tryIndex);
    }
  }

  const handleStartSet = useCallback((set: GravitySet, terms: GravityTerm[]) => {
    gravityStore.setup({
      set,
      terms,
      acceptsPartialAnswer: getStoredPartialAnswer(),
    });
    setStarted(true);
    // reset the session leaderboard when a brand-new set is loaded
    setLeaderboard([]);
    setCurrentTryIndex(-1);
    setLastRecordedKey(null);
  }, []);

  // keyboard: ESC skips the first live term (keymaster GAMEPLAY scope)
  useEffect(() => {
    if (!started || !data) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      const target = e.target as HTMLElement | null;
      const inInput = target && ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName);
      if (data.gameState === GAME_STATES.FREE_FALL) {
        e.preventDefault();
        const firstLive = Object.keys(data.liveTerms)[0];
        if (firstLive) gravityStore.missTerm(firstLive, true);
      } else if (data.gameState === GAME_STATES.COPY_ANSWER && !inInput) {
        // nothing — copy modal is modal
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [started, data]);

  // ══════════════════════════════════════════════════════════════════
  // ★ FIX (mobile): scroll to the ABSOLUTE top on each score increase
  // ══════════════════════════════════════════════════════════════════
  // This effect watches the score: every time it INCREASES — i.e. a correct
  // word was submitted (wrong answers only subtract points:
  // INCORRECT_POINTS = -10 in constants.ts) — the page jumps to the top and
  // is PINNED there for ~1.5s via jumpToTopAndPin() above, so the newly
  // spawned asteroid is visible.
  //
  // ★ THE MISSING PIECE: releasing the typing field BEFORE the jump. While
  // the textarea is focused with the keyboard open, mobile browsers
  // scroll-lock the page to that field — they re-assert "scroll the focused
  // element into view" after every scroll we make (this is why the page
  // used to pin to the typing field on EVERY submission, correct or not).
  // Blurring the field closes the keyboard and removes the scroll-lock, so
  // the jump + pin finally wins and HOLDS the top. On mobile the user taps
  // the field again when they want to type (keyboard opens and scrolls to
  // it, as before). Desktop keeps focus so continuous typing still works.
  const prevPointsRef = useRef<number | null>(null);
  useEffect(() => {
    if (!started || !data) {
      // back on the import screen / new set — reset the tracker so the
      // next game starts clean (points reset to 0 on setup)
      prevPointsRef.current = null;
      return;
    }
    const prev = prevPointsRef.current;
    prevPointsRef.current = data.points;
    if (prev !== null && data.points > prev) {
      // ★ mobile: RELEASE the typing field first (keyboard closes,
      // scroll-lock released), THEN jump + pin to the absolute top.
      if (isCoarsePointerDevice()) {
        const active = document.activeElement as HTMLElement | null;
        if (active && active.tagName === 'TEXTAREA') active.blur();
      }
      jumpToTopAndPin();
    }
  }, [started, data]);

  const handleNewSet = useCallback(() => {
    gravityStore.dispose();
    setStarted(false);
    setLeaderboard([]);
    setCurrentTryIndex(-1);
    setLastRecordedKey(null);
  }, []);

  if (!started || !data) {
    return <ImportScreen onStart={handleStartSet} />;
  }

  // No screen-size/device blockers — the game is playable everywhere
  // (mobile layout in the top bar handles narrow widths).
  return (
    <div className="gravity-root">
      <SiteHeader
        title={data.set.title}
        points={data.points}
        level={data.level}
        gameState={data.gameState}
        showMobileControls
        onPause={() => gravityStore.pauseGame()}
        onResume={() => gravityStore.resumeGame()}
        onRestart={() => gravityStore.restartGame()}
        onNewSet={handleNewSet}
      />
      <div className="GravityModeLayout">
        <div className="GravityModeLayout-body">
          <ModeControls
            gameState={data.gameState}
            points={data.points}
            level={data.level}
            setPathLabel={data.set.title}
            onPause={() => gravityStore.pauseGame()}
            onResume={() => gravityStore.resumeGame()}
            onRestart={() => gravityStore.restartGame()}
            onNewSet={handleNewSet}
          />
          <div
            className="GravityModeLayout-main"
            ref={gameplayRef}
          >
            <GameplayView
              data={data}
              onMissed={(id) => gravityStore.missTerm(id, false)}
              onType={(v) => gravityStore.updateMainTypingPromptValue(v)}
              onGrade={() => gravityStore.gradeAnswer()}
              onCopyAnswer={(id, answer) => gravityStore.checkCopiedAnswer(id, answer)}
              onPlanetLoaded={(level) => gravityStore.markPlanetLoaded(level)}
              windowWidth={size.w || 800}
              windowHeight={size.h || 600}
            />

            {[
              GAME_STATES.INTRO,
              GAME_STATES.DIRECTIONS,
              GAME_STATES.OPTIONS,
              GAME_STATES.LOADING,
              GAME_STATES.ERROR_NO_AVAILABLE_TERMS,
            ].includes(data.gameState as never) ? (
              <StartView
                data={data}
                onStart={() => gravityStore.startGame()}
                onOptions={() => gravityStore.displayGameOptions()}
                onDirections={() => gravityStore.displayGameDirections()}
                onDifficultyChange={(d) => gravityStore.changeDifficultyLevel(d)}
                onSideChange={(s) => gravityStore.changeShowingSide(s)}
                onPartialChange={(b) => gravityStore.updateAlternateAnswerOption(b)}
                onSelectedOnlyChange={(b) => gravityStore.changeSelectedOnly(b)}
              />
            ) : null}

            {data.gameState === GAME_STATES.GAME_OVER ? (
              <GameOverView
                points={data.points}
                level={data.level}
                leaderboard={leaderboard}
                currentTryIndex={currentTryIndex}
                onRestart={() => gravityStore.restartGame()}
                onNewSet={handleNewSet}
              />
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}
