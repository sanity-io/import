export default function createMockAssets(urls: string[]) {
  const docs = []
  const validUrls = urls.filter(Boolean)
  for (let i = 1; i <= 60; i++) {
    for (const [j, validUrl] of validUrls.entries()) {
      docs.push({
        documentId: `doc_${i}`,
        path: `some.path${j}`,
        type: 'image',
        url: validUrl,
      })
    }
  }

  return docs
}
