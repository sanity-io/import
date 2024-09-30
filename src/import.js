const {Readable} = require('stream')
const fromArray = require('./importFromArray')
const fromFolder = require('./importFromFolder')
const fromStream = require('./importFromStream')
const validateOptions = require('./validateOptions')

const importers = {
  fromStream,
  fromFolder,
  fromArray,
}

/**
 * Main import function that handles different types of input (stream, array, folder).
 *
 * @param {Readable|Array|string} input - The input data to import. Can be a readable stream, an array of documents, or a path to a directory.
 * @param {Object} opts - Options for the import process.
 * @returns {Promise<Object>} - The result of the import process.
 * @throws {Error} - Throws an error if the input type is not supported.
 */
module.exports = async (input, opts) => {
  const options = await validateOptions(input, opts)

  if (input instanceof Readable) {
    return fromStream(input, options, importers)
  }

  if (Array.isArray(input)) {
    return fromArray(input, options /*importers*/)
  }

  if (typeof input === 'string') {
    return fromFolder(input, options, importers)
  }

  throw new Error('Stream does not seem to be a readable stream, an array or a path to a directory')
}
