import {
  ClipboardEvent,
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
import {
  lineIndexAtOffset,
  lineStarts,
  tokenizeJsonLine,
  updateLineStarts,
} from '@/lib/jsonHighlight';

const OVERSCAN = 8;
const NATIVE_SELECT_ALL_LIMIT = 1024 * 1024;

export type EditorHandle = {
  focus: () => void;
  getText: () => string;
  selectionStart: number;
  selectionEnd: number;
  getCursor: () => { line: number; column: number; selected: number };
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
  const scrollFrameRef = useRef<number | null>(null);
  const allSelectedRef = useRef(false);
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
  const [allSelected, setAllSelected] = useState(false);

  useImperativeHandle(ref, () => ({
    focus: () => textareaRef.current?.focus(),
    getText: () => textRef.current,
    get selectionStart() { return allSelectedRef.current ? 0 : textareaRef.current?.selectionStart || 0; },
    get selectionEnd() { return allSelectedRef.current ? textRef.current.length : textareaRef.current?.selectionEnd || 0; },
    getCursor: () => {
      const start = allSelectedRef.current ? 0 : textareaRef.current?.selectionStart || 0;
      const end = allSelectedRef.current ? textRef.current.length : textareaRef.current?.selectionEnd || 0;
      const lineIndex = lineIndexAtOffset(startsRef.current, start);
      return {
        line: lineIndex + 1,
        column: start - startsRef.current[lineIndex] + 1,
        selected: end - start,
      };
    },
    setSelectionRange: (start, end) => {
      allSelectedRef.current = false;
      setAllSelected(false);
      textareaRef.current?.setSelectionRange(start, end);
    },
  }), []);

  useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea || textarea.value === documentText) return;
    textarea.value = documentText;
    textRef.current = documentText;
    startsRef.current = lineStarts(documentText);
    allSelectedRef.current = false;
    setAllSelected(false);
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
    if (!textarea || scrollFrameRef.current !== null) return;
    scrollFrameRef.current = requestAnimationFrame(() => {
      scrollFrameRef.current = null;
      const current = textareaRef.current;
      if (!current) return;
      const next = {
        top: current.scrollTop,
        left: current.scrollLeft,
        width: current.clientWidth,
        height: current.clientHeight,
        ...metricsRef.current,
      };
      setViewport((previous) => (
        previous.top === next.top
        && previous.left === next.left
        && previous.width === next.width
        && previous.height === next.height
        && previous.lineHeight === next.lineHeight
        && previous.characterWidth === next.characterWidth
          ? previous
          : next
      ));
    });
  }, []);

  useEffect(() => () => {
    if (scrollFrameRef.current !== null) cancelAnimationFrame(scrollFrameRef.current);
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
    allSelectedRef.current = false;
    setAllSelected(false);
    textRef.current = nextText;
    setPaintVersion((version) => version + 1);
    onChange(nextText);
  };

  const replaceAllSelection = (replacement: string) => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    textarea.value = replacement;
    textRef.current = replacement;
    startsRef.current = lineStarts(replacement);
    pendingEdit.current = null;
    allSelectedRef.current = false;
    setAllSelected(false);
    textarea.setSelectionRange(replacement.length, replacement.length);
    setPaintVersion((version) => version + 1);
    onChange(replacement);
    onSelect();
  };

  const handleClipboard = (event: ClipboardEvent<HTMLTextAreaElement>, cut: boolean) => {
    if (!allSelectedRef.current) return;
    event.preventDefault();
    event.clipboardData.setData('text/plain', textRef.current);
    if (cut) replaceAllSelection('');
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
    <div className={`virtual-editor${highlight ? ' is-highlighted' : ''}${allSelected ? ' is-all-selected' : ''}`}>
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
          if (allSelectedRef.current) {
            const input = event.nativeEvent as InputEvent;
            let replacement: string | null = input.data;
            if (input.inputType.startsWith('delete')) replacement = '';
            else if (input.inputType === 'insertLineBreak' || input.inputType === 'insertParagraph') replacement = '\n';
            if (replacement !== null) {
              event.preventDefault();
              replaceAllSelection(replacement);
              return;
            }
          }
          pendingEdit.current = {
            start: event.currentTarget.selectionStart,
            end: event.currentTarget.selectionEnd,
          };
        }}
        onInput={handleInput}
        onKeyDown={(event) => {
          if (
            textRef.current.length > NATIVE_SELECT_ALL_LIMIT
            && (event.ctrlKey || event.metaKey)
            && event.key.toLowerCase() === 'a'
          ) {
            event.preventDefault();
            allSelectedRef.current = true;
            setAllSelected(true);
            onSelect();
            return;
          }
          onKeyDown(event);
        }}
        onCopy={(event) => handleClipboard(event, false)}
        onCut={(event) => handleClipboard(event, true)}
        onPaste={(event) => {
          if (!allSelectedRef.current) return;
          event.preventDefault();
          replaceAllSelection(event.clipboardData.getData('text/plain'));
        }}
        onSelect={onSelect}
        onClick={() => {
          if (allSelectedRef.current) {
            allSelectedRef.current = false;
            setAllSelected(false);
          }
          onSelect();
        }}
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
