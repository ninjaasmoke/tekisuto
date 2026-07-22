const { performance } = require('node:perf_hooks');
const { processJson } = require('../public/json-worker-core.js');

const TARGET_MIB = Number(process.env.JSON_BENCHMARK_MIB || 16);
const row = '{"id":123456789,"active":true,"name":"tekisuto","tags":["fast","local"]}';
const source = `[${Array(Math.ceil(TARGET_MIB * 1024 * 1024 / (row.length + 1))).fill(row).join(',')}]`;

async function measure(label, action) {
  const started = performance.now();
  await action();
  console.log(`${label}: ${(performance.now() - started).toFixed(1)} ms`);
}

(async () => {
  console.log(`Fixture: ${(source.length / 1024 / 1024).toFixed(1)} MiB`);
  await measure('open/index', () => {
    const starts = [0];
    for (let index = 0; index < source.length; index += 1) if (source.charCodeAt(index) === 10) starts.push(index + 1);
  });
  await measure('typing splice', () => `${source.slice(0, 100)}x${source.slice(100)}`);
  await measure('visible scroll slice', () => source.slice(2_000_000, 2_010_000));
  await measure('validate', () => processJson(source, 'validate'));
  await measure('format', () => processJson(source, 'minify'));
  console.log(`heap: ${(process.memoryUsage().heapUsed / 1024 / 1024).toFixed(1)} MiB`);
  console.log('Targets: typing/scroll <16 ms; open <1000 ms; format/validate non-blocking in the browser worker.');
})();
