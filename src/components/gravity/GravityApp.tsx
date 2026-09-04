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
