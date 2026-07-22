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

type Viewport = {
  top: number;
  left: number;
  width: number;
  height: number;
  lineHeight: number;
  characterWidth: number;
};
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
  const metricsRef = useRef({ lineHeight: 23.8, characterWidth: 8.4 });
  const [viewport, setViewport] = useState<Viewport>({
    top: 0,
    left: 0,
    width: 1200,
    height: 800,
    lineHeight: 23.8,
    characterWidth: 8.4,
  });
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

  useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    const measure = () => {
      const styles = getComputedStyle(textarea);
      const canvas = document.createElement('canvas');
      const context = canvas.getContext('2d');
      if (context) {
        context.font = `${styles.fontStyle} ${styles.fontWeight} ${styles.fontSize} ${styles.fontFamily}`;
      }
      metricsRef.current = {
        lineHeight: Number.parseFloat(styles.lineHeight) || 23.8,
        characterWidth: context?.measureText('0').width || 8.4,
      };
      setViewport((current) => ({
        ...current,
        width: textarea.clientWidth,
        height: textarea.clientHeight,
        ...metricsRef.current,
      }));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(textarea);
    void document.fonts?.ready.then(measure);
    return () => observer.disconnect();
  }, []);

  const measureViewport = useCallback((event?: UIEvent<HTMLTextAreaElement>) => {
    const textarea = event?.currentTarget || textareaRef.current;
    if (!textarea) return;
    setViewport({
      top: textarea.scrollTop,
      left: textarea.scrollLeft,
      width: textarea.clientWidth,
      height: textarea.clientHeight,
      ...metricsRef.current,
    });
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

  const firstLine = Math.max(0, Math.floor(viewport.top / viewport.lineHeight) - OVERSCAN);
  const lastLine = Math.min(
    startsRef.current.length,
    Math.ceil((viewport.top + viewport.height) / viewport.lineHeight) + OVERSCAN,
  );
  const visibleLines = [];
  const firstColumn = Math.max(0, Math.floor(viewport.left / viewport.characterWidth) - 100);
  const lastColumn = Math.ceil((viewport.left + viewport.width) / viewport.characterWidth) + 100;
  if (highlight) {
    for (let line = firstLine; line < lastLine; line += 1) {
      const start = startsRef.current[line];
      const end = (startsRef.current[line + 1] ?? textRef.current.length + 1) - 1;
      visibleLines.push(textRef.current.slice(
        Math.min(start + firstColumn, end),
        Math.min(start + lastColumn, Math.max(start, end)),
      ));
    }
  }

  const overlayStyle: CSSProperties = {
    transform: `translate(${-viewport.left}px, ${firstLine * viewport.lineHeight - viewport.top}px)`,
  };

  return (
    <div className={`virtual-editor${highlight ? ' is-highlighted' : ''}`}>
      {highlight && (
        <pre className="highlight-layer" style={overlayStyle} aria-hidden="true" data-paint={paintVersion}>
          {visibleLines.map((line, lineIndex) => (
            <div
              className="highlight-line"
              key={firstLine + lineIndex}
              style={{ paddingLeft: firstColumn * viewport.characterWidth }}
            >
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
