export default (urls: string[]) => {
  const docs = []
  const validUrls = urls.filter((url): url is string => Boolean(url))
  for (let i = 1; i <= 60; i++) {
    for (let j = 0; j < validUrls.length; j++) {
      docs.push({
        documentId: `doc_${i}`,
        path: `some.path${j}`,
        url: validUrls[j],
        type: 'image',
      })
    }
  }

  return docs
}
