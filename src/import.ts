import {importDocuments as fromArray} from './importFromArray.js'
import {importFromFolder as fromFolder} from './importFromFolder.js'
import {importFromStream as fromStream} from './importFromStream.js'
import type {ImportOptions, ImportResult, ImportSource} from './types.js'
import {validateOptions} from './validateOptions.js'

export function sanityImport(
  input: ImportSource,
  opts: Partial<ImportOptions>,
): Promise<ImportResult> {
  const options = validateOptions(input, opts)

  // Create the importers context to allow circular references
  const importers = {
    fromStream: (stream: NodeJS.ReadableStream, importOptions: ImportOptions, ctx: any) =>
      fromStream(stream, importOptions, ctx),
    fromArray: (documents: any[], importOptions: ImportOptions) =>
      fromArray(documents, importOptions),
    fromFolder: (
      fromDir: string,
      importOptions: ImportOptions & {deleteOnComplete?: boolean},
      ctx: any,
    ) => fromFolder(fromDir, importOptions, ctx),
  }

  if (
    typeof input === 'object' &&
    input !== null &&
    'pipe' in input &&
    typeof input.pipe === 'function'
  ) {
    return fromStream(input, options, importers)
  }

  if (Array.isArray(input)) {
    return fromArray(input, options)
  }

  if (typeof input === 'string') {
    return fromFolder(input, options, importers)
  }

  throw new Error('Stream does not seem to be a readable stream, an array or a path to a directory')
}

// Maintain backward compatibility with default export
export default sanityImport
