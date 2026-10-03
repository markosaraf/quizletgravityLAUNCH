'use client';

import { useSyncExternalStore } from 'react';
import { FaqSection, HowToSection } from '@/app/seo-content';

/* ----------------------------------------------------------------------------
   LANDING SECTIONS — the "How to play" + "Frequently asked questions"
   sections, wrapped so they exist ONLY on the absolute first page.

   page.tsx stays a server component and still server-renders these
   sections (crawlers keep seeing them in the initial HTML, and the
   JSON-LD in page.tsx keeps matching the visible content), but as soon
   as "Start studying" is clicked and a game session is running, the
   two sections are removed from the DOM entirely. Clicking "New set"
   brings them back.

   HOW THE STATE FLOWS:
   GravityApp owns the `started` flag (useState). It mirrors that flag
   into this module-level external store via setGameStarted() (inside a
   useEffect). This component subscribes with useSyncExternalStore —
   the same pattern gravityStore uses — so no prop drilling and no
   re-render of the game itself.
---------------------------------------------------------------------------- */

let gameStarted = false;
const listeners = new Set<() => void>();

/** Called by GravityApp — true once "Start studying" has been clicked. */
export function setGameStarted(value: boolean) {
  if (value === gameStarted) return;
  gameStarted = value;
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

// Server snapshot: sections are always present in the first server
// render, so SEO content + JSON-LD stay consistent with the markup.
function getServerSnapshot() {
  return false;
}

export function LandingSections() {
  const started = useSyncExternalStore(subscribe, () => gameStarted, getServerSnapshot);

  if (started) return null; // game session running — landing sections must not exist

  return (
    <>
      <HowToSection />
      <FaqSection />
    </>
  );
}
