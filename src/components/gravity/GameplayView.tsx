import { memo, useCallback, useEffect, useRef, useState } from 'react';
import {
  GAME_STATES,
  PLANET_ASSET_PATHS,
  RESIZE_DEBOUNCE,
} from '@/lib/gravity/constants';
import { STRINGS } from '@/lib/gravity/strings';
import type { GameData } from '@/lib/gravity/types';
import { Asteroid } from './Asteroid';
import { BannerAlert, SkipTipBanner } from './BannerAlert';
import { CopyTermView } from './CopyTermView';
import { LevelUpBadge } from './LevelUpBadge';
import { Planets } from './Planet';
import { TypingPrompt } from './TypingPrompt';

interface Props {
  data: GameData;
  onMissed: (liveTermId: string) => void;
  onType: (value: string) => void;
  onGrade: () => void;
  onCopyAnswer: (liveTermId: string, answer: string) => void;
  onPlanetLoaded: (level: number) => void;
  windowWidth: number;
  windowHeight: number;
}

function GameplayViewBase({
  data,
  onMissed,
  onType,
  onGrade,
  onCopyAnswer,
  onPlanetLoaded,
  windowWidth,
  windowHeight,
}: Props) {
  const isSplashState = [
    GAME_STATES.INTRO,
    GAME_STATES.OPTIONS,
    GAME_STATES.DIRECTIONS,
    GAME_STATES.LOADING,
    GAME_STATES.GAME_OVER,
  ].includes(data.gameState as never);

  const cls = [
    'GravityGameplayView',
    isSplashState ? 'has-splash' : '',
    data.gameState === GAME_STATES.GAME_OVER ? 'is-gameOver' : '',
  ]
    .filter(Boolean)
    .join(' ');

  // typing prompt placeholder (original getInputPlaceholderText)
  const placeholder =
    data.showingTermSide !== 'random' && data.set.wordLang !== data.set.defLang
      ? STRINGS.language_prompt_placeholder.replace(
          '{languageName}',
          data.showingTermSide === 'word' ? data.set.defLang : data.set.wordLang,
        )
      : STRINGS.default_prompt_placeholder;

  const termBeingCopied = data.termBeingCopied;
  const copiedLive = termBeingCopied ? data.liveTerms[termBeingCopied] : null;

  const onPlanetLoadedRef = useRef(onPlanetLoaded);
  useEffect(() => {
    onPlanetLoadedRef.current = onPlanetLoaded;
  }, [onPlanetLoaded]);
  const handlePlanetLoaded = useCallback((level: number) => {
    onPlanetLoadedRef.current(level);
  }, []);

  return (
    <div className={cls}>
      {data.gameState === GAME_STATES.LOADING ? (
        <div className="GravityGameplayView-loadingBar">
          <div
            className="GravityGameplayView-loadingBarFill"
            style={{ width: `${data.percentLoaded}%` }}
          />
        </div>
      ) : null}

      <div className="GravityGameplayView-starsBgPreload" />

      <div className="GravityGameplayView-inner">
        <BannerAlert
          isShowing={data.isMeteorIncoming}
          message={STRINGS.alerts.asteroid_incoming}
          type="warning"
        />
        <SkipTipBanner isShowing={data.isShowingDontKnowTip} />

        {copiedLive && termBeingCopied ? (
          <div className="GravityGameplayView-copyTermWrapper">
            <CopyTermView
              key={`CopyTermView-${copiedLive.luid}`}
              liveTermId={termBeingCopied}
              term={data.terms[copiedLive.luid]}
              showingSide={copiedLive.side}
              previouslyTypedText={data.mainTypingPromptValue}
              onSubmit={onCopyAnswer}
            />
          </div>
        ) : null}

        <div className="GravityGameplayView-typingPrompt">
          <TypingPrompt
            gameState={data.gameState}
            textValue={data.mainTypingPromptValue}
            placeholderText={placeholder}
            onChange={onType}
            onSubmit={onGrade}
          />
        </div>

        {Object.entries(data.liveTerms).map(([liveTermId, live]) =>
          liveTermId === termBeingCopied ? null : (
            <Asteroid
              key={liveTermId}
              liveTermId={liveTermId}
              term={data.terms[live.luid]}
              showingSide={live.side}
              promptLang={live.promptLang}
              gameState={data.gameState}
              isMeteor={
                (data.termLuidToMissedCount[live.luid] ?? 0) === 1
              }
              termLife={data.termLife}
              windowWidth={windowWidth}
              windowHeight={windowHeight}
              onMissed={onMissed}
            />
          ),
        )}

        <LevelUpBadge gameState={data.gameState} />

        <Planets
          currentLevel={data.level}
          gameState={data.gameState}
          windowHeight={windowHeight}
          windowWidth={windowWidth}
          planetAssetPaths={PLANET_ASSET_PATHS}
          onLoaded={handlePlanetLoaded}
        />
      </div>
    </div>
  );
}

export const GameplayView = memo(GameplayViewBase);

/** Tracks the gameplay area size (original updateWindowSize logic). */
export function useGameplaySize(
  ref: React.RefObject<HTMLDivElement | null>,
  remeasureKey?: unknown,
) {
  const [size, setSize] = useState({ w: 0, h: 0 });

  useEffect(() => {
    const measure = () => {
      const el = ref.current;
      const w = el ? el.offsetWidth : window.innerWidth;
      const h = window.innerHeight;
      // return the previous object when unchanged so React can bail out
      setSize((prev) => (prev.w === w && prev.h === h ? prev : { w, h }));
    };
    measure();
    let t: ReturnType<typeof setTimeout> | null = null;
    const onResize = () => {
      if (t) clearTimeout(t);
      t = setTimeout(measure, RESIZE_DEBOUNCE);
    };
    window.addEventListener('resize', onResize);
    return () => {
      window.removeEventListener('resize', onResize);
      if (t) clearTimeout(t);
    };
  }, [ref, remeasureKey]);

  return size;
}
