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
