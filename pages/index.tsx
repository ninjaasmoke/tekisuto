import Head from 'next/head';
import { ChangeEvent, DragEvent, KeyboardEvent, useCallback, useEffect, useRef, useState } from 'react';
import { EditorHandle, VirtualEditor } from '@/components/VirtualEditor';

type Format = 'txt' | 'md' | 'json' | 'csv' | 'custom';
type Theme = 'light' | 'dark';
type FileHandle = {
  name: string;
  createWritable: () => Promise<{ write: (data: string) => Promise<void>; close: () => Promise<void> }>;
};

declare global {
  interface Window {
    showOpenFilePicker?: (options?: object) => Promise<FileHandle[]>;
    showSaveFilePicker?: (options?: object) => Promise<FileHandle>;
  }
}

const STATS_LIMIT = 1024 * 1024;
const INTERACTIVE_LIMIT = 16 * 1024 * 1024;
const ANALYSIS_DELAY = 250;
const FORMATS: Record<Exclude<Format, 'custom'>, { label: string; mime: string }> = {
  txt: { label: 'Plain text', mime: 'text/plain' },
  md: { label: 'Markdown', mime: 'text/markdown' },
  json: { label: 'JSON', mime: 'application/json' },
  csv: { label: 'CSV', mime: 'text/csv' },
};

function extensionOf(name: string): Format {
  const extension = name.split('.').pop()?.toLowerCase();
  return extension === 'txt' || extension === 'md' || extension === 'json' || extension === 'csv'
    ? extension
    : 'custom';
}

