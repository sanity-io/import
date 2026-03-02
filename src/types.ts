import {type SanityClient} from '@sanity/client'

export interface SanityDocument {
  [key: string]: unknown
  _id: string
  _type: string

  _createdAt?: string
  _rev?: string
  _updatedAt?: string
}

export interface AssetDocument extends SanityDocument {
  _type: 'sanity.fileAsset' | 'sanity.imageAsset'

  metadata?: Record<string, unknown>
  mimeType?: string
  originalFilename?: string
  path?: string
  sha1hash?: string
  size?: number
  url?: string
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
  allowAssetsInDifferentDataset: boolean
  allowSystemDocuments: boolean
  client: SanityClient
  onProgress: (event: ProgressEvent) => void
  operation: 'create' | 'createIfNotExists' | 'createOrReplace'
  releasesOperation: 'fail' | 'ignore' | 'replace'
  replaceAssets: boolean
  skipCrossDatasetReferences: boolean
  tag: string

  allowFailingAssets?: boolean
  allowReplacementCharacters?: boolean
  assetConcurrency?: number
  assetMap?: AssetMap
  assetsBase?: string
  assetVerificationConcurrency?: number
  deleteOnComplete?: boolean
  targetDataset?: string
  targetProjectId?: string
  unreferencedAssets?: string[]
}

export interface ImportResult {
  numDocs: number
  warnings: Array<{message: string}>
}

export interface StreamReference {
  _ref: string

  _strengthenOnPublish?: boolean
  _weak?: boolean
}

export interface Reference extends StreamReference {
  _type: 'reference'
}

export type ImportSource = NodeJS.ReadableStream | SanityDocument[] | string

// Error interfaces for better type safety
export interface AssetUploadError extends Error {
  url: string

  attempts?: number
  type?: string
}

export interface SanityApiError extends Error {
  response?: {
    status: number
    statusCode: number
    statusText: string
  }
  statusCode?: number
}

// Fetch response types
export interface SanityFetchResponse {
  [key: string]: unknown
  _id: string

  url?: string
}

// Asset failure for reporting
export interface AssetFailure {
  documents: Array<{
    documentId: string
    path: string
  }>
  type: 'asset'
  url: string
}

// HTTP response from get-it library
export interface GetItResponse {
  body: NodeJS.ReadableStream

  headers?: Record<string, string>
  status?: number
}

// Circular dependency context for importers
export interface ImportersContext {
  fromArray: (documents: SanityDocument[], options: ImportOptions) => Promise<ImportResult>
  fromFolder: (
    fromDir: string,
    options: ImportOptions & {deleteOnComplete?: boolean},
    ctx: ImportersContext,
  ) => Promise<ImportResult>
  fromStream: (
    stream: NodeJS.ReadableStream,
    options: ImportOptions,
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
  [key: string]: unknown

  dimensions?: {
    height: number
    width: number
  }
}
