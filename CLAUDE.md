# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Development Commands

### Testing and Quality
```bash
pnpm test             # Run Jest tests
pnpm run coverage     # Run tests with coverage report
pnpm run lint         # Run ESLint
```

### Package Management
```bash
pnpm install          # Install dependencies
```

## Architecture Overview

This is a Node.js library for importing documents to Sanity datasets from various input sources (ndjson streams, folders, or arrays).

### Core Import Flow
The main entry point `src/import.js` routes to three specialized importers:
- **Stream Importer** (`src/importFromStream.js`) - Handles ndjson streams and tar.gz files
- **Array Importer** (`src/importFromArray.js`) - Processes document arrays directly
- **Folder Importer** (`src/importFromFolder.js`) - Imports from local folders with assets

### Key Components
- **Document Processing**: `src/batchDocuments.js` batches documents for efficient API calls
- **Asset Handling**: `src/uploadAssets.js` manages file uploads with retry logic
- **Reference Management**: `src/references.js` handles document references and strengthening
- **Validation**: Multiple validators ensure data integrity before import

### Import Process
1. Input validation and routing (`src/validateOptions.js`)
2. Document ID assignment (`src/assignDocumentId.js`) 
3. Asset reference extraction and upload
4. Document batching and import via Sanity API
5. Reference strengthening for consistency

### CLI Tool
The `src/cli.js` provides a command-line interface with progress reporting using `ora` spinner and supports reading from files, URLs, or stdin.

### Testing
Tests use Jest with fixtures in `test/fixtures/` including sample ndjson files and mock assets. Snapshots are used for import result validation.