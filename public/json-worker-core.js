(function exposeJsonWorkerCore(scope) {
  const INPUT_LIMIT = 64 * 1024 * 1024;
  const OUTPUT_LIMIT = 128 * 1024 * 1024;
  const SLICE_SIZE = 256 * 1024;

  function syntaxError(message, index) {
    return new Error(`${message} at position ${index}`);
  }

  async function processJson(source, mode, isCancelled = () => false) {
    if (source.length > INPUT_LIMIT) throw new Error('File exceeds the 64 MiB processing limit');

    const stack = [];
    const output = [];
    let outputLength = 0;
    let rootState = 'value';
    let index = 0;
    let sliceEnd = SLICE_SIZE;

    const append = (value) => {
      if (mode === 'validate') return;
      outputLength += value.length;
      if (outputLength > OUTPUT_LIMIT) throw new Error('Formatted output exceeds the 128 MiB limit');
      output.push(value);
    };
    const indent = () => '  '.repeat(stack.length);
    const parent = () => stack[stack.length - 1];
    const acceptValue = () => {
      const frame = parent();
      if (!frame) {
        if (rootState !== 'value') throw syntaxError('Unexpected value', index);
        rootState = 'done';
      } else if (frame.type === 'object' && frame.state === 'value') {
        frame.state = 'commaOrEnd';
      } else if (frame.type === 'array' && (frame.state === 'valueOrEnd' || frame.state === 'value')) {
        frame.state = 'commaOrEnd';
      } else {
        throw syntaxError('Unexpected value', index);
      }
    };

    while (index < source.length) {
      if (index >= sliceEnd) {
        await new Promise((resolve) => setTimeout(resolve, 0));
        if (isCancelled()) throw new Error('Cancelled');
        sliceEnd = index + SLICE_SIZE;
      }
      if (/\s/.test(source[index])) {
        index += 1;
        continue;
      }

      const start = index;
      const character = source[index];
      if (character === '"') {
        index += 1;
        while (index < source.length && source[index] !== '"') {
          if (source.charCodeAt(index) < 32) throw syntaxError('Unescaped control character', index);
          if (source[index] === '\\') {
            index += 1;
            if (!'"\\/bfnrtu'.includes(source[index] || '')) throw syntaxError('Invalid escape', index);
            if (source[index] === 'u') {
              const unicode = source.slice(index + 1, index + 5);
              if (!/^[\da-fA-F]{4}$/.test(unicode)) throw syntaxError('Invalid Unicode escape', index);
              index += 4;
            }
          }
          index += 1;
        }
        if (source[index] !== '"') throw syntaxError('Unterminated string', start);
        index += 1;
        const value = source.slice(start, index);
        const frame = parent();
        if (frame?.type === 'object' && (frame.state === 'keyOrEnd' || frame.state === 'key')) {
          frame.state = 'colon';
          append(value);
        } else {
          acceptValue();
          append(value);
        }
      } else if (character === '{' || character === '[') {
        acceptValue();
        append(character);
        stack.push({
          type: character === '{' ? 'object' : 'array',
          state: character === '{' ? 'keyOrEnd' : 'valueOrEnd',
        });
        if (mode === 'format') append(`\n${indent()}`);
        index += 1;
      } else if (character === '}' || character === ']') {
        const frame = parent();
        const expectedType = character === '}' ? 'object' : 'array';
        if (!frame || frame.type !== expectedType) throw syntaxError('Unexpected closing bracket', index);
        const mayClose = frame.state === 'commaOrEnd'
          || (frame.type === 'object' ? frame.state === 'keyOrEnd' : frame.state === 'valueOrEnd');
        if (!mayClose) throw syntaxError('Unexpected closing bracket', index);
        stack.pop();
        if (mode === 'format') {
          const isEmpty = frame.state === 'keyOrEnd' || frame.state === 'valueOrEnd';
          if (isEmpty) outputLength -= output.pop().length;
          else append(`\n${indent()}`);
        }
        append(character);
        index += 1;
      } else if (character === ':') {
        const frame = parent();
        if (!frame || frame.type !== 'object' || frame.state !== 'colon') throw syntaxError('Unexpected colon', index);
        frame.state = 'value';
        append(mode === 'format' ? ': ' : ':');
        index += 1;
      } else if (character === ',') {
        const frame = parent();
        if (!frame || frame.state !== 'commaOrEnd') throw syntaxError('Unexpected comma', index);
        frame.state = frame.type === 'object' ? 'key' : 'value';
        append(',');
        if (mode === 'format') append(`\n${indent()}`);
        index += 1;
      } else {
        const remaining = source.slice(index);
        const token = /^(?:-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?|true|false|null)/.exec(remaining);
        if (!token) throw syntaxError('Unexpected token', index);
        const nextCharacter = source[index + token[0].length];
        if (nextCharacter && !/[\s,\]}]/.test(nextCharacter)) throw syntaxError('Invalid value', index);
        acceptValue();
        append(token[0]);
        index += token[0].length;
      }
    }

    if (stack.length || rootState !== 'done') throw syntaxError('Incomplete JSON', index);
    return mode === 'validate' ? null : output.join('');
  }

  const core = { INPUT_LIMIT, OUTPUT_LIMIT, processJson };
  scope.JsonWorkerCore = core;
  if (typeof module !== 'undefined') module.exports = core;
}(typeof self !== 'undefined' ? self : globalThis));
