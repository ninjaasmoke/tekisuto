import {
  CSSProperties,
  FormEvent,
  KeyboardEvent,
  UIEvent,
  forwardRef,
  memo,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from 'react';
import { lineStarts, tokenizeJsonLine, updateLineStarts } from '@/lib/jsonHighlight';

const LINE_HEIGHT = 23.8;
const OVERSCAN = 8;

export type EditorHandle = {
  focus: () => void;
  getText: () => string;
  selectionStart: number;
  selectionEnd: number;
  setSelectionRange: (start: number, end: number) => void;
};

type Props = {
  documentText: string;
  documentVersion: number;
  highlight: boolean;
  onChange: (text: string) => void;
  onKeyDown: (event: KeyboardEvent<HTMLTextAreaElement>) => void;
  onSelect: () => void;
};

type Viewport = { top: number; left: number; height: number };
type Edit = { start: number; end: number };

const VirtualEditorInner = forwardRef<EditorHandle, Props>(function VirtualEditor({
  documentText,
  documentVersion,
  highlight,
  onChange,
  onKeyDown,
  onSelect,
}, ref) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const textRef = useRef(documentText);
  const startsRef = useRef(lineStarts(documentText));
  const pendingEdit = useRef<Edit | null>(null);
  const [viewport, setViewport] = useState<Viewport>({ top: 0, left: 0, height: 800 });
  const [paintVersion, setPaintVersion] = useState(0);

  useImperativeHandle(ref, () => ({
    focus: () => textareaRef.current?.focus(),
    getText: () => textRef.current,
    get selectionStart() { return textareaRef.current?.selectionStart || 0; },
    get selectionEnd() { return textareaRef.current?.selectionEnd || 0; },
    setSelectionRange: (start, end) => textareaRef.current?.setSelectionRange(start, end),
  }), []);

  useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea || textarea.value === documentText) return;
    textarea.value = documentText;
    textRef.current = documentText;
    startsRef.current = lineStarts(documentText);
    setPaintVersion((version) => version + 1);
  }, [documentText, documentVersion]);

  const measureViewport = useCallback((event?: UIEvent<HTMLTextAreaElement>) => {
    const textarea = event?.currentTarget || textareaRef.current;
    if (!textarea) return;
    setViewport({ top: textarea.scrollTop, left: textarea.scrollLeft, height: textarea.clientHeight });
  }, []);

  const handleInput = (event: FormEvent<HTMLTextAreaElement>) => {
    const nextText = event.currentTarget.value;
    const edit = pendingEdit.current;
    if (edit) {
      const nextEnd = nextText.length - (textRef.current.length - edit.end);
      startsRef.current = updateLineStarts(startsRef.current, nextText, edit.start, edit.end, nextEnd);
    } else {
      startsRef.current = lineStarts(nextText);
    }
    pendingEdit.current = null;
    textRef.current = nextText;
    setPaintVersion((version) => version + 1);
    onChange(nextText);
  };

  const firstLine = Math.max(0, Math.floor(viewport.top / LINE_HEIGHT) - OVERSCAN);
  const lastLine = Math.min(
    startsRef.current.length,
    Math.ceil((viewport.top + viewport.height) / LINE_HEIGHT) + OVERSCAN,
  );
  const visibleLines = [];
  if (highlight) {
    for (let line = firstLine; line < lastLine; line += 1) {
      const start = startsRef.current[line];
      const end = (startsRef.current[line + 1] ?? textRef.current.length + 1) - 1;
      visibleLines.push(textRef.current.slice(start, Math.max(start, end)));
    }
  }

  const overlayStyle: CSSProperties = {
    transform: `translate(${-viewport.left}px, ${firstLine * LINE_HEIGHT - viewport.top}px)`,
  };

  return (
    <div className={`virtual-editor${highlight ? ' is-highlighted' : ''}`}>
      {highlight && (
        <pre className="highlight-layer" style={overlayStyle} aria-hidden="true" data-paint={paintVersion}>
          {visibleLines.map((line, lineIndex) => (
            <div className="highlight-line" key={firstLine + lineIndex}>
              {tokenizeJsonLine(line).map((token, tokenIndex) => (
                <span className={`json-${token.kind}`} key={tokenIndex}>{token.text}</span>
              ))}
              {'\n'}
            </div>
          ))}
        </pre>
      )}
      <textarea
        ref={textareaRef}
        className="editor"
        aria-label="File contents"
        defaultValue={documentText}
        onBeforeInput={(event) => {
          pendingEdit.current = {
            start: event.currentTarget.selectionStart,
            end: event.currentTarget.selectionEnd,
          };
        }}
        onInput={handleInput}
        onKeyDown={onKeyDown}
        onSelect={onSelect}
        onClick={onSelect}
        onScroll={measureViewport}
        placeholder="Start typing, or drop a file here…"
        autoFocus
        spellCheck={false}
        wrap="off"
      />
    </div>
  );
});

export const VirtualEditor = memo(VirtualEditorInner, (previous, next) => (
  previous.documentVersion === next.documentVersion
  && previous.highlight === next.highlight
));
