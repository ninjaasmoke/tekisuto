import assert from 'node:assert/strict';
import test from 'node:test';
import {
  lineIndexAtOffset,
  lineStarts,
  tokenizeJsonLine,
  updateLineStarts,
} from '../lib/jsonHighlight.ts';

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

test('finds a cursor line without scanning document contents', () => {
  const starts = lineStarts('one\ntwo\nthree');
  assert.equal(lineIndexAtOffset(starts, 0), 0);
  assert.equal(lineIndexAtOffset(starts, 6), 1);
  assert.equal(lineIndexAtOffset(starts, 8), 2);
  assert.equal(lineIndexAtOffset(starts, 100), 2);
});

test('updates line offsets without sorting the unchanged suffix', () => {
  const before = 'a\nb\nc\nd';
  const after = 'a\nlonger\nc\nd';
  assert.deepEqual(
    updateLineStarts(lineStarts(before), after, 2, 3, 8),
    lineStarts(after),
  );
});
