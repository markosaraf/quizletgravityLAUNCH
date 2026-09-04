import { memo, useMemo } from 'react';
import { GAME_STATES, getMaxTextLength, getTermSize } from '@/lib/gravity/constants';
import type { GravityTerm } from '@/lib/gravity/types';

interface Props {
  liveTermId: string;
  term: GravityTerm;
  showingSide: 'word' | 'definition';
  promptLang: string;
  gameState: string;
  isMeteor: boolean;
  termLife: number;
  windowWidth: number;
  windowHeight: number;
  onMissed: (liveTermId: string) => void;
}

function AsteroidBase({
  liveTermId,
  term,
  showingSide,
  promptLang,
  gameState,
  isMeteor,
  termLife,
  windowWidth,
  onMissed,
}: Props) {
  const text = term[showingSide] ?? '';
  const hasImage = showingSide === 'definition' && !!term._imageUrl;
  const maxLen = getMaxTextLength(promptLang, hasImage);
  const termSize = getTermSize(Math.min(text.length, maxLen), maxLen, hasImage);
  const textLength = Math.min(text.length, maxLen);

  // initial x is chosen once per mount (original: constructor state)
  const xPosition = useMemo(
    () => Math.random() * Math.max(1, windowWidth - termSize),
    [liveTermId],
  );

  const ratio = textLength / maxLen;
  const padH = Math.max(60 * ratio, 30);
  const padV = Math.max(55 * ratio, 25);
  const zIndex = (() => {
    const n = parseInt(liveTermId.split('-')[3] ?? '0', 10);
    return 300 - (Number.isNaN(n) ? 0 : n);
  })();

  const cls = [
    'GravityTerm',
    'tvy3tb5',
    gameState === GAME_STATES.FREE_FALL ? 'is-showing' : '',
    !isMeteor ? 'is-unmissed' : '',
    isMeteor ? 'is-meteor' : '',
    hasImage ? 'has-image' : '',
    hasImage && textLength === 0 ? 'image-only' : '',
    hasImage && textLength > 100 ? 'has-image-offset' : '',
  ]
    .filter(Boolean)
    .join(' ');

  const isFreeFall = gameState === GAME_STATES.FREE_FALL;

  return (
    <div
      className={cls}
      data-testid="GravityTerm"
      onAnimationEnd={() => onMissed(liveTermId)}
      style={{
        animationDuration: `${termLife}ms`,
        animationPlayState: isFreeFall ? 'running' : 'paused',
        height: `${termSize}px`,
        width: `${termSize}px`,
        top: 0,
        left: `${xPosition}px`,
        zIndex,
      }}
    >
      <div
        className={`w1swt6ej${hasImage && textLength > 100 ? ' ok0u4fh' : ''}`}
        style={{ height: `${termSize}px` }}
      >
        <div
          className="ck228hh"
          style={{
            padding: hasImage ? '0 75px 0 60px' : `0 ${padH}px 0 ${padV}px`,
            width: `${termSize}px`,
            maxWidth: `${termSize}px`,
          }}
        >
          {hasImage ? (
            <div className="dvzmxm1">
              <img
                alt={term.definition}
                className="i13a2vzw"
                data-testid="GravityTerm-image"
                src={term._imageUrl}
              />
            </div>
          ) : null}
          <div className="GravityTerm-text TermText" lang={promptLang}>
            {text}
          </div>
        </div>
      </div>
    </div>
  );
}

export const Asteroid = memo(AsteroidBase);
