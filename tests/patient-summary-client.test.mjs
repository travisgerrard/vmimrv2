import assert from 'node:assert/strict';
import test from 'node:test';
import { loadTypeScript } from './helpers/load-typescript.mjs';
const componentPath = 'src/app/(main)/posts/[id]/PostDetailClient.tsx';
const sectionPath = 'src/app/posts/[id]/PatientSummarySection.tsx';
const ownerSession = { user: { id: 'synthetic-owner' }, access_token: 'synthetic-old-token' };
const otherSession = { user: { id: 'synthetic-other' }, access_token: 'synthetic-other-token' };
const post = {
  id: 'synthetic-post', user_id: ownerSession.user.id, content: 'Synthetic reference note',
  tags: ['patient'], created_at: '2026-01-01', updated_at: '2026-01-01', is_starred: false,
};

function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}

function findElement(tree, predicate) {
  if (!tree || typeof tree !== 'object') return null;
  if (Array.isArray(tree)) {
    for (const item of tree) { const found = findElement(item, predicate); if (found) return found; }
    return null;
  }
  if (predicate(tree)) return tree;
  return findElement(tree.props?.children, predicate);
}

function createHarness(initialSession, initialSummaryResult = { data: null, error: null }) {
  const slots = [];
  let hookIndex = 0;
  let dirty = true;
  let tree;
  let currentSession = initialSession;
  let getSessionImpl = async () => ({ data: { session: currentSession }, error: null });
  let summaryResultImpl = async () => initialSummaryResult;
  let fetchImpl = async () => Response.json({ id: 'synthetic-summary', summary: 'Synthetic generated summary' });
  const listeners = new Set();
  const summaryQueries = [];
  const requests = [];
  const pendingEffects = [];
  const SummarySection = () => null;
  const jsx = (type, props) => ({ type, props });
  const registerEffect = (callback, deps, kind) => {
    const index = hookIndex++;
    const previous = slots[index];
    if (!previous || !deps || deps.some((dep, i) => !Object.is(dep, previous.deps[i]))) {
      slots[index] = { deps, cleanup: previous?.cleanup };
      pendingEffects.push({ index, callback, kind });
    }
  };
  const react = {
    Fragment: 'fragment',
    useState(initial) {
      const index = hookIndex++;
      if (!slots[index]) slots[index] = { value: typeof initial === 'function' ? initial() : initial };
      return [slots[index].value, value => {
        const next = typeof value === 'function' ? value(slots[index].value) : value;
        if (!Object.is(next, slots[index].value)) { slots[index].value = next; dirty = true; }
      }];
    },
    useRef(initial) {
      const index = hookIndex++;
      if (!slots[index]) slots[index] = { current: initial };
      return slots[index];
    },
    useCallback(callback, deps) {
      const index = hookIndex++;
      const previous = slots[index];
      if (!previous || deps.some((dep, i) => !Object.is(dep, previous.deps[i]))) slots[index] = { value: callback, deps };
      return slots[index].value;
    },
    useEffect: (callback, deps) => registerEffect(callback, deps, 'normal'),
    useLayoutEffect: (callback, deps) => registerEffect(callback, deps, 'layout'),
  };
  const supabase = {
    auth: {
      getSession: () => getSessionImpl(),
      onAuthStateChange(callback) {
        listeners.add(callback);
        return { data: { subscription: { unsubscribe: () => listeners.delete(callback) } } };
      },
    },
    from(table) {
      assert.equal(table, 'patient_summaries', 'summary tests must not read unrelated tables');
      const query = { filters: [] };
      summaryQueries.push(query);
      const builder = {
        select(columns) { query.columns = columns; return builder; },
        eq(column, value) { query.filters.push([column, value]); return builder; },
        order() { return builder; }, limit() { return builder; },
        maybeSingle: () => summaryResultImpl(),
      };
      return builder;
    },
    channel() { const channel = { on: () => channel, subscribe: () => channel }; return channel; },
    removeChannel() {},
  };
  const router = { push() {} };
  const mocks = {
    react,
    'react/jsx-runtime': { jsx, jsxs: jsx, Fragment: 'fragment' },
    'next/navigation': { useParams: () => ({ id: post.id }), useRouter: () => router },
    'next/link': 'link', 'next/image': 'image',
    '@/lib/supabaseClient': { supabase },
    'react-markdown': 'markdown', 'remark-gfm': () => {},
    uuid: { v4: () => 'synthetic-uuid' },
    '../../../posts/[id]/PatientSummarySection': SummarySection,
  };
  const Component = loadTypeScript(componentPath, mocks, {
    window: {}, document: { title: '' },
    fetch: async (url, init) => { requests.push({ url, init }); return fetchImpl(url, init); },
  }).default;
  const props = { initialPost: post, initialMediaFiles: [] };

  async function flush() {
    for (let attempt = 0; attempt < 20; attempt++) {
      if (dirty) {
        dirty = false;
        hookIndex = 0;
        tree = Component(props);
        const effects = pendingEffects.splice(0).sort((a, b) => (a.kind === 'layout' ? 0 : 1) - (b.kind === 'layout' ? 0 : 1));
        for (const effect of effects) {
          const slot = slots[effect.index];
          slot.cleanup?.();
          slot.cleanup = effect.callback();
        }
      }
      await new Promise(setImmediate);
      if (!dirty) return;
    }
    throw new Error('Synthetic hook harness did not settle');
  }

  return {
    flush, requests, summaryQueries,
    get sectionProps() { return findElement(tree, element => element.type === SummarySection)?.props; },
    get signInNotice() { return findElement(tree, element => element.type === 'p' && element.props.role === 'alert'); },
    setGetSession: callback => { getSessionImpl = callback; },
    setSummaryResult: callback => { summaryResultImpl = callback; },
    setFetch: callback => { fetchImpl = callback; },
    changeSession(next) {
      currentSession = next;
      for (const callback of listeners) callback('SYNTHETIC_AUTH_CHANGE', next);
    },
    renderSection() {
      const Section = loadTypeScript(sectionPath, {
        react, 'react/jsx-runtime': mocks['react/jsx-runtime'],
        'react-markdown': 'markdown', 'remark-gfm': () => {},
      }).default;
      return Section(this.sectionProps);
    },
  };
}

