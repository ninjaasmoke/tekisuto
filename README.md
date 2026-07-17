# Tekisuto

A fast, private browser-based text editor for opening, editing, and saving local files. Tekisuto has no backend: file contents and recovered drafts stay in your browser.

## Features

- Open files with the native picker or drag and drop
- Save directly to a local file where the File System Access API is available
- Download fallback for browsers without direct file access
- TXT, Markdown, JSON, CSV, and custom file extensions
- Local draft recovery and unsaved-change protection
- JSON formatting and validation, safe CSV quoting, and find and replace
- Keyboard shortcuts, light and dark themes, and live document statistics

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
```
