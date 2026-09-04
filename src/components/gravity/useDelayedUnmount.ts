import { useEffect, useState } from 'react';

/**
 * Keeps content mounted for `ms` after `show` turns false so CSS
 * leave-transitions can play. Mirrors what the original
 * @quizlet/legacy-css-transition-group did for gravity's banners.
 * All state changes happen inside timeout callbacks (never synchronously
 * inside the effect body).
 */
export function useDelayedUnmount(show: boolean, ms = 300): boolean {
  const [visible, setVisible] = useState(show);

  useEffect(() => {
    if (show) {
      const t = setTimeout(() => setVisible(true), 0);
      return () => clearTimeout(t);
    }
    const t = setTimeout(() => setVisible(false), ms);
    return () => clearTimeout(t);
  }, [show, ms]);

  return visible;
}
