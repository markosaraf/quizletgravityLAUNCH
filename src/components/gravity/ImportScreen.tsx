'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
import { importedCardsToTerms } from '@/lib/gravity/import-cards';
import { STRINGS, format } from '@/lib/gravity/strings';
import type { GravitySet, GravityTerm } from '@/lib/gravity/types';

interface Props {
  onStart: (set: GravitySet, terms: GravityTerm[]) => void;
}

const SAMPLE = 'helio-, sun\ngeo-, earth\nbio-, life\nchrom-, color';

const SEPARATOR_ORDER: Separator[] = ['comma', 'semicolon', 'dash'];
const THEME_ORDER: Theme[] = ['light', 'dark'];
type ImportTab = 'quizlet' | 'paste' | 'file';

/** Progress-bar animation: elapsed time (ms) → whole-number percentage
 *  0–97. Exponential ease — moves fast at first (the import usually finishes
 *  in 1–5 s) and creeps slowly later, so the bar never looks frozen during a
 *  request. 100% is only ever shown on real completion. */
const progressAfterMs = (elapsedMs: number): number =>
  Math.round(Math.min(97, 100 * (1 - Math.exp(-elapsedMs / 11_000))));

/** Hard client-side cap — matches the server's 60 s function budget with
 *  headroom, so a hung request can never freeze the UI forever. */
const IMPORT_ABORT_MS = 75_000;
/** How often the progress bar re-renders while an import is in flight. */
const PROGRESS_TICK_MS = 150;
/** How long a completed (100%) bar stays on screen before hiding. */
const PROGRESS_FADE_MS = 700;

