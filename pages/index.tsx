import Head from 'next/head';
import { ChangeEvent, DragEvent, KeyboardEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';

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

const DRAFT_KEY = 'tekisuto:draft';
const THEME_KEY = 'tekisuto:theme';
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

export default function IndexPage() {
  const [text, setText] = useState('');
  const [fileName, setFileName] = useState('untitled.txt');
  const [format, setFormat] = useState<Format>('txt');
  const [handle, setHandle] = useState<FileHandle | null>(null);
  const [dirty, setDirty] = useState(false);
  const [draftSynced, setDraftSynced] = useState(true);
  const [theme, setTheme] = useState<Theme>('dark');
  const [message, setMessage] = useState('');
  const [isDragging, setIsDragging] = useState(false);
  const [findOpen, setFindOpen] = useState(false);
  const [find, setFind] = useState('');
  const [replace, setReplace] = useState('');
  const [matchIndex, setMatchIndex] = useState(-1);
  const [cursor, setCursor] = useState({ line: 1, column: 1, selected: 0 });
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const findInputRef = useRef<HTMLInputElement>(null);

  const stats = useMemo(() => {
    const words = text.trim() ? text.trim().split(/\s+/).length : 0;
    return {
      characters: text.length,
      words,
      lines: text ? text.split('\n').length : 1,
      bytes: new Blob([text]).size,
    };
  }, [text]);

  const matches = useMemo(() => {
    if (!find) return [];
    const positions: number[] = [];
    let position = 0;
    while ((position = text.indexOf(find, position)) !== -1) {
      positions.push(position);
      position += Math.max(find.length, 1);
    }
    return positions;
  }, [find, text]);

  const markChanged = (nextText: string) => {
    setText(nextText);
    setDirty(true);
    setDraftSynced(false);
    setMessage('');
  };

  const loadFile = useCallback(async (file: File, nextHandle: FileHandle | null = null) => {
    const contents = await file.text();
    setText(contents);
    setFileName(file.name);
    setFormat(extensionOf(file.name));
    setHandle(nextHandle);
    setDirty(false);
    setDraftSynced(true);
    setMessage(`Opened ${file.name}`);
    requestAnimationFrame(() => textareaRef.current?.focus());
  }, []);

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
        await writable.write(text);
        await writable.close();
        setHandle(target);
        setFileName(target.name);
      } else {
        downloadFile(text, name, mime);
        setFileName(name);
      }
      setDirty(false);
      setMessage(`Saved ${target?.name || name}`);
    } catch (error) {
      if ((error as DOMException).name !== 'AbortError') setMessage('Save failed. Your draft is still safe.');
    }
  }, [fileName, format, handle, text]);

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
    const before = text.slice(0, editor.selectionStart);
    const lines = before.split('\n');
    setCursor({
      line: lines.length,
      column: (lines.at(-1)?.length || 0) + 1,
      selected: editor.selectionEnd - editor.selectionStart,
    });
  };

  useEffect(() => {
    const storedTheme = localStorage.getItem(THEME_KEY) as Theme | null;
    const preferred = window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
    setTheme(storedTheme || preferred);
    const draft = localStorage.getItem(DRAFT_KEY);
    if (draft) {
      try {
        const parsed = JSON.parse(draft) as { text: string; fileName: string };
        setText(parsed.text || '');
        setFileName(parsed.fileName || 'untitled.txt');
        setFormat(extensionOf(parsed.fileName || 'untitled.txt'));
        setDirty(Boolean(parsed.text));
        setMessage('Recovered your local draft');
      } catch {
        localStorage.removeItem(DRAFT_KEY);
      }
    }
  }, []);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem(THEME_KEY, theme);
  }, [theme]);

  useEffect(() => {
    if (draftSynced) return;
    const timer = window.setTimeout(() => {
      localStorage.setItem(DRAFT_KEY, JSON.stringify({ text, fileName }));
      setDraftSynced(true);
    }, 450);
    return () => window.clearTimeout(timer);
  }, [draftSynced, fileName, text]);

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

  const transformJson = (spaces?: number) => {
    try {
      const output = JSON.stringify(JSON.parse(text), null, spaces);
      markChanged(output);
      setMessage(spaces ? 'JSON formatted' : 'JSON minified');
    } catch (error) {
      setMessage(`Invalid JSON: ${(error as Error).message}`);
    }
  };

  const transformCsv = () => {
    try {
      markChanged(normalizeCsv(text));
      setMessage('CSV fields safely quoted');
    } catch (error) {
      setMessage(`Invalid CSV: ${(error as Error).message}`);
    }
  };

  const replaceCurrent = () => {
    const editor = textareaRef.current;
    if (!editor || editor.selectionStart === editor.selectionEnd || !find) return;
    const start = editor.selectionStart;
    markChanged(`${text.slice(0, start)}${replace}${text.slice(editor.selectionEnd)}`);
    requestAnimationFrame(() => editor.setSelectionRange(start, start + replace.length));
  };

  const replaceAll = () => {
    if (!find) return;
    markChanged(text.split(find).join(replace));
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
      const editor = event.currentTarget;
      const start = editor.selectionStart;
      markChanged(`${text.slice(0, start)}  ${text.slice(editor.selectionEnd)}`);
      requestAnimationFrame(() => editor.setSelectionRange(start + 2, start + 2));
    }
  };

  const onDrop = async (event: DragEvent<HTMLElement>) => {
    event.preventDefault();
    setIsDragging(false);
    const file = event.dataTransfer.files[0];
    if (file) await loadFile(file);
  };

  const clearDraft = () => {
    localStorage.removeItem(DRAFT_KEY);
    setText('');
    setFileName('untitled.txt');
    setFormat('txt');
    setHandle(null);
    setDirty(false);
    setDraftSynced(true);
    setMessage('Draft cleared');
    textareaRef.current?.focus();
  };

  return (
    <>
      <Head>
        <title>{dirty ? '● ' : ''}{fileName} — Tekisuto</title>
        <meta name="description" content="A fast, private text editor that keeps your files in your browser." />
        <meta name="theme-color" content={theme === 'dark' ? '#171816' : '#f2efe8'} />
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
            <span className="brand-mark" aria-hidden="true">T</span>
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
                setDraftSynced(false);
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
                <button onClick={() => void save(true)}>Save as…</button>
                {format === 'json' && <button onClick={() => transformJson(2)}>Format JSON</button>}
                {format === 'json' && <button onClick={() => transformJson()}>Minify JSON</button>}
                {format === 'csv' && <button onClick={transformCsv}>Quote CSV fields</button>}
                <button onClick={clearDraft}>Clear draft</button>
              </div>
            </details>
            <button className="theme-toggle" onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')} aria-label={`Use ${theme === 'dark' ? 'light' : 'dark'} theme`}>
              {theme === 'dark' ? '☼' : '☾'}
            </button>
            <button className="button primary" onClick={() => void save()} title="Save (Ctrl/⌘ S)">Save</button>
          </nav>
        </header>

        {findOpen && (
          <section className="findbar" aria-label="Find and replace">
            <label>
              <span className="sr-only">Find</span>
              <input ref={findInputRef} value={find} onChange={(event) => { setFind(event.target.value); setMatchIndex(-1); }} placeholder="Find" />
            </label>
            <span className="match-count">{matches.length ? `${Math.max(matchIndex + 1, 1)} / ${matches.length}` : 'No matches'}</span>
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
          <textarea
            ref={textareaRef}
            className="editor"
            aria-label="File contents"
            value={text}
            onChange={(event) => markChanged(event.target.value)}
            onKeyDown={onEditorKeyDown}
            onSelect={updateCursor}
            onClick={updateCursor}
            placeholder="Start typing, or drop a file here…"
            autoFocus
            spellCheck={false}
          />
          {isDragging && <div className="drop-zone">Drop to open</div>}
        </section>

        <footer className="statusbar">
          <div className="status-group">
            <span className={`save-state${dirty ? ' unsaved' : ''}`}><i />{dirty ? 'Unsaved changes' : 'Saved'}</span>
            <span>{draftSynced ? 'Draft safe' : 'Saving draft…'}</span>
            {message && <span className="message" role="status">{message}</span>}
          </div>
          <div className="status-group editor-stats">
            <span>Ln {cursor.line}, Col {cursor.column}</span>
            {cursor.selected > 0 && <span>{cursor.selected} selected</span>}
            <span>{stats.words} words</span>
            <span>{stats.characters} chars</span>
            <span>{stats.lines} lines</span>
            <span>{stats.bytes < 1024 ? `${stats.bytes} B` : `${(stats.bytes / 1024).toFixed(1)} KB`}</span>
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
