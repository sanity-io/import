import type {SanityClient} from '@sanity/client'

export interface SanityDocument {
  _id: string
  _type: string
  _rev?: string
  _createdAt?: string
  _updatedAt?: string
  [key: string]: unknown
}

export interface AssetDocument extends SanityDocument {
  _type: 'sanity.imageAsset' | 'sanity.fileAsset'
  url?: string
  path?: string
  sha1hash?: string
  size?: number
  mimeType?: string
  originalFilename?: string
  metadata?: Record<string, unknown>
}

export interface AssetMap {
  [url: string]: AssetDocument
}

export interface ProgressEvent {
  step: string
  current?: number
  total?: number
  update?: string
}

export interface ImportOptions {
  client: SanityClient
  operation: 'create' | 'createIfNotExists' | 'createOrReplace'
  onProgress: (event: ProgressEvent) => void
  allowAssetsInDifferentDataset: boolean
  replaceAssets: boolean
  skipCrossDatasetReferences: boolean
  allowSystemDocuments: boolean
  releasesOperation: 'fail' | 'ignore' | 'replace'
  tag: string
  targetProjectId?: string
  targetDataset?: string
  assetConcurrency?: number
  assetVerificationConcurrency?: number
  allowFailingAssets?: boolean
  allowReplacementCharacters?: boolean
  assetMap?: AssetMap
  unreferencedAssets?: string[]
  assetsBase?: string
  deleteOnComplete?: boolean
}

export interface ImportResult {
  numDocs: number
  warnings: Array<{message: string}>
}

export interface BatchResult extends ImportResult {
  results: Array<{
    id: string
    operation: string
  }>
}

export interface AssetResult {
  _id: string
  document: AssetDocument
}

export interface DocumentWithAssets {
  document: SanityDocument
  assets: AssetDocument[]
}

export interface StreamReference {
  _ref: string
  _weak?: boolean
  _strengthenOnPublish?: boolean
}

export interface Reference extends StreamReference {
  _type: 'reference'
}

export type ImportSource = NodeJS.ReadableStream | SanityDocument[] | string

export interface ImportContext {
  options: ImportOptions
  assets: AssetMap
  references: Map<string, StreamReference[]>
}

// Error interfaces for better type safety
export interface AssetUploadError extends Error {
  url: string
  type?: string
  attempts?: number
}

export interface SanityApiError extends Error {
  response?: {
    status: number
    statusCode: number
    statusText: string
  }
  statusCode?: number
}

export interface TarExtractError extends Error {
  extract?: unknown
}

// Fetch response types
export interface SanityFetchResponse {
  _id: string
  url?: string
  [key: string]: unknown
}

// Asset document with dimensions for validation
export interface AssetDocumentWithMetadata extends AssetDocument {
  metadata?: {
    dimensions?: {
      width: number
      height: number
    }
    [key: string]: unknown
  }
}

// Asset failure for reporting
export interface AssetFailure {
  type: 'asset'
  url: string
  documents: Array<{
    documentId: string
    path: string
  }>
}

// Tar-stream types for stream processing
export interface TarEntry {
  name: string
  size: number
  type: string
}

// JSON streaming event emitter types
export interface JsonStreamEvent {
  type: 'data' | 'error' | 'end'
  data?: unknown
  error?: Error
}

// HTTP response from get-it library
export interface GetItResponse {
  body: NodeJS.ReadableStream
  headers?: Record<string, string>
  status?: number
}

// Circular dependency context for importers
export interface ImportersContext {
  fromStream: (
    stream: NodeJS.ReadableStream,
    options: ImportOptions,
    ctx: ImportersContext,
  ) => Promise<ImportResult>
  fromArray: (documents: SanityDocument[], options: ImportOptions) => Promise<ImportResult>
  fromFolder: (
    fromDir: string,
    options: ImportOptions & {deleteOnComplete?: boolean},
    ctx: ImportersContext,
  ) => Promise<ImportResult>
}

// Cross-dataset reference
export interface CrossDatasetReference extends StreamReference {
  _dataset: string
  _projectId?: string
}

// Asset metadata structure
export interface AssetMetadata {
  dimensions?: {
    width: number
    height: number
  }
  [key: string]: unknown
}