for (const [viewer, session] of [['anonymous', null], ['other authenticated user', otherSession]]) {
  test(`${viewer} reads and sees public summaries without generation or feedback controls`, async () => {
    const harness = createHarness(session, { data: { id: 'synthetic-summary', summary_text: 'Synthetic public summary' }, error: null });
    await harness.flush();
    assert.ok(harness.summaryQueries.length > 0);
    for (const query of harness.summaryQueries) {
      assert.deepEqual(query.filters, [['post_id', post.id]]);
      assert.equal(query.columns, 'id, summary_text');
    }
    assert.equal(harness.sectionProps.canManagePatientSummary, false);
    const section = harness.renderSection();
    assert.equal(findElement(section, element => element.type === 'markdown').props.children, 'Synthetic public summary');
    assert.equal(findElement(section, element => element.type === 'button'), null);
    assert.equal(findElement(section, element => element.type === 'textarea'), null);
  });
}

test('public viewer with no saved summary sees no generation controls', async () => {
  const harness = createHarness(null);
  await harness.flush();
  assert.equal(harness.summaryQueries.length, 1);
  assert.equal(harness.renderSection(), null);
});

test('owner reads public summaries and generation sends the freshly retrieved token', async () => {
  const harness = createHarness(ownerSession);
  await harness.flush();
  assert.deepEqual(harness.summaryQueries[0].filters, [['post_id', post.id]]);
  assert.equal(harness.summaryQueries[0].columns, 'id, summary_text');
  assert.ok(findElement(harness.renderSection(), element => element.type === 'button'));
  harness.setGetSession(async () => ({ data: { session: { ...ownerSession, access_token: 'synthetic-fresh-token' } }, error: null }));
  await harness.sectionProps.handleGeneratePatientSummary('Synthetic feedback');
  await harness.flush();
  assert.equal(harness.requests.length, 1);
  assert.equal(harness.requests[0].init.headers.Authorization, 'Bearer synthetic-fresh-token');
  assert.deepEqual(JSON.parse(harness.requests[0].init.body), { post_id: post.id, feedback: 'Synthetic feedback' });
  assert.equal(harness.sectionProps.patientSummary.summary, 'Synthetic generated summary');
  assert.ok(findElement(harness.renderSection(), element => element.type === 'textarea'));
});

