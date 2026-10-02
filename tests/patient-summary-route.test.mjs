import assert from 'node:assert/strict';
import { test } from 'node:test';
import { loadTypeScript } from './helpers/load-typescript.mjs';

class NextResponse extends Response {
  static json(body, init) { return new NextResponse(JSON.stringify(body), init); }
}

function setup({ summaries = [], postError = null, summaryError = null } = {}) {
  const posts = [
    { id: 'owner-post', user_id: 'owner', content: 'Synthetic note', tags: ['patient'] },
    { id: 'other-post', user_id: 'other', content: 'Other synthetic note', tags: ['patient'] },
    { id: 'ordinary-post', user_id: 'owner', content: 'Synthetic reference', tags: ['reference'] },
  ];
  const calls = { clients: [], auth: [], queries: [], inserts: [], openai: [] };
  const clients = [];
  const createClient = (url, key, options) => {
    calls.clients.push({ url, key, options });
    const client = {
      auth: {
        getUser: async token => {
          calls.auth.push(token);
          const id = { 'owner-token': 'owner', 'other-token': 'other' }[token];
          return { data: { user: id ? { id } : null }, error: id ? null : { message: 'Invalid token' } };
        },
      },
      from: table => {
        const call = { table, filters: [], columns: [], token: options.global.headers.Authorization };
        calls.queries.push(call);
        let inserted = null;
        const query = {
          select: columns => { call.columns.push(columns); return query; },
          eq: (column, value) => { call.filters.push({ type: 'eq', column, value }); return query; },
          is: (column, value) => { call.filters.push({ type: 'is', column, value }); return query; },
          order: () => query,
          limit: () => query,
          insert: row => {
            inserted = { id: 'new-summary', ...row };
            calls.inserts.push(inserted);
            return query;
          },
          maybeSingle: async () => {
            const error = table === 'posts' ? postError : summaryError;
            const rows = table === 'posts' ? posts : summaries;
            // Model public readability: ownership only follows explicit query filters.
            const data = rows.find(row => call.filters.every(({ type, column, value }) =>
              type === 'is' ? row[column] === null : row[column] === value
            )) ?? null;
            return { data, error };
          },
          single: async () => ({ data: inserted, error: null }),
        };
        return query;
      },
    };
    clients.push(client);
    return client;
  };
  const fetch = async (url, init) => {
    calls.openai.push({ url, init });
    return Response.json({ choices: [{ message: { content: '  Synthetic summary  ' } }] });
  };
  const { POST } = loadTypeScript('src/app/api/patient-summary/route.ts', {
    'next/server': { NextResponse },
    '@supabase/supabase-js': { createClient },
  }, {
    fetch,
    process: { env: {
      NEXT_PUBLIC_SUPABASE_URL: 'https://example.supabase.co',
      NEXT_PUBLIC_SUPABASE_ANON_KEY: 'synthetic-public-key',
      OPENAI_API_KEY: 'synthetic-openai-key',
    } },
  });
  const request = (body = { post_id: 'owner-post' }, authorization = 'Bearer owner-token') => {
    const headers = { 'Content-Type': 'application/json' };
    if (authorization !== null) headers.Authorization = authorization;
    return new Request('https://example.test/api/patient-summary', {
      method: 'POST', headers, body: JSON.stringify(body),
    });
  };
  return { POST, calls, clients, request };
}

test('missing/malformed auth is rejected before clients, database, or AI work', async () => {
  for (const authorization of [null, '', 'Basic owner-token', 'Bearer ', 'Bearer owner-token extra']) {
    const { POST, calls, request } = setup();
    const response = await POST(request({}, authorization));
    assert.equal(response.status, 401);
    assert.equal(calls.clients.length, 0);
    assert.equal(calls.queries.length, 0);
    assert.equal(calls.openai.length, 0);
  }
});

test('invalid user token is rejected before database or AI work', async () => {
  const { POST, calls, request } = setup();
  assert.equal((await POST(request({}, 'Bearer expired-token'))).status, 401);
  assert.deepEqual(calls.auth, ['expired-token']);
  assert.equal(calls.queries.length, 0);
  assert.equal(calls.openai.length, 0);
});

test('publicly readable cross-owner post cannot return cached summary or generate', async () => {
  const { POST, calls, request } = setup({ summaries: [
    { id: 'private-summary', post_id: 'other-post', user_id: 'other', feedback: null, summary_text: 'Private synthetic summary' },
  ] });
  const response = await POST(request({ post_id: 'other-post' }));
  assert.equal(response.status, 404);
  assert.deepEqual(await response.json(), { error: 'Post not found' });
  assert.deepEqual(calls.queries.map(query => query.table), ['posts']);
  assert.equal(calls.openai.length, 0);
  assert.equal(calls.inserts.length, 0);
});

