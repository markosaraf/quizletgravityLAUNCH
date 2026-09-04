import { memo } from 'react';
import { GAME_STATES } from '@/lib/gravity/constants';
import { STRINGS, format } from '@/lib/gravity/strings';
import { formatNumber } from '@/lib/gravity/formatNumber';

/* ---------------- Sidebar / mobile controls (ModeControls) ---------------- */

interface ControlsProps {
  gameState: string;
  points: number;
  level: number;
  setPathLabel: string;
  onPause: () => void;
  onResume: () => void;
  onRestart: () => void;
  onNewSet: () => void;
}

function ModeControlsBase({
  gameState,
  points,
  level,
  setPathLabel,
  onPause,
  onResume,
  onRestart,
  onNewSet,
}: ControlsProps) {
  const isPaused = gameState === GAME_STATES.PAUSED;
  const pauseDisabled = gameState === GAME_STATES.COPY_ANSWER;
  const pauseHandler = isPaused ? onResume : onPause;

  return (
    <>
      <div className="GravityModeLayout-sidebar">
        <div className="GravityModeLayout-sidebarTitle">
          <span
            aria-hidden="true"
            className="GravityModeLayout-sidebarIcon"
          />
          {STRINGS.study_mode_name}
        </div>

        <div className="GravityModeControls-stat">
          <span className="GravityModeControls-label">
            {STRINGS.sidebar.score_label}
          </span>
          <span className="GravityModeControls-value">
            {formatNumber(points)}
          </span>
        </div>
        <div className="GravityModeControls-stat">
          <span className="GravityModeControls-label">
            {STRINGS.sidebar.level_label}
          </span>
          <span className="GravityModeControls-value">{level}</span>
        </div>

        <div style={{ marginTop: '2rem', display: 'grid', gap: '1rem' }}>
          <button
            className="UIButton UIButton--hero UIButton--fill"
            disabled={pauseDisabled}
            onClick={pauseHandler}
          >
            {isPaused
              ? STRINGS.sidebar.resume_button
              : STRINGS.sidebar.pause_button}
          </button>
          <div className="GravityModeControls-restartButton">
            <button className="UILink" onClick={onRestart}>
              {STRINGS.sidebar.restart_button}
            </button>
          </div>
          <div className="GravityModeControls-newSetButton">
            <button className="UILink UILink--white" onClick={onNewSet}>
              {STRINGS.game_over.new_set_button}
            </button>
          </div>
        </div>
      </div>
    </>
  );
}

export const ModeControls = memo(ModeControlsBase);

/* ---------------- Site header ----------------
   On desktop: shows Q logo + "Quizlet" + set title.
   On mobile: shows Q logo + score + level + pause/restart/new-set buttons
   (set title is hidden on mobile to make room for the controls). */
interface SiteHeaderProps {
  title: string;
  /** Score — only shown on mobile (desktop uses the sidebar). */
  points?: number;
  /** Level — only shown on mobile. */
  level?: number;
  /** Current game state — used to determine Pause vs Resume label. */
  gameState?: string;
  /** Whether to render the mobile controls block. When false (import screen),
      the header only shows the Q logo + title. */
  showMobileControls?: boolean;
  onPause?: () => void;
  onResume?: () => void;
  onRestart?: () => void;
  onNewSet?: () => void;
}

/* Inline SVG icons for the header buttons. Replaces the old text glyphs
   (⏸ ▶ ⟳ ＋) — some mobile platforms render those characters as color emoji
   (the pause glyph shows up as an orange square) regardless of theme, which
   SVGs with fill="currentColor" avoid. Color follows the button, so the
   existing dark-mode (twilight) and light-mode (white) styles keep working. */
const HEADER_ICON_PATHS = {
  play: 'M8 5v14l11-7z',
  pause: 'M6 19h4V5H6v14zm8-14v14h4V5h-4z',
  restart:
    'M17.65 6.35C16.2 4.9 14.21 4 12 4c-4.42 0-7.99 3.58-8 8s3.57 8 8 8c3.73 0 6.84-2.55 7.73-6h-2.08c-.82 2.33-3.04 4-5.65 4-3.31 0-6-2.69-6-6s2.69-6 6-6c1.66 0 3.14.69 4.22 1.78L13 11h7V4l-2.35 2.35z',
  newSet: 'M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z',
} as const;

function HeaderIcon({ name }: { name: keyof typeof HEADER_ICON_PATHS }) {
  return (
    <svg
      aria-hidden="true"
      className="GravitySiteHeader-iconButtonIcon"
      fill="currentColor"
      viewBox="0 0 24 24"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path d={HEADER_ICON_PATHS[name]} />
    </svg>
  );
}

export function SiteHeader({
  title,
  points = 0,
  level = 1,
  gameState,
  showMobileControls = false,
  onPause,
  onResume,
  onRestart,
  onNewSet,
}: SiteHeaderProps) {
  const isPaused = gameState === GAME_STATES.PAUSED;
  const pauseDisabled = gameState === GAME_STATES.COPY_ANSWER;
  const pauseHandler = isPaused ? onResume : onPause;

  return (
    <header className="GravitySiteHeader">
      <div className="GravitySiteHeader-logo">
        <span className="GravitySiteHeader-logoMark" aria-label="Q">
          {/* Light mode shows the gold Q; dark mode shows the white Q.
              CSS swaps visibility based on [data-theme] on <html>. */}
          <img
            src="/quizlet-q-logo-gold.svg"
            alt=""
            aria-hidden="true"
            className="GravitySiteHeader-logoMark-gold"
          />
          <img
            src="/quizlet-q-logo-white.svg"
            alt=""
            aria-hidden="true"
            className="GravitySiteHeader-logoMark-white"
          />
        </span>
        <span className="GravitySiteHeader-logoText">Quizlet</span>
      </div>
      <div className="GravitySiteHeader-setTitle">{title}</div>

      {showMobileControls ? (
        <div className="GravitySiteHeader-mobileControls">
          <div className="GravitySiteHeader-stat">
            <span className="GravitySiteHeader-statLabel">
              {STRINGS.sidebar.score_label}
            </span>
            <span className="GravitySiteHeader-statValue">
              {formatNumber(points)}
            </span>
          </div>
          <div className="GravitySiteHeader-stat">
            <span className="GravitySiteHeader-statLabel">
              {STRINGS.sidebar.level_label}
            </span>
            <span className="GravitySiteHeader-statValue">{level}</span>
          </div>
          <div className="GravitySiteHeader-actions">
            <button
              type="button"
              className="GravitySiteHeader-iconButton"
              disabled={pauseDisabled || !onPause}
              onClick={pauseHandler}
              aria-label={isPaused ? STRINGS.sidebar.resume_button : STRINGS.sidebar.pause_button}
              title={isPaused ? STRINGS.sidebar.resume_button : STRINGS.sidebar.pause_button}
            >
              <HeaderIcon name={isPaused ? 'play' : 'pause'} />
            </button>
            <button
              type="button"
              className="GravitySiteHeader-iconButton"
              onClick={onRestart}
              disabled={!onRestart}
              aria-label={STRINGS.sidebar.restart_button}
              title={STRINGS.sidebar.restart_button}
            >
              <HeaderIcon name="restart" />
            </button>
            <button
              type="button"
              className="GravitySiteHeader-iconButton"
              onClick={onNewSet}
              disabled={!onNewSet}
              aria-label={STRINGS.game_over.new_set_button}
              title={STRINGS.game_over.new_set_button}
            >
              <HeaderIcon name="newSet" />
            </button>
          </div>
        </div>
      ) : null}
    </header>
  );
}

export { format };