function safeName(name: string, format: Format) {
  const cleaned = name.trim().replace(/[<>:"/\\|?*\u0000-\u001F]/g, '-').replace(/\.+$/, '');
  const fallback = format === 'custom' ? 'untitled.txt' : `untitled.${format}`;
  if (!cleaned) return fallback;
  if (cleaned.includes('.') || format === 'custom') return cleaned;
  return `${cleaned}.${format}`;
}

function downloadFile(text: string, name: string, mime: string) {
  const url = URL.createObjectURL(new Blob([text], { type: `${mime};charset=utf-8` }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = name;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

function parseCsv(source: string) {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;

  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    if (quoted) {
      if (character === '"' && source[index + 1] === '"') {
        field += '"';
        index += 1;
      } else if (character === '"') {
        quoted = false;
      } else {
        field += character;
      }
    } else if (character === '"') {
      quoted = true;
    } else if (character === ',') {
      row.push(field);
      field = '';
    } else if (character === '\n') {
      row.push(field.replace(/\r$/, ''));
      rows.push(row);
      row = [];
      field = '';
    } else {
      field += character;
    }
  }

  if (quoted) throw new Error('Unclosed quoted field');
  if (field || row.length || source.endsWith(',')) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

function normalizeCsv(source: string) {
  return parseCsv(source)
    .map((row) => row.map((field) => `"${field.replace(/"/g, '""')}"`).join(','))
    .join('\n');
}

function countMatches(source: string, needle: string) {
  if (!needle || source.length > INTERACTIVE_LIMIT) return [];
  const positions: number[] = [];
  let position = 0;
  while ((position = source.indexOf(needle, position)) !== -1) {
    positions.push(position);
    position += Math.max(needle.length, 1);
  }
  return positions;
}

export default function IndexPage() {
  const [documentText, setDocumentText] = useState('');
  const [documentVersion, setDocumentVersion] = useState(0);
  const [fileName, setFileName] = useState('untitled.txt');
  const [format, setFormat] = useState<Format>('txt');
  const [handle, setHandle] = useState<FileHandle | null>(null);
  const [dirty, setDirty] = useState(false);
  const [hasContent, setHasContent] = useState(false);
  const [words, setWords] = useState<number | null>(0);
  const [theme, setTheme] = useState<Theme>('dark');
  const [highlightJson, setHighlightJson] = useState(true);
  const [message, setMessage] = useState('');
  const [isDragging, setIsDragging] = useState(false);
  const [findOpen, setFindOpen] = useState(false);
  const [find, setFind] = useState('');
  const [replace, setReplace] = useState('');
  const [matches, setMatches] = useState<number[]>([]);
  const [matchIndex, setMatchIndex] = useState(-1);
  const [cursor, setCursor] = useState({ line: 1, column: 1, selected: 0 });
  const textareaRef = useRef<EditorHandle>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const findInputRef = useRef<HTMLInputElement>(null);
  const workerRef = useRef<Worker | null>(null);
  const workerJobRef = useRef(0);
  const analysisTimerRef = useRef<number | null>(null);
  const findRef = useRef(find);
  findRef.current = find;

  const currentText = useCallback(() => textareaRef.current?.getText() ?? documentText, [documentText]);

  const analyze = useCallback(() => {
    const source = textareaRef.current?.getText() ?? '';
    setHasContent(source.length > 0);
    setWords(source.length > STATS_LIMIT ? null : (source.trim() ? source.trim().split(/\s+/).length : 0));
    setMatches(countMatches(source, findRef.current));
  }, []);

  const scheduleAnalysis = useCallback(() => {
    if (analysisTimerRef.current !== null) return;
    analysisTimerRef.current = window.setTimeout(() => {
      analysisTimerRef.current = null;
      analyze();
    }, ANALYSIS_DELAY);
  }, [analyze]);

  const markChanged = useCallback((nextText: string) => {
    setDirty(true);
    setHasContent(nextText.length > 0);
    setMessage('');
    scheduleAnalysis();
  }, [scheduleAnalysis]);

  const replaceDocument = useCallback((nextText: string) => {
    setDocumentText(nextText);
    setDocumentVersion((version) => version + 1);
    setDirty(true);
    setMessage('');
  }, []);

  const loadFile = useCallback(async (file: File, nextHandle: FileHandle | null = null) => {
    if (dirty && !window.confirm('Discard unsaved changes and open another file?')) return;
    const contents = await file.text();
    setDocumentText(contents);
    setDocumentVersion((version) => version + 1);
    setFileName(file.name);
    setFormat(extensionOf(file.name));
    setHandle(nextHandle);
    setDirty(false);
    setMessage(`Opened ${file.name}`);
    requestAnimationFrame(() => textareaRef.current?.focus());
  }, [dirty]);

  const openFile = useCallback(async () => {
    try {
      if (window.showOpenFilePicker) {
        const [nextHandle] = await window.showOpenFilePicker();
        const file = await (nextHandle as FileHandle & { getFile: () => Promise<File> }).getFile();
        await loadFile(file, nextHandle);
      } else {
        fileInputRef.current?.click();
      }
    } catch (error) {
      if ((error as DOMException).name !== 'AbortError') setMessage('Could not open that file.');
    }
  }, [loadFile]);

  const save = useCallback(async (saveAs = false) => {
    const source = textareaRef.current?.getText() ?? '';
    if (!source) return;
    const name = safeName(fileName, format);
    const mime = format === 'custom' ? 'text/plain' : FORMATS[format].mime;
    try {
      let target = saveAs ? null : handle;
      if ((!target || saveAs) && window.showSaveFilePicker) {
        target = await window.showSaveFilePicker({
          suggestedName: name,
          types: [{ description: 'Text file', accept: { [mime]: [`.${name.split('.').pop() || 'txt'}`] } }],
        });
      }
      if (target) {
        const writable = await target.createWritable();
        await writable.write(source);
        await writable.close();
        setHandle(target);
        setFileName(target.name);
      } else {
        downloadFile(source, name, mime);
        setFileName(name);
      }
      setDirty(false);
      setMessage(`Saved ${target?.name || name}`);
    } catch (error) {
      if ((error as DOMException).name !== 'AbortError') setMessage('Save failed. The document was not changed.');
    }
  }, [fileName, format, handle]);

  const selectMatch = useCallback((direction: 1 | -1 = 1) => {
    if (!matches.length || !find) return;
    const next = direction === 1
      ? (matchIndex + 1) % matches.length
      : (matchIndex - 1 + matches.length) % matches.length;
    setMatchIndex(next);
    textareaRef.current?.focus();
    textareaRef.current?.setSelectionRange(matches[next], matches[next] + find.length);
  }, [find, matchIndex, matches]);

  const updateCursor = () => {
    const editor = textareaRef.current;
    if (!editor) return;
    setCursor(editor.getCursor());
  };

  useEffect(() => {
    setTheme(window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark');
  }, []);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  useEffect(() => {
    analyze();
  }, [analyze, documentVersion, find]);

  useEffect(() => () => {
    if (analysisTimerRef.current !== null) window.clearTimeout(analysisTimerRef.current);
  }, []);

  useEffect(() => {
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey)) return;
      const key = event.key.toLowerCase();
      if (key === 's') {
        event.preventDefault();
        void save(event.shiftKey);
      } else if (key === 'o') {
        event.preventDefault();
        void openFile();
      } else if (key === 'f') {
        event.preventDefault();
        setFindOpen(true);
        requestAnimationFrame(() => findInputRef.current?.focus());
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [openFile, save]);

  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => {
      if (dirty) {
        event.preventDefault();
        event.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  useEffect(() => {
    if (matchIndex >= matches.length) setMatchIndex(-1);
  }, [matchIndex, matches.length]);

  useEffect(() => () => workerRef.current?.terminate(), []);

  const processJson = (mode: 'validate' | 'format' | 'minify') => {
    const source = currentText();
    workerRef.current?.terminate();
    const worker = new Worker('/json.worker.js');
    const id = workerJobRef.current + 1;
    workerJobRef.current = id;
    workerRef.current = worker;
    setMessage(`${mode === 'validate' ? 'Validating' : 'Formatting'} JSON…`);
    worker.onmessage = (event: MessageEvent<{ id: number; ok: boolean; output?: string; error?: string }>) => {
      if (event.data.id !== workerJobRef.current) return;
      worker.terminate();
      workerRef.current = null;
      if (!event.data.ok) {
        setMessage(`Invalid JSON: ${event.data.error}`);
      } else if (mode === 'validate') {
        setMessage('Valid JSON');
      } else {
        replaceDocument(event.data.output || '');
        setMessage(mode === 'format' ? 'JSON formatted' : 'JSON minified');
      }
    };
    worker.onerror = () => {
      if (id === workerJobRef.current) setMessage('JSON processing failed. The document was not changed.');
      worker.terminate();
      workerRef.current = null;
    };
    worker.postMessage({ id, mode, source });
  };

  const transformCsv = () => {
    try {
      replaceDocument(normalizeCsv(currentText()));
      setMessage('CSV fields safely quoted');
    } catch (error) {
      setMessage(`Invalid CSV: ${(error as Error).message}`);
    }
  };

  const replaceCurrent = () => {
    const editor = textareaRef.current;
    if (!editor || !find) return;
    if (editor.getText().slice(editor.selectionStart, editor.selectionEnd) !== find) {
      selectMatch(1);
      return;
    }
    const start = editor.selectionStart;
    const currentText = editor.getText();
    replaceDocument(`${currentText.slice(0, start)}${replace}${currentText.slice(editor.selectionEnd)}`);
    requestAnimationFrame(() => editor.setSelectionRange(start, start + replace.length));
  };

  const replaceAll = () => {
    if (!find) return;
    replaceDocument(currentText().split(find).join(replace));
    setMessage(`Replaced ${matches.length} match${matches.length === 1 ? '' : 'es'}`);
  };

  const changeFormat = (next: Format) => {
    setFormat(next);
    if (next !== 'custom') {
      const base = fileName.replace(/\.[^.]+$/, '') || 'untitled';
      setFileName(`${base}.${next}`);
    }
  };

  const onEditorKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Tab') {
      event.preventDefault();
      const editor = textareaRef.current;
      if (!editor) return;
      const currentText = editor.getText();
      const start = editor.selectionStart;
      replaceDocument(`${currentText.slice(0, start)}  ${currentText.slice(editor.selectionEnd)}`);
      requestAnimationFrame(() => editor.setSelectionRange(start + 2, start + 2));
    }
  };

  const onDrop = async (event: DragEvent<HTMLElement>) => {
    event.preventDefault();
    setIsDragging(false);
    const file = event.dataTransfer.files[0];
    if (file) await loadFile(file);
  };

  const clearDocument = () => {
    if (dirty && !window.confirm('Discard your unsaved changes and clear this document?')) return;
    setDocumentText('');
    setDocumentVersion((version) => version + 1);
    setFileName('untitled.txt');
    setFormat('txt');
    setHandle(null);
    setDirty(false);
    setMessage('Document cleared');
    textareaRef.current?.focus();
  };

  return (
    <>
      <Head>
        <title>{dirty ? '● ' : ''}{fileName} — Tekisuto</title>
        <meta name="description" content="A fast, private text editor that keeps your files in your browser." />
        <meta name="theme-color" content={theme === 'dark' ? '#000000' : '#ffffff'} />
      </Head>
      <main
        className={`app-shell${isDragging ? ' is-dragging' : ''}`}
        onDragEnter={(event) => { event.preventDefault(); setIsDragging(true); }}
        onDragOver={(event) => event.preventDefault()}
        onDragLeave={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget as Node)) setIsDragging(false);
        }}
        onDrop={onDrop}
      >
        <header className="topbar">
          <a className="brand" href="#" aria-label="Tekisuto home">
            <span>tekisuto</span>
          </a>
          <div className="file-controls">
            <input
              className="filename"
              aria-label="File name"
              value={fileName}
              spellCheck={false}
              onChange={(event) => {
                setFileName(event.target.value);
                setFormat(extensionOf(event.target.value));
                setDirty(true);
              }}
            />
            <select aria-label="File type" value={format} onChange={(event) => changeFormat(event.target.value as Format)}>
              {Object.entries(FORMATS).map(([value, details]) => (
                <option key={value} value={value}>{details.label}</option>
              ))}
              <option value="custom">Custom</option>
            </select>
          </div>
          <nav className="actions" aria-label="File actions">
            <button className="button ghost" onClick={() => void openFile()} title="Open (Ctrl/⌘ O)">Open</button>
            <button className="button ghost desktop-action" onClick={() => setFindOpen((open) => !open)} title="Find (Ctrl/⌘ F)">Find</button>
            <details className="more-menu">
              <summary className="button ghost" aria-label="More actions">•••</summary>
              <div className="menu-panel">
                <button onClick={() => setFindOpen(true)}>Find &amp; replace</button>
                <button onClick={() => void save(true)} disabled={!hasContent}>Save as…</button>
                {format === 'json' && <button onClick={() => setHighlightJson((enabled) => !enabled)}>{highlightJson ? 'Disable' : 'Enable'} highlighting</button>}
                {format === 'json' && <button onClick={() => processJson('validate')} disabled={!hasContent}>Validate JSON</button>}
                {format === 'json' && <button onClick={() => processJson('format')} disabled={!hasContent}>Format JSON</button>}
                {format === 'json' && <button onClick={() => processJson('minify')} disabled={!hasContent}>Minify JSON</button>}
                {format === 'csv' && <button onClick={transformCsv} disabled={!hasContent}>Quote CSV fields</button>}
                <button onClick={clearDocument}>Clear document</button>
              </div>
            </details>
            <button className="theme-toggle" onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')} aria-label={`Use ${theme === 'dark' ? 'light' : 'dark'} theme`}>
              {theme === 'dark' ? '☼' : '☾'}
            </button>
            <button className="button primary" onClick={() => void save()} disabled={!hasContent} title="Save (Ctrl/⌘ S)">Save</button>
          </nav>
        </header>

        {findOpen && (
          <section className="findbar" aria-label="Find and replace">
            <label>
              <span className="sr-only">Find</span>
              <input ref={findInputRef} value={find} onChange={(event) => { setFind(event.target.value); setMatchIndex(-1); }} placeholder="Find" />
            </label>
            <span className="match-count">{matches.length ? `${matchIndex >= 0 ? matchIndex + 1 : '—'} / ${matches.length}` : 'No matches'}</span>
            <button onClick={() => selectMatch(-1)} aria-label="Previous match">↑</button>
            <button onClick={() => selectMatch(1)} aria-label="Next match">↓</button>
            <label>
              <span className="sr-only">Replace with</span>
              <input value={replace} onChange={(event) => setReplace(event.target.value)} placeholder="Replace with" />
            </label>
            <button onClick={replaceCurrent}>Replace</button>
            <button onClick={replaceAll}>All</button>
            <button onClick={() => setFindOpen(false)} aria-label="Close find and replace">×</button>
          </section>
        )}

        <section className="editor-wrap">
          <VirtualEditor
            ref={textareaRef}
            documentText={documentText}
            documentVersion={documentVersion}
            highlight={format === 'json' && highlightJson}
            onChange={markChanged}
            onKeyDown={onEditorKeyDown}
            onSelect={updateCursor}
          />
          {isDragging && <div className="drop-zone">Drop to open</div>}
        </section>

        <footer className="statusbar">
          <div className="status-group">
            <span className={`save-state${dirty ? ' unsaved' : ''}`}><i />{dirty ? 'Unsaved changes' : 'Saved'}</span>
            {message && <span className="message" role="status">{message}</span>}
          </div>
          <div className="status-group editor-stats">
            <span>Ln {cursor.line}, Col {cursor.column}</span>
            {cursor.selected > 0 && <span>{cursor.selected} selected</span>}
            <span>{words === null ? 'Large-file mode' : `${words} words`}</span>
          </div>
        </footer>

        <input
          ref={fileInputRef}
          className="sr-only"
          type="file"
          accept=".txt,.md,.json,.csv,text/*,application/json"
          onChange={(event: ChangeEvent<HTMLInputElement>) => {
            const file = event.target.files?.[0];
            if (file) void loadFile(file);
            event.target.value = '';
          }}
        />
      </main>
    </>
  );
}
