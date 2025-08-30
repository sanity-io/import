# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Development Commands

### Build and Development

```bash
pnpm run build       # Build TypeScript to dist/
pnpm run dev         # Watch mode for TypeScript compilation
pnpm run typecheck   # Type checking without build
```

### Testing and Quality

```bash
pnpm test             # Run Jest tests
pnpm run coverage     # Run tests with coverage report
pnpm run lint         # Run ESLint on TypeScript files
pnpm run lint:fix     # Auto-fix ESLint issues
```

### Package Management

```bash
pnpm install          # Install dependencies
```

## Architecture Overview

This is a TypeScript/ESM Node.js library (Node 20+) for importing documents to Sanity datasets from various input sources (ndjson streams, folders, or arrays).

### Core Import Flow

The main entry point `dist/import.js` (compiled from `src/import.ts`) routes to three specialized importers:

- **Stream Importer** (`src/importFromStream.ts`) - Handles ndjson streams and tar.gz files
- **Array Importer** (`src/importFromArray.ts`) - Processes document arrays directly  
- **Folder Importer** (`src/importFromFolder.ts`) - Imports from local folders with assets

### Key Components

- **Document Processing**: `src/batchDocuments.ts` batches documents for efficient API calls
- **Asset Handling**: `src/uploadAssets.ts` manages file uploads with retry logic
- **Reference Management**: `src/references.ts` handles document references and strengthening
- **Validation**: Multiple validators ensure data integrity before import
- **Types**: `src/types.ts` contains comprehensive TypeScript type definitions

### Import Process

1. Input validation and routing (`src/validateOptions.ts`)
2. Document ID assignment (`src/assignDocumentId.ts`)
3. Asset reference extraction and upload
4. Document batching and import via Sanity API
5. Reference strengthening for consistency

### CLI Tool

The `dist/cli.js` (compiled from `src/cli.ts`) provides a command-line interface using Node 20+ native `parseArgs()` and `fetch()`. Features progress reporting with `ora` spinner and supports reading from files, URLs, or stdin.

### Testing

Tests use Jest with ts-jest for TypeScript support. Fixtures in `test/fixtures/` include sample ndjson files and mock assets. Snapshots are used for import result validation.

### Build System

- **TypeScript**: ESM-only compilation targeting Node 20+
- **Output**: `dist/` directory with `.js`, `.d.ts`, and `.js.map` files
- **Module System**: Pure ESM (no CommonJS support)
- **Dependencies**: Uses `lodash-es` for ESM-compatible utilities
