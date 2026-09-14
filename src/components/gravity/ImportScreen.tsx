'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ClipboardEvent as ReactClipboardEvent } from 'react';
import {
  loadImportedSet,
  loadStoredSeparator,
  loadStoredTheme,
  parseCsv,
  parsePastedList,
  readFileAsText,
  saveImportedSet,
  saveStoredSeparator,
  saveStoredTheme,
} from '@/lib/gravity/parse';
import type { Separator, Theme } from '@/lib/gravity/parse';
import {
  buildBookmarkletHref,
  extractQuizletSetIdClient,
  isBrowserImportMessage,
  isQuizletOrigin,
  parseQuizletClipboardHtml,
  parseQuizletClipboardText,
} from '@/lib/gravity/browserImport';
import { STRINGS, format } from '@/lib/gravity/strings';
import type { GravitySet, GravityTerm } from '@/lib/gravity/types';

interface Props {
  onStart: (set: GravitySet, terms: GravityTerm[]) => void;
}

const SAMPLE = 'helio-, sun\ngeo-, earth\nbio-, life\nchrom-, color';

const SEPARATOR_ORDER: Separator[] = ['comma', 'semicolon', 'dash'];
const THEME_ORDER: Theme[] = ['light', 'dark'];

/** Progress-bar animation: elapsed time (ms) → whole-number percentage
 *  0–97. Exponential ease — moves fast at first (the import usually finishes
 *  in 1–5 s) and creeps slowly later, so the bar never looks frozen during a
 *  long retry chain. 100% is only ever shown on real completion. */
const progressAfterMs = (elapsedMs: number): number =>
  Math.round(Math.min(97, 100 * (1 - Math.exp(-elapsedMs / 11_000))));

/** Hard client-side cap — matches the server's 60 s function budget with
 *  headroom, so a hung request can never freeze the UI forever. */
const IMPORT_ABORT_MS = 75_000;
/** How often the progress bar re-renders while an import is in flight. */
const PROGRESS_TICK_MS = 150;
/** How long a completed (100%) bar stays on screen before hiding. */
const PROGRESS_FADE_MS = 700;

/* ── Server-fetch-blocked memory ────────────────────────────────────────
 * Quizlet's Cloudflare wall is sticky on short timescales: when the server
 * chain failed once, it will almost certainly fail again for the next few
 * minutes. After a failure we remember it for 2 h (per tab session) and the
 * next import skips straight to the in-browser flow — while STILL retrying
 * the server quietly in the background, so a set that became reachable
 * (cache, Wayback) fills the table by itself. */
const SERVER_BLOCK_KEY = 'qgServerFetchBlockedUntil';
const SERVER_BLOCK_MS = 2 * 60 * 60 * 1000;

function isServerFetchBlocked(): boolean {
  try {
    return Date.now() < Number(sessionStorage.getItem(SERVER_BLOCK_KEY) || 0);
  } catch {
    return false;
  }
}

function markServerFetchBlocked(): void {
  try {
    sessionStorage.setItem(SERVER_BLOCK_KEY, String(Date.now() + SERVER_BLOCK_MS));
  } catch {
    /* private mode etc. — flow still works, just without the fast path */
  }
}

function markServerFetchOk(): void {
  try {
    sessionStorage.removeItem(SERVER_BLOCK_KEY);
  } catch {
    /* ignore */
  }
}