test('missing fresh session keeps public viewing and asks the owner to sign in without sending a request', async () => {
  const harness = createHarness(ownerSession, { data: { id: 'synthetic-summary', summary_text: 'Synthetic cached summary' }, error: null });
  await harness.flush();
  harness.setGetSession(async () => ({ data: { session: null }, error: null }));
  await harness.sectionProps.handleGeneratePatientSummary();
  await harness.flush();
  assert.equal(harness.requests.length, 0);
  assert.equal(harness.sectionProps.patientSummary.summary, 'Synthetic cached summary');
  assert.equal(harness.sectionProps.canManagePatientSummary, false);
  assert.equal(findElement(harness.renderSection(), element => element.type === 'button'), null);
  assert.equal(findElement(harness.renderSection(), element => element.type === 'textarea'), null);
  assert.ok(harness.signInNotice);
});

test('fresh session for a different user prevents summary generation', async () => {
  const harness = createHarness(ownerSession);
  await harness.flush();
  harness.setGetSession(async () => ({ data: { session: otherSession }, error: null }));
  await harness.sectionProps.handleGeneratePatientSummary();
  await harness.flush();
  assert.equal(harness.requests.length, 0);
  assert.equal(harness.sectionProps.canManagePatientSummary, false);
});

test('account change immediately invalidates a pending generation and clears feedback', async () => {
  const harness = createHarness(ownerSession, { data: { id: 'synthetic-summary', summary_text: 'Synthetic public summary' }, error: null });
  await harness.flush();
  harness.sectionProps.setFeedback('Synthetic private feedback');
  await harness.flush();
  const pending = deferred();
  harness.setFetch(() => pending.promise);
  const generation = harness.sectionProps.handleGeneratePatientSummary();
  await harness.flush();
  harness.changeSession(otherSession);
  // Resolve before another render to exercise the auth callback's immediate guard.
  pending.resolve(Response.json({ id: 'synthetic-late-summary', summary: 'Synthetic late summary' }));
  await generation;
  await harness.flush();
  assert.equal(harness.sectionProps.patientSummary.summary, 'Synthetic public summary');
  assert.equal(harness.sectionProps.feedback, '');
  assert.equal(harness.sectionProps.canManagePatientSummary, false);
});

test('logout while awaiting a fresh session prevents generation even if the old session resolves later', async () => {
  const harness = createHarness(ownerSession, { data: { id: 'synthetic-summary', summary_text: 'Synthetic public summary' }, error: null });
  await harness.flush();
  const pending = deferred();
  harness.setGetSession(() => pending.promise);
  const generation = harness.sectionProps.handleGeneratePatientSummary();
  harness.changeSession(null);
  pending.resolve({ data: { session: ownerSession }, error: null });
  await generation;
  await harness.flush();
  assert.equal(harness.requests.length, 0);
  assert.equal(harness.sectionProps.patientSummary.summary, 'Synthetic public summary');
  assert.equal(harness.sectionProps.canManagePatientSummary, false);
});

test('a delayed cached read cannot replace the current public read after logout', async () => {
  const harness = createHarness(ownerSession);
  const pending = deferred();
  harness.setSummaryResult(() => pending.promise);
  await harness.flush();
  harness.setSummaryResult(async () => ({ data: { id: 'synthetic-current-summary', summary_text: 'Synthetic current public summary' }, error: null }));
  harness.changeSession(null);
  pending.resolve({ data: { id: 'synthetic-late-summary', summary_text: 'Synthetic late summary' }, error: null });
  await harness.flush();
  assert.equal(harness.sectionProps.patientSummary.summary, 'Synthetic current public summary');
  assert.equal(harness.sectionProps.patientSummaryLoading, false);
  assert.equal(harness.sectionProps.canManagePatientSummary, false);
});

test('public database errors are visible and session restoration reruns reads', async () => {
  const harness = createHarness(null, { data: null, error: { message: 'Synthetic database error' } });
  await harness.flush();
  assert.equal(harness.summaryQueries.length, 1);
  assert.ok(findElement(harness.renderSection(), element => element.props?.role === 'alert'));
  harness.changeSession(ownerSession);
  await harness.flush();
  assert.equal(harness.summaryQueries.length, 2);
  assert.equal(harness.sectionProps.patientSummaryError, 'Synthetic database error');
  assert.ok(findElement(harness.renderSection(), element => element.props?.role === 'alert'));
});
