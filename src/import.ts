import {importDocuments as fromArray} from './importFromArray.js'
import {importFromFolder as fromFolder} from './importFromFolder.js'
import {importFromStream as fromStream} from './importFromStream.js'
import type {ImportersContext, ImportOptions, ImportResult, ImportSource} from './types.js'
import {validateOptions} from './validateOptions.js'

export {DatasetImportCommand} from './commands/dataset/import.js'

export function sanityImport(
  input: ImportSource,
  opts: Partial<ImportOptions>,
): Promise<ImportResult> {
  const options = validateOptions(input, opts)

  // Create the importers context to allow circular references
  const importers: ImportersContext = {
    fromStream: (stream, importOptions, ctx) => fromStream(stream, importOptions, ctx),
    fromArray: (documents, importOptions) => fromArray(documents, importOptions),
    fromFolder: (fromDir, importOptions, ctx) => fromFolder(fromDir, importOptions, ctx),
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

  throw new Error('Input does not seem to be a readable stream, an array or a path to a directory')
}
