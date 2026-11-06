'use client';

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { api, Leaderboard } from '@/components/community/Community';
import { GAME_STATES } from '@/lib/gravity/constants';
import { gravityStore } from '@/lib/gravity/store';
import type { GameData, GravitySet, GravityTerm } from '@/lib/gravity/types';
import { getStoredPartialAnswer } from '@/lib/gravity/parse';
import { collectSpecialChars } from '@/lib/gravity/specialChars';
import { GameplayView, useGameplaySize } from './GameplayView';
import { ModeControls, SiteHeader } from './ModeControls';
import { StartView, GameOverView, type LeaderboardEntry } from './StartScreens';
import { ImportScreen } from './ImportScreen';
import { setGameStarted } from './LandingSections';

export function GravityApp({shared}:{shared?:{set:GravitySet;terms:GravityTerm[]}}) {
  const runRef=useRef<string|null>(null);
  const finishedRun=useRef<string|null>(null);
  const [scoreMessage,setScoreMessage]=useState('');
  const [scoreRefresh,setScoreRefresh]=useState(0);
  const [scoreRetry,setScoreRetry]=useState(0);
  const startingRef=useRef(false);
  const [starting,setStarting]=useState(false);
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

  useEffect(()=>{if(shared)handleStartSet(shared.set,shared.terms);},[shared,handleStartSet]);
  const beginGame=async(restart=false)=>{
    if(startingRef.current)return;
    startingRef.current=true;setStarting(true);setScoreMessage('');
    try{if(shared){const run=await api('runs',{setId:shared.set.id,mode:gravityStore.getSnapshot().difficultyLevel});runRef.current=run.id;finishedRun.current=null;}
      if(restart)gravityStore.restartGame();else gravityStore.startGame();
    }catch(e){setScoreMessage((e as Error).message);}finally{startingRef.current=false;setStarting(false);}
  };
  useEffect(()=>{
    if(!shared||!data||data.gameState!==GAME_STATES.GAME_OVER||!runRef.current||finishedRun.current===runRef.current)return;
    const id=runRef.current;finishedRun.current=id;
    api(`runs/${id}/finish`,{score:data.points,level:data.level}).then(()=>{setScoreMessage('Your best score is saved.');setScoreRefresh(n=>n+1);}).catch(e=>{finishedRun.current=null;setScoreMessage('Score not saved: '+e.message);});
  },[data?.gameState,data?.points,data?.level,shared,scoreRetry]);

  // Special characters (ä ö é ß š …) that exist in the CURRENT set —
  // shown as clickable insert buttons above the typing field and the
  // copy-the-answer input. Collected from BOTH sides of every term.
  // data.terms keeps a stable reference across store ticks (change()
  // shallow-copies data), so this only recomputes when a new set loads.
  const specialChars = useMemo(
    () => (data ? collectSpecialChars(Object.values(data.terms)) : []),
    [data?.terms],
  );

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
  // ★ FIX 1 (mobile): instant scroll to the top after each correct answer
  // ══════════════════════════════════════════════════════════════════
  // On mobile, as soon as the user types, the on-screen keyboard opens and
  // the browser auto-scrolls the page down to the bottom-anchored typing
  // field (TypingPrompt already uses focus({ preventScroll: true }), but
  // that only suppresses the scroll at focus-time — it cannot stop the
  // "scroll focused element into view" that happens when the keyboard
  // opens/resizes the viewport). The user then can't see the asteroid
  // appear at the top of the play area.
  //
  // This effect watches the score: every time it INCREASES — i.e. a correct
  // word was submitted (wrong answers only subtract points:
  // INCORRECT_POINTS = -10 in constants.ts) — the page instantly jumps to
  // the top so the newly spawned asteroid is visible. Scrolling down to the
  // typing field still works exactly as before.
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
      // Instant jump (no smooth scrolling — window is the scroll container).
      // The extra scrollTop resets cover older mobile Safari versions where
      // <html>/<body> track their own scroll position.
      window.scrollTo(0, 0);
      document.documentElement.scrollTop = 0;
      document.body.scrollTop = 0;
    }
  }, [started, data]);

  const handleNewSet = useCallback(() => {
    if (shared) { window.location.assign("/create-set"); return; }
    gravityStore.dispose();
    setStarted(false);
    setLeaderboard([]);
    setCurrentTryIndex(-1);
    setLastRecordedKey(null);
  }, [shared]);

  // Mirror the `started` flag into the LandingSections store: while a
  // game session is running, the "How to play" + FAQ landing sections
  // are removed from the DOM entirely (they belong to the first page
  // only). Clicking "New set" flips this back to false and they return.
  useEffect(() => {
    setGameStarted(started);
  }, [started]);

  if (!started || !data) {
    return <ImportScreen onStart={handleStartSet} />;
  }

  // No screen-size/device blockers — the game is playable everywhere
  // (mobile layout in the top bar handles narrow widths).
  return (
    <div className="gravity-root">
      {(scoreMessage||starting)&&<p className="community-message" role="status">{starting?"Starting ranked game…":scoreMessage}</p>}
      <SiteHeader
        title={data.set.title}
        points={data.points}
        level={data.level}
        gameState={data.gameState}
        showMobileControls
        onPause={() => gravityStore.pauseGame()}
        onResume={() => gravityStore.resumeGame()}
        onRestart={() => void beginGame(true)}
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
            onRestart={() => void beginGame(true)}
            onNewSet={handleNewSet}
          />
          <div
            className="GravityModeLayout-main"
            ref={gameplayRef}
          >
            <GameplayView
              data={data}
              specialChars={specialChars}
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
                onStart={() => void beginGame()}
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
                onRestart={() => void beginGame(true)}
                onNewSet={handleNewSet}
              />
            ) : null}
          </div>
        </div>
      </div>
      {scoreMessage.startsWith("Score not saved:")&&<button onClick={()=>setScoreRetry(n=>n+1)}>Retry saving score</button>}
      {shared&&data.gameState===GAME_STATES.GAME_OVER&&<Leaderboard id={shared.set.id} refresh={scoreRefresh}/>}
    </div>
  );
}
