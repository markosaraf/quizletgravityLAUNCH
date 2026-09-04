import { memo, useEffect, useRef } from 'react';
import {
  GAME_STATES,
  PLANET_COUNT,
  shouldShowPlanet,
  planetLevelFor,
} from '@/lib/gravity/constants';

interface Props {
  currentLevel: number;
  planetLevel: number;
  gameState: string;
  windowHeight: number;
  windowWidth: number;
  src?: string;
  onLoaded?: (level: number) => void;
}

const TRANSITION = 'all 1500ms ease-out';

/** Position/scale per relative level — exact values from GravityPlanet.getAnimation */
function getTransform(
  currentLevel: number,
  planetLevel: number,
  windowHeight: number,
  windowWidth: number,
): { x: number; y: number; scale: number } {
  const cur = planetLevelFor(currentLevel);
  if (planetLevel === cur) {
    return { x: -0.5 * windowWidth, y: windowHeight - 300, scale: 1 };
  }
  if (planetLevel === planetLevelFor(currentLevel + 1)) {
    return { x: 0.7 * windowWidth, y: 0.1 * windowHeight, scale: 0.05 };
  }
  if (planetLevel === planetLevelFor(currentLevel + 2)) {
    return { x: 0.9 * windowWidth, y: 0.08 * windowHeight, scale: 0.02 };
  }
  // Parked planets — two distinct cases:
  //
  // 1) The planet that JUST EXITED (was current at currentLevel-1, now parked):
  //    waits far BELOW the screen (y = 9999) at the same x as the current planet,
  //    so when it transitions from "current" → "parked" it slides straight DOWN
  //    off the bottom of the screen (negative-y direction in math).
  //
  // 2) The planet that will become the NEW next+2 at the NEXT level-up
  //    (planetLevelFor(currentLevel + 3)): staged to the RIGHT of the screen
  //    so it enters from the positive-x direction. The planet starts at its
  //    FINAL scale (0.02 — same as the next+2 destination) so it doesn't
  //    shrink during the animation; only x changes, so the planet appears
  //    off-screen at its final small size and slides in horizontally.
  //
  //    The starting x is computed so the screen-pixel entry distance is
  //    exactly 3141px (matching LEVEL_UP_MS = 3141, π thousand pixels).
  //
  //    Derivation: the destination is (0.9 * W, 0.08 * H) at scale 0.02, so
  //    the destination screen-center cx ≈ 0.9*W + 0.02*W = 0.92*W (the planet
  //    div is 2*W wide, transform-origin is 0 0, so center = x + W*scale).
  //    The staging position is also at scale 0.02, so the starting cx ≈
  //    X_start + 0.02*W. The screen-pixel Δ is therefore
  //      Δ = (X_start + 0.02*W) - 0.92*W = X_start - 0.9*W
  //    Setting Δ = 3141 gives  X_start = 3141 + 0.9 * windowWidth.
  //
  // 3) All other parked planets (further ahead): default to the DOWN parked
  //    position so they don't appear on-screen.
  if (planetLevel === planetLevelFor(currentLevel - 1)) {
    return { x: -0.5 * windowWidth, y: 9999, scale: 1 };
  }
  if (planetLevel === planetLevelFor(currentLevel + 3)) {
    return { x: 3141 + 0.9 * windowWidth, y: 0.08 * windowHeight, scale: 0.02 };
  }
  return { x: -0.5 * windowWidth, y: 9999, scale: 1 };
}

function PlanetBase({
  currentLevel,
  planetLevel,
  gameState,
  windowHeight,
  windowWidth,
  src,
  onLoaded,
}: Props) {
  const imgRef = useRef<HTMLImageElement>(null);
  const size = 2 * windowWidth;

  const isSplashState =
    gameState === GAME_STATES.INTRO ||
    gameState === GAME_STATES.OPTIONS ||
    gameState === GAME_STATES.DIRECTIONS ||
    gameState === GAME_STATES.LOADING ||
    gameState === GAME_STATES.GAME_OVER;

  const hidden = isSplashState || !shouldShowPlanet(currentLevel, planetLevel);

  // level 1 placeholder shown behind planets 1 and 2 at levels 1–2
  const isPlaceholder =
    (currentLevel === 1 || currentLevel === 2) && planetLevel === 1;

  const cls = [
    'GravityPlanet',
    hidden ? 'is-hidden' : '',
    isPlaceholder ? 'GravityPlanet--level1Placeholder' : '',
    !isPlaceholder ? `GravityPlanet--level${planetLevel}` : '',
  ]
    .filter(Boolean)
    .join(' ');

  const { x, y, scale } = getTransform(
    currentLevel,
    planetLevel,
    windowHeight,
    windowWidth,
  );

  useEffect(() => {
    const img = imgRef.current;
    if (img?.complete) onLoaded?.(planetLevel);
  }, [onLoaded, planetLevel]);

  // Original hides planets >3 on level 1 splash states
  if (currentLevel === 1 && isSplashState && planetLevel > 3) return null;

  return (
    <div
      key={`planet${planetLevel}`}
      className={cls}
      style={{
        height: size,
        width: size,
        transform: `translate(${x}px, ${y}px) scale(${scale}, ${scale})`,
        transition: TRANSITION,
      }}
    >
      {src ? (
        <img
          ref={imgRef}
          src={src}
          alt=""
          className="GravityPlanet--preload"
          onLoad={() => onLoaded?.(planetLevel)}
        />
      ) : null}
    </div>
  );
}

export const Planet = memo(PlanetBase);

export function Planets(props: {
  currentLevel: number;
  gameState: string;
  windowHeight: number;
  windowWidth: number;
  planetAssetPaths: Record<number, string>;
  onLoaded: (level: number) => void;
}) {
  return (
    <>
      {Array.from({ length: PLANET_COUNT }, (_, i) => i + 1).map((level) => (
        <Planet
          key={level}
          currentLevel={props.currentLevel}
          planetLevel={level}
          gameState={props.gameState}
          windowHeight={props.windowHeight}
          windowWidth={props.windowWidth}
          src={props.planetAssetPaths[level]}
          onLoaded={props.onLoaded}
        />
      ))}
    </>
  );
}
