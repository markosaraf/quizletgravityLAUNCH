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

/* ---------------- Screen size blocker ---------------- */
export function ScreenSizeBlocker({ isMobile }: { isMobile: boolean }) {
  return (
    <div className="GravityScreenSizeBlocker">
      <div className="GravityScreenSizeBlocker-icon">
        <div className="UIIcon">{isMobile ? '📱' : '⤢'}</div>
      </div>
      <div className="GravityScreenSizeBlocker-content">
        {isMobile ? STRINGS.mobile_blocker : STRINGS.desktop_blocker}
      </div>
    </div>
  );
}

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
        <span className="GravitySiteHeader-logoMark">Q</span>
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
              {isPaused ? '▶' : '⏸'}
            </button>
            <button
              type="button"
              className="GravitySiteHeader-iconButton"
              onClick={onRestart}
              disabled={!onRestart}
              aria-label={STRINGS.sidebar.restart_button}
              title={STRINGS.sidebar.restart_button}
            >
              ⟳
            </button>
            <button
              type="button"
              className="GravitySiteHeader-iconButton"
              onClick={onNewSet}
              disabled={!onNewSet}
              aria-label={STRINGS.game_over.new_set_button}
              title={STRINGS.game_over.new_set_button}
            >
              ＋
            </button>
          </div>
        </div>
      ) : null}
    </header>
  );
}

export { format };
