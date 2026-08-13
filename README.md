# Tekisuto

A fast, private browser-based text editor for opening, editing, and saving local files. Tekisuto has no backend and no persistence: file contents stay in the page and are never written to browser storage.

## Features

- Open files with the native picker or drag and drop
- Save directly to a local file where the File System Access API is available
- Download fallback for browsers without direct file access
- TXT, Markdown, JSON, CSV, and custom file extensions
- Unsaved-change protection before opening, clearing, or leaving a document
- Viewport-only JSON syntax highlighting, cancellable worker-based formatting and validation, safe CSV quoting, and find and replace
- Keyboard shortcuts, light and dark themes, and live document statistics

## Privacy and security

- File contents are processed entirely in the browser; Tekisuto has no upload or API endpoint.
- Opening and direct saving use browser-controlled file pickers, so access requires an explicit user action.
- Nothing is written to local storage, session storage, cookies, or any other persistent store; closing the tab discards the document.
- Production responses restrict scripts, network connections, framing, referrers, and sensitive browser permissions.

## Shortcuts

- `Ctrl/Cmd + S` — save
- `Ctrl/Cmd + Shift + S` — save as
- `Ctrl/Cmd + O` — open
- `Ctrl/Cmd + F` — find and replace

## Development

Node.js 24 is required.

Install dependencies and start the development server:

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) in your browser.

Run the project checks with:

```bash
npm run lint
npm run build
npm test
```

Run the generated 16 MiB JSON performance fixture with `npm run benchmark:json`. Override its size with
`JSON_BENCHMARK_MIB`; the targets are sub-16 ms typing and visible-scroll work, sub-second opening/indexing,
and non-blocking formatting and validation in the browser worker. JSON worker input is capped at 64 MiB and
formatted output at 128 MiB; highlighting remains viewport-only beyond those limits.
