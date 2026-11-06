'use client';

import './ThemeToggle.css';
import {useSyncExternalStore} from 'react';
import {saveStoredTheme, type Theme} from '@/lib/gravity/parse';

const eventName = 'gravity-theme-change';
function subscribe(notify: () => void) {
  window.addEventListener(eventName, notify);
  return () => window.removeEventListener(eventName, notify);
}
function snapshot(): Theme {
  return document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light';
}
function serverSnapshot(): Theme { return 'light'; }
let pendingFrame = 0;

function changeTheme(theme: Theme) {
  const root = document.documentElement;
  cancelAnimationFrame(pendingFrame);
  root.classList.add('gravity-theme-changing');
  root.dataset.theme = theme;
  window.dispatchEvent(new Event(eventName));
  // Persist after the first paint. Do not delay feedback with storage or
  // re-render the complete import form when only its colours change.
  pendingFrame = requestAnimationFrame(() => {
    saveStoredTheme(theme);
    pendingFrame = requestAnimationFrame(() => root.classList.remove('gravity-theme-changing'));
  });
}

export function ThemeToggle() {
  const theme = useSyncExternalStore(subscribe, snapshot, serverSnapshot);
  return <div className="community-theme" role="group" aria-label="Theme">
    <span>Theme:</span>
    {(['light','dark'] as const).map(value => <button key={value} type="button"
      aria-pressed={theme === value} onClick={() => changeTheme(value)}>
      {value === 'light' ? 'Light' : 'Dark'}
    </button>)}
  </div>;
}
