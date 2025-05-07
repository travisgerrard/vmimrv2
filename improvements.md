# Performance Improvements for Search & Post Loading

## 1. Faster Search

### a. Full-Text Search
- Use Postgres full-text search (`tsvector`, `to_tsquery`) for fast, ranked search.
- Supabase supports this natively: use `.textSearch('fts', searchTerm, { type: 'websearch' })`.
- **Migration Example:**
  ```sql
  ALTER TABLE posts ADD COLUMN fts tsvector GENERATED ALWAYS AS (to_tsvector('english', content)) STORED;
  CREATE INDEX idx_posts_fts ON posts USING GIN (fts);
  ```
- **Query Example:**
  ```js
  const { data, error } = await supabase
    .from('posts')
    .select('id, title, snippet')
    .textSearch('fts', searchTerm, { type: 'websearch' })
    .limit(20);
  ```

### b. Indexing
- Add indexes on `content`, `created_at`, and any frequently filtered fields.
- For full-text, see above GIN index.

### c. Limit Results
- Use `.limit(20)` to avoid fetching too many posts at once.

### d. Debounce Search Input
- Debounce user input (200–500ms) to avoid excessive requests.

### e. Consider a Search Service
- For very large datasets, consider Algolia, Typesense, or Meilisearch.

---

## 2. Faster Post Loading

### a. Select Only Needed Fields
- Use `.select('id, created_at, updated_at, content, tags, is_starred, user_id, summary, secret_url')` instead of `*`.

### b. Batch Media Fetch
- If loading media for multiple posts, batch fetch or join where possible.

### c. Frontend Caching
- Use [SWR](https://swr.vercel.app/) or [React Query](https://tanstack.com/query/latest) for caching and background revalidation.

### d. Paginate Large Lists
- Always paginate results for large datasets.

---

## 3. Example: SWR for Post Detail

```js
import useSWR from 'swr';
const fetcher = (id) => supabase.from('posts').select('...').eq('id', id).single();
const { data, error } = useSWR(postId, fetcher);
```

---

## 4. General Recommendations
- Profile slow queries in Supabase/Postgres and add indexes as needed.
- Monitor with Vercel/Supabase analytics.
- Use HTTP/2 and compression (Vercel default).
- Reduce N+1 queries by batching or joining related data.

---

*Curated for Daddy Long Legs — see codebase for more details or request implementation help!* 