test('owner receives cached summary without generation or insertion', async () => {
  const { POST, calls, request } = setup({ summaries: [
    { id: 'wrong-owner', post_id: 'owner-post', user_id: 'other', feedback: 'shorter', summary_text: 'Wrong-owner synthetic summary' },
    { id: 'cached-summary', post_id: 'owner-post', user_id: 'owner', feedback: 'shorter', summary_text: 'Cached synthetic summary' },
  ] });
  const response = await POST(request({ post_id: 'owner-post', feedback: 'shorter' }));
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { summary: 'Cached synthetic summary', id: 'cached-summary' });
  assert.deepEqual(calls.queries.map(query => query.table), ['posts', 'patient_summaries']);
  assert.equal(calls.openai.length, 0);
  assert.equal(calls.inserts.length, 0);
});

test('missing, empty, and null feedback reuse SQL NULL summaries', async () => {
  for (const feedback of [undefined, '', null]) {
    const { POST, calls, request } = setup({ summaries: [
      { id: 'null-feedback-summary', post_id: 'owner-post', user_id: 'owner', feedback: null, summary_text: 'Cached default summary' },
    ] });
    const response = await POST(request({ post_id: 'owner-post', feedback }));
    assert.equal(response.status, 200);
    assert.equal((await response.json()).id, 'null-feedback-summary');
    assert.ok(calls.queries[1].filters.some(filter => filter.type === 'is' && filter.column === 'feedback' && filter.value === null));
    assert.equal(calls.openai.length, 0);
  }
});

test('owner generation inserts verified ownership and normalized feedback', async () => {
  const { POST, calls, request } = setup();
  const response = await POST(request({ post_id: 'owner-post', user_id: 'other', feedback: '' }));
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { summary: 'Synthetic summary', id: 'new-summary' });
  assert.equal(calls.openai.length, 1);
  assert.equal(calls.inserts.length, 1);
  assert.equal(calls.inserts[0].user_id, 'owner');
  assert.equal(calls.inserts[0].post_id, 'owner-post');
  assert.equal(calls.inserts[0].feedback, null);
  assert.ok(calls.queries.every(query => query.token === 'Bearer owner-token'));
  assert.equal(calls.clients.length, 1);
  assert.equal(calls.clients[0].options.auth.persistSession, false);
});

test('generation preserves supplied feedback', async () => {
  const { POST, calls, request } = setup();
  assert.equal((await POST(request({ post_id: 'owner-post', feedback: 'Use plain language' }))).status, 200);
  assert.equal(calls.inserts[0].feedback, 'Use plain language');
  assert.match(JSON.parse(calls.openai[0].init.body).messages[1].content, /Use plain language/);
});

test('non-patient posts do not read summaries or invoke AI', async () => {
  const { POST, calls, request } = setup();
  assert.equal((await POST(request({ post_id: 'ordinary-post' }))).status, 204);
  assert.deepEqual(calls.queries.map(query => query.table), ['posts']);
  assert.equal(calls.openai.length, 0);
});

test('summary read failure does not trigger generation', async () => {
  const { POST, calls, request } = setup({ summaryError: { message: 'Synthetic database failure' } });
  assert.equal((await POST(request())).status, 500);
  assert.equal(calls.openai.length, 0);
  assert.equal(calls.inserts.length, 0);
});

test('invalid request bodies cause no data or AI work after auth', async () => {
  for (const body of [null, [], {}, { post_id: 7 }, { post_id: 'owner-post', feedback: {} }]) {
    const { POST, calls, request } = setup();
    assert.equal((await POST(request(body))).status, 400);
    assert.equal(calls.queries.length, 0);
    assert.equal(calls.openai.length, 0);
  }
});

test('concurrent users retain separate authenticated clients', async () => {
  const { POST, calls, clients, request } = setup();
  const responses = await Promise.all([
    POST(request({ post_id: 'owner-post' })),
    POST(request({ post_id: 'other-post' }, 'Bearer other-token')),
  ]);
  assert.ok(responses.every(response => response.status === 200));
  assert.notEqual(clients[0], clients[1]);
  assert.deepEqual(calls.inserts.map(row => row.user_id).sort(), ['other', 'owner']);
  assert.deepEqual(calls.clients.map(call => call.options.global.headers.Authorization).sort(), ['Bearer other-token', 'Bearer owner-token']);
});