export function ImportScreen({ onStart }: Props) {
  const [tab, setTab] = useState<ImportTab>('quizlet');
  const [text, setText] = useState('');
  const [fileName, setFileName] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Structured cards remain intact until the user replaces the pasted text/file.
  const [structuredImport, setStructuredImport] = useState(false);
  const [terms, setTerms] = useState<GravityTerm[]>([]);

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

  // Public Quizlet imports use one server request. Keep the returned cards
  // structured: serializing and parsing TSV would split embedded newlines/tabs.
  const quizletOpen = tab === 'quizlet';
  const [quizletUrl, setQuizletUrl] = useState('');
  const [quizletBusy, setQuizletBusy] = useState(false);
  const [quizletStatus, setQuizletStatus] = useState<string | null>(null);
  const [quizletError, setQuizletError] = useState<string | null>(null);
  const [quizletProgress, setQuizletProgress] = useState<number | null>(null);
  const quizletRequestRef = useRef<AbortController | null>(null);
  const quizletAbortTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const quizletTickerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const quizletFadeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => {
    quizletRequestRef.current?.abort();
    quizletRequestRef.current = null;
    if (quizletAbortTimerRef.current !== null) clearTimeout(quizletAbortTimerRef.current);
    if (quizletTickerRef.current !== null) clearInterval(quizletTickerRef.current);
    if (quizletFadeTimerRef.current !== null) clearTimeout(quizletFadeTimerRef.current);
  }, []);

  const applyQuizletResult = useCallback(
    (data: { title?: unknown; cards?: unknown; skipped?: unknown }) => {
      const importedTerms = importedCardsToTerms(data?.cards);
      if (importedTerms === null) throw new Error(STRINGS.import.quizlet.error_generic);
      if (importedTerms.length < 2) throw new Error(STRINGS.import.error_single);
      setStructuredImport(true);
      setTerms(importedTerms);
      // This text is only an editable view; it is parsed after an explicit edit.
      setText(importedTerms.map((card) => `${card.word}\t${card.definition}`).join('\n'));
      const title = typeof data?.title === 'string' ? data.title : 'Quizlet set';
      setFileName(title);
      setTab('quizlet');
      setError(null);
      const skippedNote =
        typeof data?.skipped === 'number' && data.skipped > 0
          ? format(STRINGS.import.quizlet.skipped_note, { count: data.skipped })
          : '';
      setQuizletStatus(
        format(STRINGS.import.quizlet.success, { count: importedTerms.length, title }) + skippedNote,
      );
      setQuizletProgress(100);
      quizletFadeTimerRef.current = setTimeout(() => {
        setQuizletProgress(null);
        quizletFadeTimerRef.current = null;
      }, PROGRESS_FADE_MS);
    },
    [],
  );

  const handleQuizletImport = useCallback(async () => {
    // A ref closes the double-click/Enter gap before React updates disabled.
    if (quizletRequestRef.current !== null) return;
    const link = quizletUrl.trim();
    if (!link) {
      setQuizletError(STRINGS.import.quizlet.error_no_url);
      return;
    }
    const controller = new AbortController();
    quizletRequestRef.current = controller;
    if (quizletFadeTimerRef.current !== null) {
      clearTimeout(quizletFadeTimerRef.current);
      quizletFadeTimerRef.current = null;
    }
    setQuizletBusy(true);
    setQuizletError(null);
    setQuizletStatus(null);
    setQuizletProgress(0);
    const abortTimer = setTimeout(() => controller.abort(), IMPORT_ABORT_MS);
    quizletAbortTimerRef.current = abortTimer;
    const startedAt = Date.now();
    const ticker = setInterval(() => {
      setQuizletProgress(progressAfterMs(Date.now() - startedAt));
    }, PROGRESS_TICK_MS);
    quizletTickerRef.current = ticker;

    try {
      const res = await fetch('/api/import-quizlet', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: link }),
        signal: controller.signal,
      });
      const data = await res.json();
      if (quizletRequestRef.current !== controller) return;
      if (!res.ok) {
        throw new Error(
          typeof data?.error === 'string' ? data.error : STRINGS.import.quizlet.error_generic,
        );
      }
      applyQuizletResult(data);
    } catch (err) {
      if (quizletRequestRef.current !== controller) return;
      setQuizletProgress(null);
      setQuizletError(
        controller.signal.aborted
          ? STRINGS.import.quizlet.error_timeout
          : err instanceof Error && !(err instanceof SyntaxError) && !(err instanceof TypeError) && err.message
            ? err.message
            : STRINGS.import.quizlet.error_generic,
      );
    } finally {
      clearInterval(ticker);
      clearTimeout(abortTimer);
      if (quizletRequestRef.current === controller) {
        quizletRequestRef.current = null;
        quizletAbortTimerRef.current = null;
        quizletTickerRef.current = null;
        setQuizletBusy(false);
      }
    }
  }, [quizletUrl, applyQuizletResult]);

  // Reparse manual paste/CSV sources when their inputs change. Imported card
  // values and preview edits survive separator or tab changes until replaced.
  const [lastSource, setLastSource] = useState<{
    text: string;
    tab: ImportTab;
    separator: Separator;
    structuredImport: boolean;
  }>({ text: '', tab: 'quizlet', separator: 'comma', structuredImport: false });
  if (
    lastSource.text !== text ||
    lastSource.tab !== tab ||
    lastSource.separator !== separator ||
    lastSource.structuredImport !== structuredImport
  ) {
    setLastSource({ text, tab, separator, structuredImport });
    if (!structuredImport && tab !== 'quizlet') {
      setTerms(
        tab === 'paste'
          ? parsePastedList(text, separator)
          : parseCsv(text, separator).terms,
      );
    }
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
      setStructuredImport(false);
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

            {/* One selected import method; the editable preview is shared. */}
            <div className="GravityImportTopbar">
              <button
                type="button"
                className={`GravityImportQuizlet-button ${quizletOpen ? 'is-open' : ''}`}
                onClick={() => {
                  setTab('quizlet');
                  setQuizletError(null);
                  setError(null);
                }}
                aria-pressed={quizletOpen}
                aria-expanded={quizletOpen}
                aria-controls="quizlet-import-panel"
              >
                {STRINGS.import.quizlet.button}
              </button>

              <div className="GravityImportTabs">
                <button
                  type="button"
                  className={`GravityImportTab ${tab === 'paste' ? 'is-active' : ''}`}
                  aria-pressed={tab === 'paste'}
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
                  aria-pressed={tab === 'file'}
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
                same preview table used by paste/CSV. */}
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
                    clicked until the request settles, so it's always obvious
                    that something is happening during long imports. */}
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
                    <p className="GravityImportQuizlet-hint">
                      {STRINGS.import.quizlet.manual_fallback}
                    </p>
                  </div>
                ) : null}
              </div>
            ) : null}

            {!quizletOpen ? (
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
            ) : null}

            {tab === 'paste' ? (
              <>
                <textarea
                  className="GravityImportTextarea"
                  value={text}
                  placeholder={SAMPLE}
                  onChange={(e) => {
                    setStructuredImport(false);
                    setText(e.target.value);
                    setError(null);
                  }}
                  aria-label={STRINGS.import.paste_tab}
                />
                <p className="GravityImportMeta">
                  {structuredImport ? STRINGS.import.quizlet.imported_hint : STRINGS.import.meta_paste}
                </p>
              </>
            ) : tab === 'file' ? (
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
            ) : null}

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
                      {structuredImport ? (
                        <textarea
                          className="GravityImportPreview-input GravityImportPreview-input--term"
                          rows={Math.min(4, t.word.split(/\r?\n/).length)}
                          style={{ resize: 'vertical' }}
                          value={t.word}
                          placeholder="term"
                          onChange={(e) => updateTermWord(t.id, e.target.value)}
                          aria-label={`Row ${i + 1} term`}
                        />
                      ) : (
                        <input
                          className="GravityImportPreview-input GravityImportPreview-input--term"
                          type="text"
                          value={t.word}
                          placeholder="term"
                          onChange={(e) => updateTermWord(t.id, e.target.value)}
                          aria-label={`Row ${i + 1} term`}
                        />
                      )}
                      {structuredImport ? (
                        <textarea
                          className="GravityImportPreview-input GravityImportPreview-input--definition"
                          rows={Math.min(4, t.definition.split(/\r?\n/).length)}
                          style={{ resize: 'vertical' }}
                          value={t.definition}
                          placeholder="definition"
                          onChange={(e) => updateTermDefinition(t.id, e.target.value)}
                          aria-label={`Row ${i + 1} definition`}
                        />
                      ) : (
                        <input
                          className="GravityImportPreview-input GravityImportPreview-input--definition"
                          type="text"
                          value={t.definition}
                          placeholder="definition"
                          onChange={(e) => updateTermDefinition(t.id, e.target.value)}
                          aria-label={`Row ${i + 1} definition`}
                        />
                      )}
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
                  setStructuredImport(false);
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
