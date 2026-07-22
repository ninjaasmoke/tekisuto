const assert = require('node:assert/strict');
const test = require('node:test');
const { processJson } = require('../public/json-worker-core.js');

test('formats and minifies JSON without evaluating content', async () => {
  const source = '{"html":"<script>alert(1)</script>","number":9007199254740993}';
  const formatted = await processJson(source, 'format');
  assert.equal(formatted.includes('<script>'), true);
  assert.equal(await processJson(formatted, 'minify'), source);
});

test('rejects malformed JSON', async () => {
  await assert.rejects(processJson('{"a":1,}', 'validate'), /closing bracket/);
  await assert.rejects(processJson('{"a":"\\x"}', 'validate'), /Invalid escape/);
});