export function ImportScreen({ onStart }: Props) {
  const [tab, setTab] = useState<'paste' | 'file'>('paste');
  const [text, setText] = useState('');
  const [fileName, setFileName] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // User-selected separator (comma / semicolon / dash). Persisted to
  // localStorage so it survives reloads. Defaults to 'comma' (most common CSV
  // separator). Read post-hydration via setTimeout to avoid the
  // set-state-in-effect lint rule (same pattern as `lastSet` below).
  const [separator, setSeparator] = useState<Separator>('comma');
  useEffect(() => {
    const t = setTimeout(() => setSeparator(loadStoredSeparator()), 0);
    return () => clearTimeout(t);
  }, []);

  // User-selected theme (dark / light). Persisted to localStorage. Defaults
  // to 'light' (the site-wide default — see also the pre-paint theme script
  // in src/app/layout.tsx). Applied to <html data-theme> post-hydration to
  // avoid SSR mismatch.
  const [theme, setTheme] = useState<Theme>('light');
  useEffect(() => {
    const t = setTimeout(() => {
      const stored = loadStoredTheme();
      setTheme(stored);
      if (typeof document !== 'undefined') {
        document.documentElement.setAttribute('data-theme', stored);
      }
    }, 0);
    return () => clearTimeout(t);
  }, []);

  const handleThemeChange = useCallback((next: Theme) => {
    setTheme(next);
    saveStoredTheme(next);
    if (typeof document !== 'undefined') {
      document.documentElement.setAttribute('data-theme', next);
    }
  }, []);

  // Quizlet set import — two ways in:
  //
  // 1) The classic one-click server fetch through /api/import-quizlet (the
  //    readers/relays/Wayback chain). Quizlet's Cloudflare wall blocks
  //    datacenter IPs, so this is now only the FAST PATH: when it works, the
  //    table fills itself.
  //
  // 2) The in-browser import ("Import in your browser"): the user's own
  //    browser opens the Quizlet set, solves any "one more step" check, and
  //    hands the data back — either via copy & paste (paste zone below,
  //    parses the clipboard's text/html copy of the term DOM) or via the
  //    draggable bookmarklet, which scrapes the set INSIDE the quizlet.com
  //    tab and posts it back through window.opener.postMessage. This path
  //    always gets through, because Quizlet never challenges a real user's
  //    real browser session.
  //
  // While a server request is in flight an animated progress bar is shown;
  // in-browser mode replaces it with a step list + paste zone. All paths
  // pour the cards into the textarea as tab-separated lines so they flow
  // through the exact same parse → preview-table pipeline, fully editable.
  const [quizletOpen, setQuizletOpen] = useState(false);
  const [quizletUrl, setQuizletUrl] = useState('');
  const [quizletBusy, setQuizletBusy] = useState(false);
  const [quizletStatus, setQuizletStatus] = useState<string | null>(null);
  const [quizletError, setQuizletError] = useState<string | null>(null);
  /** null = idle (no bar); 0–100 while importing; 100 briefly on success. */
  const [quizletProgress, setQuizletProgress] = useState<number | null>(null);

  // In-browser import panel state.
  const [browserOpen, setBrowserOpen] = useState(false);
  /** Raw content of the paste zone (only filled when auto-parse failed). */
  const [pasteZone, setPasteZone] = useState('');
  /** Inline feedback inside the browser panel (detected N pairs / parse fail / …). */
  const [browserMsg, setBrowserMsg] = useState<{ ok: boolean; text: string } | null>(null);
  /** Background server retry status while the browser panel is open. */
  const [serverRetry, setServerRetry] = useState<'idle' | 'running'>('idle');
  /** Handle of the Quizlet tab we opened — kept WITHOUT `noopener` so the
   *  bookmarklet can reach this tab back via window.opener.postMessage. */
  const popupRef = useRef<Window | null>(null);
  /** AbortController of the in-flight server fetch (aborted when the
   *  browser import lands first, so a late server answer can't overwrite
   *  the fresher in-browser result). */
  const quizletAbortRef = useRef<AbortController | null>(null);
  const bookmarkletRef = useRef<HTMLAnchorElement | null>(null);

  useEffect(
    () => () => {
      // unmount: stop any in-flight background import
      quizletAbortRef.current?.abort();
    },
    [],
  );

  /** Shared landing pad for cards from ALL import paths (server fetch,
   *  clipboard paste, bookmarklet postMessage). Tab-separated on purpose:
   *  the paste parser always tries tab FIRST (see splitPastedLine), so pairs
   *  split correctly no matter which separator is selected — and commas
   *  inside terms/definitions ("le client, la cliente") stay safe. */
  const applyCards = useCallback(
    (cards: Array<{ term: string; definition: string }>, title: string, skipped: number) => {
      quizletAbortRef.current?.abort();
      quizletAbortRef.current = null;
      setText(cards.map((c) => `${c.term}\t${c.definition}`).join('\n'));
      // Reuse the existing "file name" slot so the Quizlet set title becomes
      // the study-set title on Start.
      setFileName(title || 'Quizlet set');
      setTab('paste');
      setError(null);
      const skippedNote =
        skipped > 0 ? format(STRINGS.import.quizlet.skipped_note, { count: skipped }) : '';
      setQuizletStatus(
        format(STRINGS.import.quizlet.success, {
          count: cards.length,
          title: title || 'Quizlet set',
        }) + skippedNote,
      );
      setBrowserOpen(false);
      setServerRetry('idle');
      setBrowserMsg(null);
    },
    [],
  );

  const handleQuizletImport = useCallback(async () => {
    const link = quizletUrl.trim();
    if (!link) {
      setQuizletError(STRINGS.import.quizlet.error_no_url);
      return;
    }
    setQuizletError(null);
    setQuizletStatus(null);
    setBrowserMsg(null);
    setPasteZone('');

    const previouslyBlocked = isServerFetchBlocked();
    const controller = new AbortController();
    quizletAbortRef.current = controller;
    const abortTimer = setTimeout(() => controller.abort(), IMPORT_ABORT_MS);

    // Fast path (Quizlet blocked us recently): open the in-browser panel
    // IMMEDIATELY and retry the server silently in the background.
    let ticker: ReturnType<typeof setInterval> | null = null;
    if (previouslyBlocked) {
      setQuizletProgress(null);
      setQuizletBusy(true);
      setBrowserOpen(true);
      setServerRetry('running');
    } else {
      setQuizletBusy(true);
      setQuizletProgress(0);
      const startedAt = Date.now();
      ticker = setInterval(() => {
        setQuizletProgress(progressAfterMs(Date.now() - startedAt));
      }, PROGRESS_TICK_MS);
    }

    try {
      const res = await fetch(`/api/import-quizlet?url=${encodeURIComponent(link)}`, {
        signal: controller.signal,
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(
          typeof data?.error === 'string' ? data.error : STRINGS.import.quizlet.error_generic,
        );
      }
      const cards = (data?.cards ?? []) as Array<{ term: string; definition: string }>;
      if (cards.length < 2) throw new Error(STRINGS.import.error_single);
      markServerFetchOk();
      const title = typeof data?.title === 'string' ? data.title : 'Quizlet set';
      const skipped = typeof data?.skipped === 'number' ? data.skipped : 0;
      if (previouslyBlocked) {
        // Quiet background retry won — pour the set in and close the panel.
        applyCards(cards, title, skipped);
      } else {
        applyCards(cards, title, skipped);
        // Flash the completed bar at 100% ("Done!"), then hide it and close
        // the panel — the filled-in preview table below is the real
        // confirmation.
        setQuizletProgress(100);
        setTimeout(() => {
          setQuizletProgress(null);
          setQuizletOpen(false);
        }, PROGRESS_FADE_MS);
      }
    } catch (err) {
      markServerFetchBlocked();
      if (previouslyBlocked) {
        // Silent background retry failed — stay in the in-browser flow
        // without nagging; the panel is already on screen.
        setServerRetry('idle');
      } else {
        setQuizletProgress(null);
        // First-class fallback: open the in-browser import automatically.
        setBrowserOpen(true);
        setQuizletError(
          err instanceof Error && err.name === 'AbortError'
            ? STRINGS.import.quizlet.error_timeout
            : err instanceof Error && typeof err.message === 'string' && err.message
              ? err.message
              : STRINGS.import.quizlet.error_generic,
        );
      }
    } finally {
      if (ticker) clearInterval(ticker);
      clearTimeout(abortTimer);
      setQuizletBusy(false);
    }
  }, [quizletUrl, applyCards]);

  /* ── In-browser import (Path A: copy & paste) ────────────────────────── */

  const quizletSetId = useMemo(() => extractQuizletSetIdClient(quizletUrl), [quizletUrl]);

  const handleOpenQuizletTab = useCallback(() => {
    if (!quizletSetId) {
      setBrowserMsg({ ok: false, text: STRINGS.import.quizlet.browser.open_no_url });
      return;
    }
    setBrowserMsg(null);
    // Deliberately WITHOUT features='noopener': the bookmarklet needs
    // window.opener to postMessage the scraped set back into this tab.
    const win = window.open(`https://quizlet.com/${quizletSetId}/`, '_blank');
    if (!win) {
      setBrowserMsg({ ok: false, text: STRINGS.import.quizlet.browser.popup_blocked });
      return;
    }
    popupRef.current = win;
  }, [quizletSetId]);

  /** paste event on the paste zone: the clipboard usually carries text/html
   *  (a DOM slice with Quizlet's .TermText classes) — parse it live; plain
   *  text is the fallback. On success the zone stays empty; on failure the
   *  raw text is kept visible so "Load pasted terms" can retry. */
  const handlePasteZonePaste = useCallback(
    (e: ReactClipboardEvent<HTMLTextAreaElement>) => {
      const html = e.clipboardData.getData('text/html');
      const plain = e.clipboardData.getData('text/plain');
      const result =
        (html ? parseQuizletClipboardHtml(html) : null) ??
        (plain ? parseQuizletClipboardText(plain) : null);
      if (result && result.cards.length >= 2) {
        e.preventDefault();
        setPasteZone('');
        setBrowserMsg({
          ok: true,
          text:
            format(STRINGS.import.quizlet.browser.detected, { count: result.cards.length }) +
            (result.skipped > 0
              ? format(STRINGS.import.quizlet.skipped_note, { count: result.skipped })
              : ''),
        });
        applyCards(result.cards, result.title, result.skipped);
        return;
      }
      if (plain) {
        e.preventDefault();
        setPasteZone(plain);
        setBrowserMsg({ ok: false, text: STRINGS.import.quizlet.browser.parse_fail });
        return;
      }
      // Nothing readable — let the default paste happen.
    },
    [applyCards],
  );

  /** Manual retry on whatever sits in the paste zone (context-menu pastes on
   *  some mobile browsers never fire a paste event). */
  const handleParsePasted = useCallback(() => {
    const result = parseQuizletClipboardText(pasteZone);
    if (result && result.cards.length >= 2) {
      setPasteZone('');
      setBrowserMsg({
        ok: true,
        text: format(STRINGS.import.quizlet.browser.detected, { count: result.cards.length }),
      });
      applyCards(result.cards, result.title, result.skipped);
    } else {
      setBrowserMsg({ ok: false, text: STRINGS.import.quizlet.browser.parse_fail });
    }
  }, [pasteZone, applyCards]);

  /* ── In-browser import (Path B: bookmarklet postMessage) ─────────────── */

  // The bookmarklet (running INSIDE the quizlet.com tab) posts
  // { source, type, title, cards, skipped } to this tab via
  // window.opener.postMessage. Accept messages from Quizlet origins only —
  // anything else is ignored before even looking at the payload.
  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      if (!isQuizletOrigin(e.origin)) return;
      if (!isBrowserImportMessage(e.data)) return;
      const { title, cards, skipped } = e.data;
      if (!Array.isArray(cards) || cards.length < 2) {
        setBrowserMsg({ ok: false, text: STRINGS.import.quizlet.browser.parse_fail });
        return;
      }
      applyCards(
        cards.filter(
          (c) => c && typeof c.term === 'string' && typeof c.definition === 'string',
        ),
        typeof title === 'string' ? title : '',
        typeof skipped === 'number' ? skipped : 0,
      );
      // Close the Quizlet tab that handed us the set (WindowProxy.close()
      // is allowed cross-origin for script-opened tabs).
      try {
        (e.source as WindowProxy | null)?.close?.();
      } catch {
        /* ignore */
      }
      popupRef.current = null;
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [applyCards]);

  // The bookmarklet link is a javascript: URL built for THIS origin. It is
  // assigned via setAttribute (not JSX) so React never has to render — or
  // sanitize-warn about — a javascript: href. Recomputed whenever the panel
  // opens, so localhost/preview deployments build their own variant.
  useEffect(() => {
    if (!browserOpen) return;
    const a = bookmarkletRef.current;
    if (a && typeof window !== 'undefined') {
      a.setAttribute('href', buildBookmarkletHref(window.location.origin));
    }
  }, [browserOpen]);

  /**
   * Editable terms table.
   *
   * `text` (the textarea) is the parsing source-of-truth: every keystroke in
   * the textarea re-parses and overwrites `terms`. After parsing, the user can
   * edit any cell to fix mis-splits (e.g. "hello, world, foo" — the comma
   * splitter would put "hello" as term and "world, foo" as definition, but the
   * user can move text between the two cells directly). Row edits do NOT write
   * back to the textarea.
   *
   * We use the "adjust state during render" pattern (see React docs:
   * https://react.dev/learn/you-might-not-need-an-effect#adjusting-some-state-when-a-prop-changes)
   * to re-parse whenever `text` / `tab` / `separator` changes, without an
   * effect.
   */
  const [terms, setTerms] = useState<GravityTerm[]>([]);
  const [lastSource, setLastSource] = useState<{
    text: string;
    tab: 'paste' | 'file';
    separator: Separator;
  }>({ text: '', tab: 'paste', separator: 'comma' });
  if (
    lastSource.text !== text ||
    lastSource.tab !== tab ||
    lastSource.separator !== separator
  ) {
    setLastSource({ text, tab, separator });
    setTerms(
      tab === 'paste'
        ? parsePastedList(text, separator)
        : parseCsv(text, separator).terms,
    );
  }

  // offer to restore the last set (read post-hydration to avoid SSR mismatch)
  const [lastSet, setLastSet] = useState<{
    title: string;
    terms: GravityTerm[];
  } | null>(null);
  useEffect(() => {
    const t = setTimeout(() => setLastSet(loadImportedSet()), 0);
    return () => clearTimeout(t);
  }, []);
  const restored = !!lastSet;

  const handleFile = useCallback(async (file: File) => {
    try {
      const content = await readFileAsText(file);
      setText(content);
      setFileName(file.name);
      setError(null);
    } catch {
      setError(STRINGS.import.error_generic);
    }
  }, []);

  const handleStart = useCallback(() => {
    // filter out empty rows so the user can leave blanks while editing
    const cleaned = terms
      .map((t) => ({ ...t, word: t.word.trim(), definition: t.definition.trim() }))
      .filter((t) => t.word !== '' || t.definition !== '');
    if (cleaned.length < 2) {
      setError(
        cleaned.length === 0
          ? STRINGS.import.error_generic
          : STRINGS.import.error_single,
      );
      return;
    }
    const set: GravitySet = {
      id: 'imported',
      title: fileName ?? 'My study set',
      wordLang: 'en',
      defLang: 'en',
    };
    saveImportedSet(set.title, cleaned);
    onStart(set, cleaned);
  }, [terms, fileName, onStart]);

  const handleRestore = useCallback(() => {
    if (!lastSet) return;
    onStart(
      { id: 'imported', title: lastSet.title, wordLang: 'en', defLang: 'en' },
      lastSet.terms,
    );
  }, [lastSet, onStart]);

  // ---- editable cell helpers ----
  const updateTermWord = useCallback((id: string, word: string) => {
    setTerms((prev) => prev.map((t) => (t.id === id ? { ...t, word } : t)));
  }, []);

  const updateTermDefinition = useCallback((id: string, definition: string) => {
    setTerms((prev) => prev.map((t) => (t.id === id ? { ...t, definition } : t)));
  }, []);

  const deleteTerm = useCallback((id: string) => {
    setTerms((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const toggleStarred = useCallback((id: string) => {
    setTerms((prev) =>
      prev.map((t) => (t.id === id ? { ...t, starred: !t.starred } : t)),
    );
  }, []);

  const handleSeparatorChange = useCallback((sep: Separator) => {
    setSeparator(sep);
    saveStoredSeparator(sep);
    setError(null);
  }, []);

  const addBlankTerm = useCallback(() => {
    setTerms((prev) => [
      ...prev,
      {
        id: `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
        luid: '',
        word: '',
        definition: '',
        starred: false,
      },
    ]);
  }, []);

  // show all terms (no truncation) — the user needs to see them all to edit
  const visibleTerms = terms;
  const previewLabel = useMemo(
    () => format(STRINGS.import.detected, { count: terms.length }),
    [terms.length],
  );

  return (
    <div className="gravity-root">
      <div className="GravityImportView">
        <div className="GravityImportView-inner">
          <h1 className="GravityImportView-title">{STRINGS.import.title}</h1>
          <p className="GravityImportView-subtitle">{STRINGS.import.subtitle}</p>

          <div className="GravityImportCard">
            <div className="GravityImportTheme" role="group" aria-label={STRINGS.import.theme_selector.label}>
              <span className="GravityImportTheme-label">
                {STRINGS.import.theme_selector.label}:
              </span>
              <div className="GravityImportTheme-toggle">
                {THEME_ORDER.map((t) => (
                  <button
                    key={t}
                    type="button"
                    className={`GravityImportTheme-option ${theme === t ? 'is-selected' : ''}`}
                    onClick={() => handleThemeChange(t)}
                    aria-pressed={theme === t}
                  >
                    {STRINGS.import.theme_selector[t]}
                  </button>
                ))}
              </div>
            </div>

            {/* Option row — "Import Quizlet Set" button sits LEFT of the
                existing "Paste terms" / "Upload CSV" tabs. */}
            <div className="GravityImportTopbar">
              <button
                type="button"
                className={`GravityImportQuizlet-button ${quizletOpen ? 'is-open' : ''}`}
                onClick={() => {
                  setQuizletOpen((o) => !o);
                  setQuizletError(null);
                }}
                aria-expanded={quizletOpen}
                aria-controls="quizlet-import-panel"
              >
                {STRINGS.import.quizlet.button}
              </button>

              <div className="GravityImportTabs">
                <button
                  type="button"
                  className={`GravityImportTab ${tab === 'paste' ? 'is-active' : ''}`}
                  onClick={() => {
                    setTab('paste');
                    setError(null);
                  }}
                >
                  {STRINGS.import.paste_tab}
                </button>
                <button
                  type="button"
                  className={`GravityImportTab ${tab === 'file' ? 'is-active' : ''}`}
                  onClick={() => {
                    setTab('file');
                    setError(null);
                  }}
                >
                  {STRINGS.import.file_tab}
                </button>
              </div>
            </div>

            {/* Quizlet import panel — URL input + fetch; terms land in the
                same preview table used by paste/CSV. If the server chain is
                blocked by Quizlet's Cloudflare wall, the in-browser import
                panel opens underneath automatically. */}
            {quizletOpen ? (
              <div className="GravityImportQuizlet" id="quizlet-import-panel">
                <div className="GravityImportQuizlet-row">
                  <label className="GravityImportQuizlet-label" htmlFor="quizlet-url-input">
                    {STRINGS.import.quizlet.url_label}
                  </label>
                  <input
                    id="quizlet-url-input"
                    type="url"
                    className="GravityImportQuizlet-input"
                    value={quizletUrl}
                    placeholder={STRINGS.import.quizlet.url_placeholder}
                    onChange={(e) => {
                      setQuizletUrl(e.target.value);
                      setQuizletError(null);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        void handleQuizletImport();
                      }
                    }}
                    disabled={quizletBusy}
                  />
                  <button
                    type="button"
                    className="GravityImportQuizlet-fetch"
                    onClick={() => void handleQuizletImport()}
                    disabled={quizletBusy || quizletUrl.trim() === ''}
                  >
                    {quizletBusy
                      ? STRINGS.import.quizlet.fetching
                      : STRINGS.import.quizlet.fetch_button}
                  </button>
                </div>
                <p className="GravityImportQuizlet-hint">{STRINGS.import.quizlet.hint}</p>

                {/* Animated progress bar — shown from the moment Import is
                    clicked until the request settles (fast path only; the
                    in-browser panel replaces it when Quizlet blocks us). */}
                {quizletProgress !== null ? (
                  <div className="GravityImportQuizlet-progress" role="status" aria-live="polite">
                    <div className="GravityImportQuizlet-progressHeader">
                      <span className="GravityImportQuizlet-progressLabel">
                        {quizletProgress >= 100
                          ? STRINGS.import.quizlet.progress_done
                          : STRINGS.import.quizlet.progress_label}
                      </span>
                      <span className="GravityImportQuizlet-progressPct">
                        {quizletProgress}%
                      </span>
                    </div>
                    <div
                      className="GravityImportQuizlet-progressTrack"
                      role="progressbar"
                      aria-valuemin={0}
                      aria-valuemax={100}
                      aria-valuenow={Math.round(quizletProgress)}
                    >
                      <div
                        className="GravityImportQuizlet-progressFill"
                        style={{ width: `${quizletProgress}%` }}
                      />
                    </div>
                    {quizletBusy ? (
                      <p className="GravityImportQuizlet-progressHint">
                        {STRINGS.import.quizlet.progress_hint}
                      </p>
                    ) : null}
                  </div>
                ) : null}

                {quizletStatus ? (
                  <div className="GravityImportQuizlet-status" role="status">
                    {quizletStatus}
                  </div>
                ) : null}
                {quizletError ? (
                  <div className="GravityImportQuizlet-error" role="alert">
                    {quizletError}
                  </div>
                ) : null}

                {/* ── In-browser import panel ── */}
                {browserOpen ? (
                  <div className="GravityImportQuizlet-browser">
                    <div className="GravityImportQuizlet-browserHead">
                      <span className="GravityImportQuizlet-browserTitle">
                        {STRINGS.import.quizlet.browser.panel_title}
                      </span>
                      <button
                        type="button"
                        className="GravityImportQuizlet-browserHide"
                        onClick={() => setBrowserOpen(false)}
                        aria-label="Hide browser import"
                        title="Hide browser import"
                      >
                        ×
                      </button>
                    </div>
                    <p className="GravityImportQuizlet-browserNote">
                      {STRINGS.import.quizlet.browser.panel_note}
                    </p>
                    {serverRetry === 'running' ? (
                      <p className="GravityImportQuizlet-browserRetry">
                        {STRINGS.import.quizlet.browser.server_retry_note}
                      </p>
                    ) : null}

                    <ol className="GravityImportQuizlet-steps">
                      <li>{STRINGS.import.quizlet.browser.step1}</li>
                      <li>{STRINGS.import.quizlet.browser.step2}</li>
                      <li>{STRINGS.import.quizlet.browser.step3}</li>
                    </ol>

                    <div className="GravityImportQuizlet-browserRow">
                      <button
                        type="button"
                        className="GravityImportQuizlet-openBtn"
                        onClick={handleOpenQuizletTab}
                      >
                        {STRINGS.import.quizlet.browser.open_button}
                      </button>
                      {!quizletSetId ? (
                        <span className="GravityImportQuizlet-browserWarn">
                          {STRINGS.import.quizlet.browser.open_no_url}
                        </span>
                      ) : null}
                    </div>
                    <p className="GravityImportQuizlet-openHint">
                      {STRINGS.import.quizlet.browser.open_hint}
                    </p>

                    <label className="GravityImportQuizlet-pasteLabel" htmlFor="quizlet-paste-zone">
                      {STRINGS.import.quizlet.browser.paste_zone_label}
                    </label>
                    <textarea
                      id="quizlet-paste-zone"
                      className="GravityImportQuizlet-pasteZone"
                      value={pasteZone}
                      placeholder={STRINGS.import.quizlet.browser.paste_zone_placeholder}
                      onPaste={handlePasteZonePaste}
                      onChange={(e) => setPasteZone(e.target.value)}
                      rows={3}
                    />
                    <div className="GravityImportQuizlet-browserRow">
                      <button
                        type="button"
                        className="GravityImportQuizlet-fetch"
                        onClick={handleParsePasted}
                        disabled={pasteZone.trim() === ''}
                      >
                        {STRINGS.import.quizlet.browser.parse_button}
                      </button>
                    </div>

                    <div className="GravityImportQuizlet-bookmarklet">
                      <p className="GravityImportQuizlet-browserNote">
                        {STRINGS.import.quizlet.browser.bookmarklet_label}
                      </p>
                      <div className="GravityImportQuizlet-browserRow">
                        <a
                          ref={bookmarkletRef}
                          draggable
                          className="GravityImportQuizlet-bookmarkletLink"
                          title={STRINGS.import.quizlet.browser.bookmarklet_label}
                          onClick={(e) => e.preventDefault()}
                        >
                          {STRINGS.import.quizlet.browser.bookmarklet_link}
                        </a>
                        <span className="GravityImportQuizlet-bookmarkletHint">
                          {STRINGS.import.quizlet.browser.bookmarklet_hint}
                        </span>
                      </div>
                    </div>

                    {browserMsg ? (
                      <div
                        className={
                          browserMsg.ok
                            ? 'GravityImportQuizlet-status'
                            : 'GravityImportQuizlet-error'
                        }
                        role={browserMsg.ok ? 'status' : 'alert'}
                      >
                        {browserMsg.text}
                      </div>
                    ) : null}
                  </div>
                ) : null}
              </div>
            ) : null}

            <div className="GravityImportSeparator" role="group" aria-label={STRINGS.import.separator_selector.title}>
              <span className="GravityImportSeparator-label">
                {STRINGS.import.separator_selector.title}:
              </span>
              <div className="GravityImportSeparator-toggle">
                {SEPARATOR_ORDER.map((sep) => (
                  <button
                    key={sep}
                    type="button"
                    className={`GravityImportSeparator-option ${separator === sep ? 'is-selected' : ''}`}
                    onClick={() => handleSeparatorChange(sep)}
                    aria-pressed={separator === sep}
                  >
                    {STRINGS.import.separator_selector[sep]}
                  </button>
                ))}
              </div>
            </div>

            {tab === 'paste' ? (
              <>
                <textarea
                  className="GravityImportTextarea"
                  value={text}
                  placeholder={SAMPLE}
                  onChange={(e) => {
                    setText(e.target.value);
                    setError(null);
                  }}
                  aria-label={STRINGS.import.paste_tab}
                />
                <p className="GravityImportMeta">{STRINGS.import.meta_paste}</p>
              </>
            ) : (
              <>
                <label className="GravityImportFileLabel">
                  <input
                    type="file"
                    accept=".csv,.tsv,.txt,text/csv,text/plain"
                    className="GravityImportFileInput"
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (file) void handleFile(file);
                    }}
                  />
                  {fileName ? `📄 ${fileName}` : STRINGS.import.file_label}
                </label>
                <p className="GravityImportMeta">{STRINGS.import.file_hint}</p>
              </>
            )}

            {visibleTerms.length > 0 ? (
              <div className="GravityImportPreview" aria-live="polite">
                <div className="GravityImportPreview-header">
                  <span>{previewLabel}</span>
                  <button
                    type="button"
                    className="GravityImportPreview-addRow"
                    onClick={addBlankTerm}
                    aria-label="Add a row"
                  >
                    + row
                  </button>
                </div>
                <div
                  className="GravityImportPreview-columnLabels"
                  role="row"
                  aria-label="Column labels"
                >
                  <span className="GravityImportPreview-columnLabels-spacer" />
                  <span className="GravityImportPreview-columnLabel GravityImportPreview-columnLabel--term">
                    {STRINGS.options.side_selector.term}
                  </span>
                  <span className="GravityImportPreview-columnLabel GravityImportPreview-columnLabel--definition">
                    {STRINGS.options.side_selector.definition}
                  </span>
                  <span className="GravityImportPreview-columnLabels-spacer--end" />
                </div>
                <div className="GravityImportPreview-table">
                  {visibleTerms.map((t, i) => (
                    <div key={t.id} className="GravityImportPreview-row">
                      <span className="GravityImportPreview-index">{i + 1}</span>
                      <input
                        className="GravityImportPreview-input GravityImportPreview-input--term"
                        type="text"
                        value={t.word}
                        placeholder="term"
                        onChange={(e) => updateTermWord(t.id, e.target.value)}
                        aria-label={`Row ${i + 1} term`}
                      />
                      <input
                        className="GravityImportPreview-input GravityImportPreview-input--definition"
                        type="text"
                        value={t.definition}
                        placeholder="definition"
                        onChange={(e) => updateTermDefinition(t.id, e.target.value)}
                        aria-label={`Row ${i + 1} definition`}
                      />
                      <button
                        type="button"
                        className={`GravityImportPreview-starRow ${t.starred ? 'is-starred' : ''}`}
                        onClick={() => toggleStarred(t.id)}
                        aria-pressed={!!t.starred}
                        aria-label={t.starred ? `Unstar row ${i + 1}` : `Star row ${i + 1}`}
                        title={t.starred ? 'Starred — will appear in Starred-only mode' : 'Click to star this term'}
                      >
                        ★
                      </button>
                      <button
                        type="button"
                        className="GravityImportPreview-deleteRow"
                        onClick={() => deleteTerm(t.id)}
                        aria-label={`Delete row ${i + 1}`}
                        title="Delete row"
                      >
                        ×
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}

            {error ? (
              <div className="GravityImportError" role="alert">
                {error}
              </div>
            ) : null}

            <div className="GravityImportActions">
              <button
                className="UIButton UIButton--hero"
                onClick={handleStart}
                disabled={terms.length < 2}
              >
                {STRINGS.import.start_button}
              </button>
              <button
                className="UIButton UIButton--default"
                onClick={() => {
                  setText('');
                  setFileName(null);
                  setError(null);
                }}
              >
                {STRINGS.import.clear_button}
              </button>
            </div>
          </div>

          {restored && lastSet ? (
            <div style={{ textAlign: 'center', marginTop: '1.5rem' }}>
              <button className="UILink" onClick={handleRestore}>
                {STRINGS.import.last_set} ({lastSet.terms.length} terms) →
              </button>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
