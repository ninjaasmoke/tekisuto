import assert from 'node:assert/strict';
import test from 'node:test';
import { lineStarts, tokenizeJsonLine, updateLineStarts } from '../lib/jsonHighlight.ts';

test('tokenizes JSON without producing markup', () => {
  const source = '{"unsafe":"<img onerror=alert(1)>","count":12,"ok":true}';
  const tokens = tokenizeJsonLine(source);
  assert.equal(tokens.map((token) => token.text).join(''), source);
  assert.equal(tokens.find((token) => token.kind === 'key')?.text, '"unsafe"');
  assert.equal(tokens.some((token) => token.text.includes('<img')), true);
});

test('updates line offsets around a local edit', () => {
  const before = 'one\ntwo\nthree';
  const after = 'one\nnew\nline\nthree';
  assert.deepEqual(
    updateLineStarts(lineStarts(before), after, 4, 7, 12),
    lineStarts(after),
  );
});
