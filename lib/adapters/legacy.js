/**
 * Adapter for the legacy Saber 3.3.x API (`/api/bookshelf/*`, `/api/server-info`).
 *
 * This generation has no durable job queue: translation is driven by the
 * browser through session/parallel endpoints, so job tools degrade honestly.
 *
 * @module dsh-plugin-saber/adapters/legacy
 */

function enc(value) {
  return encodeURIComponent(String(value))
}

export function createLegacyAdapter(client) {
  return {
    flavor: 'legacy',
    versionLabel: 'Saber 3.3.x（/api）',

    serverInfo: () => client.request('/api/server-info'),
    listBooks: ({ search } = {}) => client.request(
      typeof search === 'string' && search.trim().length > 0
        ? `/api/bookshelf/books?search=${enc(search.trim())}`
        : '/api/bookshelf/books',
    ),
    getBook: bookId => client.request(`/api/bookshelf/books/${enc(bookId)}`),
    listChapterImages: (bookId, chapterId) => client.request(
      `/api/bookshelf/books/${enc(bookId)}/chapters/${enc(chapterId)}/images`,
    ),
    listPlugins: () => client.request('/api/plugins'),
  }
}
