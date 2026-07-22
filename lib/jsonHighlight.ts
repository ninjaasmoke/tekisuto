export type JsonToken = {
  kind: 'key' | 'string' | 'number' | 'literal' | 'punctuation' | 'plain';
  text: string;
};

const NUMBER = /-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/y;

export function tokenizeJsonLine(line: string): JsonToken[] {
  const tokens: JsonToken[] = [];
  let index = 0;

  const push = (kind: JsonToken['kind'], text: string) => {
    if (!text) return;
    const previous = tokens.at(-1);
    if (previous?.kind === kind) previous.text += text;
    else tokens.push({ kind, text });
  };

  while (index < line.length) {
    const character = line[index];
    if (character === '"') {
      const start = index++;
      let escaped = false;
      while (index < line.length) {
        const current = line[index++];
        if (current === '"' && !escaped) break;
        escaped = current === '\\' && !escaped;
        if (current !== '\\') escaped = false;
      }
      let lookahead = index;
      while (/\s/.test(line[lookahead] || '')) lookahead += 1;
      push(line[lookahead] === ':' ? 'key' : 'string', line.slice(start, index));
    } else if ('{}[],:'.includes(character)) {
      push('punctuation', character);
      index += 1;
    } else if (character === '-' || /\d/.test(character)) {
      NUMBER.lastIndex = index;
      const match = NUMBER.exec(line);
      if (match) {
        push('number', match[0]);
        index = NUMBER.lastIndex;
      } else {
        push('plain', character);
        index += 1;
      }
    } else {
      const literal = /^(true|false|null)/.exec(line.slice(index));
      if (literal) {
        push('literal', literal[0]);
        index += literal[0].length;
      } else {
        push('plain', character);
        index += 1;
      }
    }
  }
  return tokens;
}

export function lineStarts(source: string) {
  const starts = [0];
  for (let index = 0; index < source.length; index += 1) {
    if (source.charCodeAt(index) === 10) starts.push(index + 1);
  }
  return starts;
}

export function updateLineStarts(
  previous: number[],
  source: string,
  editStart: number,
  previousEnd: number,
  nextEnd: number,
) {
  const delta = nextEnd - editStart - (previousEnd - editStart);
  const next: number[] = [];
  for (const start of previous) {
    if (start <= editStart) next.push(start);
    else if (start > previousEnd) next.push(start + delta);
  }
  for (let index = editStart; index < nextEnd; index += 1) {
    if (source.charCodeAt(index) === 10) next.push(index + 1);
  }
  next.sort((left, right) => left - right);
  return next.filter((start, index) => index === 0 || start !== next[index - 1]);
}
