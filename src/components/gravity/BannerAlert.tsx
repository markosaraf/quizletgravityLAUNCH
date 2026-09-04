import { useDelayedUnmount } from './useDelayedUnmount';
import { STRINGS } from '@/lib/gravity/strings';

interface Props {
  isShowing: boolean;
  message: string;
  type: 'info' | 'warning';
}

export function BannerAlert({ isShowing, message, type }: Props) {
  const mounted = useDelayedUnmount(isShowing, 300);
  if (!mounted) return null;
  return (
    <div className={`GravityBannerAlert GravityBannerAlert--${type}`}>
      <div
        className={`GravityBannerAlert-alert ${
          isShowing ? 'is-entered' : 'is-leaving'
        }`}
      >
        {message}
      </div>
    </div>
  );
}

export function MeteorWarningBanner({ isShowing }: { isShowing: boolean }) {
  return (
    <BannerAlert
      isShowing={isShowing}
      message={STRINGS.alerts.asteroid_incoming}
      type="warning"
    />
  );
}

export function SkipTipBanner({ isShowing }: { isShowing: boolean }) {
  return (
    <BannerAlert isShowing={isShowing} message={STRINGS.alerts.skip} type="info" />
  );
}
