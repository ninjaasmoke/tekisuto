importScripts('/json-worker-core.js');

let activeId = 0;

self.onmessage = async (event) => {
  const { id, mode, source } = event.data;
  activeId = id;
  try {
    const output = await self.JsonWorkerCore.processJson(source, mode, () => activeId !== id);
    if (activeId === id) self.postMessage({ id, ok: true, output });
  } catch (error) {
    if (activeId === id) self.postMessage({ id, ok: false, error: error.message });
  }
};
