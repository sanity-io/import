export default (urls: string[]) => {
  const docs = []
  for (let i = 1; i <= 60; i++) {
    for (let j = 0; j < urls.length; j++) {
      docs.push({
        documentId: `doc_${i}`,
        path: `some.path${j}`,
        url: urls[j],
        type: 'image',
      })
    }
  }

  return docs
}
