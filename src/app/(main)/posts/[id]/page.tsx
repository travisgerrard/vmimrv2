'use client';

import { useState, useEffect, useLayoutEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { supabase } from '@/lib/supabaseClient';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { v4 as uuidv4 } from 'uuid';
import type { Session } from '@supabase/supabase-js';
import Image from 'next/image';
import { Fragment } from 'react';
import PatientSummarySection from '../../../posts/[id]/PatientSummarySection';

type MediaFile = {
    id: string;
    file_name: string;
    file_path: string;
    file_type: string;
    uploaded_at: string;
};

type Post = {
  id: string;
  created_at: string;
  updated_at: string;
  content: string;
  tags: string[] | null;
  is_starred: boolean;
  user_id: string;
  secret_url?: string | null;
  summary?: string | null;
  media_files?: MediaFile[];
};

type PatientSummary = {
  id: string;
  summary: string;
};

// ── Accent color ─────────────────────────────────────────────────────────────
const TAG_COLOR_MAP: Record<string, string> = {
  'infectious disease': 'green', 'pediatrics': 'green', 'neonatal': 'green',
  'strep': 'green', 'antibiotic': 'green', 'infection': 'green', 'vaccines': 'green',
  'neurology': 'orange', 'sleep': 'orange', 'neuroscience': 'orange',
  'resident': 'purple', 'teaching': 'purple', 'education': 'purple',
  'cardiology': 'red', 'cardiac': 'red', 'heart': 'red', 'ecg': 'red',
  'pulmonology': 'blue', 'respiratory': 'blue', 'asthma': 'blue', 'copd': 'blue',
  'orthopedics': 'orange', 'musculoskeletal': 'orange', 'shoulder': 'orange',
};
type AccentColor = 'blue' | 'green' | 'purple' | 'orange' | 'red' | 'gray';
const COLOR_CONFIG: Record<AccentColor, { border: string; tagBg: string; tagText: string; tagBorder: string }> = {
  blue:   { border: '#3b82f6', tagBg: 'bg-blue-50',   tagText: 'text-blue-700',   tagBorder: 'border-blue-200' },
  green:  { border: '#10b981', tagBg: 'bg-green-50',  tagText: 'text-green-700',  tagBorder: 'border-green-200' },
  purple: { border: '#8b5cf6', tagBg: 'bg-purple-50', tagText: 'text-purple-700', tagBorder: 'border-purple-200' },
  orange: { border: '#f59e0b', tagBg: 'bg-orange-50', tagText: 'text-orange-700', tagBorder: 'border-orange-200' },
  red:    { border: '#ef4444', tagBg: 'bg-red-50',    tagText: 'text-red-700',    tagBorder: 'border-red-200' },
  gray:   { border: '#d1d5db', tagBg: 'bg-gray-100',  tagText: 'text-gray-600',   tagBorder: 'border-gray-200' },
};
function getAccentColor(tags: string[] | null): AccentColor {
  if (!tags || tags.length === 0) return 'gray';
  for (const tag of tags) {
    const color = TAG_COLOR_MAP[tag.toLowerCase()];
    if (color) return color as AccentColor;
  }
  return 'blue';
}
// ─────────────────────────────────────────────────────────────────────────────

export default function PostDetailPage() {
  const [post, setPost] = useState<Post | null>(() => {
    if (typeof window === 'undefined') return null;
    const pending = sessionStorage.getItem('pendingPost');
    if (!pending) return null;
    try {
      const p = JSON.parse(pending);
      const urlPostId = window.location.pathname.split('/').filter(Boolean).pop();
      if (p.id !== urlPostId) return null;
      sessionStorage.removeItem('pendingPost');
      return { updated_at: p.created_at, ...p } as Post;
    } catch {
      return null;
    }
  });
  const [session, setSession] = useState<Session | null>(null);
  const [mediaFiles, setMediaFiles] = useState<MediaFile[]>([]);
  const [isStarred, setIsStarred] = useState(false);
  const [secretUrl, setSecretUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [togglingStar, setTogglingStar] = useState(false);
  const [generatingLink, setGeneratingLink] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isSummarizationPending, setIsSummarizationPending] = useState(false);
  const [revokingLink, setRevokingLink] = useState(false);
  const [patientSummary, setPatientSummary] = useState<PatientSummary | null>(null);
  const [patientSummaryLoading, setPatientSummaryLoading] = useState(false);
  const [patientSummaryError, setPatientSummaryError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState('');
  const [showShareUrl, setShowShareUrl] = useState(false);
  const params = useParams();
  const router = useRouter();
  const postId = params?.id as string;

  useLayoutEffect(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const resolve = (window as any).__vtResolve as (() => void) | undefined;
    if (resolve) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (window as any).__vtResolve = null;
      resolve();
    }
  }, []);

  useEffect(() => {
    const checkSessionAndFetch = async () => {
      setLoading(true);
      setError(null);
      try {
        const { data: { session: currentSession }, error: sessionError } = await supabase.auth.getSession();
        if (sessionError) throw sessionError;
        setSession(currentSession);
        if (!postId) { setError("Post ID is missing."); setLoading(false); return; }
        await Promise.all([fetchPost(postId), fetchMediaFiles(postId)]);
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : 'An unknown error occurred during setup.';
        setError(`Failed to load page: ${message}`);
      } finally {
        setLoading(false);
      }
    };
    checkSessionAndFetch();
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => setSession(session));
    return () => subscription?.unsubscribe();
  }, [postId, router]);

  const fetchPost = async (id: string) => {
    try {
      const { data, error: fetchError } = await supabase.from('posts').select('*').eq('id', id).single();
      if (fetchError) {
        setError(prev => prev || (fetchError.code === 'PGRST116' ? "Post not found or permission denied." : fetchError.message));
        setPost(null); setIsStarred(false); setSecretUrl(null);
      } else {
        setPost(data); setIsStarred(data.is_starred); setSecretUrl(data.secret_url || null);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      setError(prev => prev || `Failed to load post: ${message}`);
      setPost(null);
    }
  };

  const fetchMediaFiles = async (id: string) => {
    try {
      const { data, error: fetchError } = await supabase.from('media_files').select('*').eq('post_id', id).order('uploaded_at', { ascending: true });
      if (fetchError) throw fetchError;
      const fetchedMedia = data || [];
      setMediaFiles(fetchedMedia);
      checkSummaryStatus(post, fetchedMedia);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      setError(prev => prev || `Failed to load media: ${message}`);
      setMediaFiles([]);
    }
  };

  const checkSummaryStatus = (currentPost: Post | null, currentMedia: MediaFile[]) => {
    if (currentPost && !currentPost.summary) {
      setIsSummarizationPending(currentMedia.some(f => f.file_type?.includes('pdf')));
    } else {
      setIsSummarizationPending(false);
    }
  };

  const getMediaUrl = (filePath: string): string =>
    supabase.storage.from('post-media').getPublicUrl(filePath).data.publicUrl;

  const toggleStar = async () => {
    if (!post || togglingStar) return;
    setTogglingStar(true);
    const newVal = !isStarred;
    try {
      setIsStarred(newVal);
      const { error: updateError } = await supabase.from('posts').update({ is_starred: newVal }).eq('id', post.id);
      if (updateError) { setIsStarred(!newVal); throw updateError; }
      setPost(prev => prev ? { ...prev, is_starred: newVal } : null);
    } catch (err) {
      console.error('Error toggling star:', err);
    } finally {
      setTogglingStar(false);
    }
  };

  const generateShareLink = async () => {
    if (!post || generatingLink) return;
    setGeneratingLink(true);
    try {
      let link = secretUrl;
      if (!link) {
        const newSecret = uuidv4();
        const { data: updated, error: updateError } = await supabase.from('posts').update({ secret_url: newSecret }).eq('id', post.id).select('secret_url').single();
        if (updateError) throw updateError;
        link = updated.secret_url;
        setSecretUrl(link);
        setPost(prev => prev ? { ...prev, secret_url: link } : null);
      }
      setShowShareUrl(true);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Could not generate share link';
      setError(`Error: ${message}`);
    } finally {
      setGeneratingLink(false);
    }
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text).catch(() => alert('Failed to copy.'));
    alert('Share link copied to clipboard!');
  };

  const revokeShareLink = async () => {
    if (!session?.user || !post || !secretUrl || revokingLink) return;
    setRevokingLink(true);
    try {
      const { error: updateError } = await supabase.from('posts').update({ secret_url: null }).eq('id', post.id).eq('user_id', session.user.id);
      if (updateError) throw updateError;
      setSecretUrl(null);
      setPost(prev => prev ? { ...prev, secret_url: null } : null);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Could not revoke link';
      setError(`Error: ${message}`);
    } finally {
      setRevokingLink(false);
    }
  };

  const handleDelete = async () => {
    if (!post || deleting) return;
    if (!window.confirm("Delete this post and all its media? This cannot be undone.")) return;
    setDeleting(true);
    try {
      const paths = mediaFiles.map(f => f.file_path);
      if (paths.length > 0) await supabase.storage.from('post-media').remove(paths);
      await supabase.from('media_files').delete().eq('post_id', post.id);
      const { error: postErr } = await supabase.from('posts').delete().eq('id', post.id);
      if (postErr) throw postErr;
      router.push('/');
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      setError(`Deletion failed: ${message}`);
      setDeleting(false);
    }
  };

  useEffect(() => {
    if (!postId) return;
    checkSummaryStatus(post, mediaFiles);
    const channel = supabase.channel(`post_updates_${postId}`)
      .on<Post>('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'posts', filter: `id=eq.${postId}` }, (payload) => {
        const updated = payload.new as Post;
        if (post && updated.summary !== post.summary) {
          setPost(prev => prev ? { ...prev, summary: updated.summary, updated_at: updated.updated_at } : null);
          setIsSummarizationPending(false);
        }
      })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [postId, post, mediaFiles]);

  useEffect(() => {
    const fetchExistingPatientSummary = async () => {
      if (!post) return;
      setPatientSummaryLoading(true);
      try {
        const { data } = await supabase.from('patient_summaries').select('*').eq('post_id', post.id).order('created_at', { ascending: false }).limit(1).maybeSingle();
        setPatientSummary(data?.summary_text ? { id: data.id, summary: data.summary_text } : null);
      } catch { /* ignore */ } finally {
        setPatientSummaryLoading(false);
      }
    };
    fetchExistingPatientSummary();
  }, [post]);

  const handleGeneratePatientSummary = async (customFeedback?: string) => {
    if (!post) return;
    setPatientSummaryLoading(true);
    setPatientSummaryError(null);
    try {
      const res = await fetch('/api/patient-summary', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ post_id: post.id, feedback: customFeedback || '' }) });
      const data = await res.json();
      if (res.ok && data.summary) { setPatientSummary({ id: data.id, summary: data.summary }); setFeedback(''); }
      else setPatientSummaryError(data.error || 'Failed to generate patient summary.');
    } catch { setPatientSummaryError('Failed to generate patient summary.'); }
    finally { setPatientSummaryLoading(false); }
  };

  useEffect(() => {
    if (post) document.title = post.content.split('\n').find(l => l.trim()) || 'Medical Note';
  }, [post]);

  if (loading && !post) return <div className="py-8 text-center text-gray-400 text-sm">Loading post...</div>;
  if (error && !post) return <div className="py-8 text-center"><p className="text-red-600 mb-4">{error}</p><Link href="/"><a className="text-blue-600 hover:underline">Go back</a></Link></div>;
  if (!post) return <div className="py-8 text-center"><p className="text-gray-600 mb-4">Post not found.</p><Link href="/"><a className="text-blue-600 hover:underline">Go back</a></Link></div>;

  const imageFiles = mediaFiles.filter(f => f.file_type?.startsWith('image/'));
  const otherFiles = mediaFiles.filter(f => !f.file_type?.startsWith('image/'));
  const accent = getAccentColor(post.tags);
  const colors = COLOR_CONFIG[accent];

  return (
    <div className="vt-active-card">
      {/* ── Action bar ──────────────────────────────────────────── */}
      {session && session.user.id === post.user_id && (
        <div className="mb-5 flex flex-wrap justify-end items-center gap-2">
          <button
            onClick={toggleStar}
            disabled={togglingStar}
            className={`inline-flex items-center gap-1 px-3 py-1.5 rounded-lg border text-sm font-medium transition-colors disabled:opacity-50 shadow-sm ${
              isStarred ? 'bg-yellow-50 border-yellow-300 text-yellow-700 hover:bg-yellow-100' : 'bg-white border-gray-200 text-gray-600 hover:bg-gray-50'
            }`}
          >
            {togglingStar ? '…' : (isStarred ? '★ Starred' : '☆ Star')}
          </button>
          <div className="flex items-center gap-0 border border-gray-200 rounded-lg bg-white shadow-sm divide-x divide-gray-200">
            <Link href={`/posts/${post.id}/edit`} legacyBehavior>
              <a className="inline-flex items-center justify-center px-3 py-1.5 text-sm font-medium text-gray-600 hover:bg-gray-50 transition-colors rounded-l-lg">Edit</a>
            </Link>
            <button
              onClick={secretUrl ? () => setShowShareUrl(v => !v) : generateShareLink}
              disabled={generatingLink}
              className="inline-flex items-center justify-center px-3 py-1.5 text-sm font-medium text-gray-600 hover:bg-gray-50 transition-colors disabled:opacity-50"
            >
              {generatingLink ? 'Generating…' : (secretUrl ? (showShareUrl ? 'Hide' : 'Share') : 'Share')}
            </button>
            <button
              onClick={handleDelete}
              disabled={deleting}
              className="inline-flex items-center justify-center px-3 py-1.5 text-sm font-medium text-gray-500 hover:bg-red-50 hover:text-red-600 transition-colors disabled:opacity-50 rounded-r-lg"
            >
              {deleting ? 'Deleting…' : 'Delete'}
            </button>
          </div>
        </div>
      )}

      {/* ── Share URL ───────────────────────────────────────────── */}
      {secretUrl && showShareUrl && (
        <div className="mb-4 p-3 bg-gray-50 rounded-xl border border-gray-200 flex items-center justify-between gap-4">
          <span className="text-sm font-mono break-all text-gray-600">{`${window.location.origin}/share/${secretUrl}`}</span>
          <div className="flex items-center gap-2 shrink-0">
            <button onClick={() => copyToClipboard(`${window.location.origin}/share/${secretUrl}`)} className="px-2 py-1 rounded border border-gray-300 bg-gray-100 hover:bg-gray-200 text-gray-600 text-xs font-medium">Copy</button>
            {session && session.user.id === post.user_id && (
              <button onClick={revokeShareLink} disabled={revokingLink} className="px-2 py-1 rounded border border-gray-200 bg-gray-50 text-gray-500 hover:bg-red-50 hover:border-red-300 hover:text-red-600 text-xs font-medium disabled:opacity-50">
                {revokingLink ? 'Revoking…' : 'Revoke'}
              </button>
            )}
          </div>
        </div>
      )}

      {/* ── Date + tags ─────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-3 mb-4">
        <span className="text-xs text-gray-400">
          {new Date(post.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
        </span>
        {post.tags && post.tags.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {post.tags.map(tag => (
              <span key={tag} className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium border ${colors.tagBg} ${colors.tagText} ${colors.tagBorder}`}>
                {tag}
              </span>
            ))}
          </div>
        )}
      </div>

      {error && <p className="text-red-600 text-sm mb-4">Note: {error}</p>}

      {/* ── Article ─────────────────────────────────────────────── */}
      <article
        className="prose prose-gray max-w-none bg-white px-6 py-5 rounded-xl border border-gray-100 shadow-sm mb-6"
        style={{ borderLeft: `3px solid ${colors.border}` }}
      >
        <ReactMarkdown remarkPlugins={[remarkGfm]}>{post.content}</ReactMarkdown>
      </article>

      {/* ── Summary ─────────────────────────────────────────────── */}
      <div className="mt-4 mb-6">
        {isSummarizationPending && !post.summary?.startsWith('Error:') && (
          <div className="p-4 border-l-4 border-yellow-300 bg-yellow-50 rounded text-sm text-yellow-700">Summary generation in progress...</div>
        )}
        {post.summary?.startsWith('Error:') && (
          <div className="p-4 border-l-4 border-red-300 bg-red-50 rounded text-sm text-red-700">
            <h3 className="font-semibold text-red-800">Summarization Failed:</h3>
            <p className="mt-1">{post.summary}</p>
          </div>
        )}
        {post.summary && !post.summary.startsWith('Error:') && (
          <div className="p-4 border-l-4 border-blue-300 bg-blue-50 rounded">
            <h3 className="font-semibold text-blue-700">Summary:</h3>
            <div className="mt-1 text-sm text-gray-700 prose prose-sm max-w-none"><ReactMarkdown remarkPlugins={[remarkGfm]}>{post.summary}</ReactMarkdown></div>
          </div>
        )}
      </div>

      {/* ── Images ──────────────────────────────────────────────── */}
      {imageFiles.length > 0 && (
        <div className="mb-6 space-y-4">
          {imageFiles.map(file => (
            <div key={file.id}>
              <Image src={getMediaUrl(file.file_path)} alt={file.file_name} className="w-full max-w-full h-auto rounded-lg shadow" width={512} height={256} loading="lazy" unoptimized />
            </div>
          ))}
        </div>
      )}

      {/* ── Other files ─────────────────────────────────────────── */}
      {otherFiles.length > 0 && (
        <div className="mt-6 p-6 bg-white rounded-xl border border-gray-100 shadow-sm">
          <h3 className="text-base font-semibold mb-4 text-gray-800">Attached Files</h3>
          <ul className="space-y-3">
            {otherFiles.map(file => (
              <li key={file.id} className="border border-gray-200 rounded-lg p-3 text-sm flex justify-between items-center">
                <div>
                  <p className="text-gray-800 font-medium mb-1 truncate" title={file.file_name}>{file.file_name}</p>
                  <p className="text-xs text-gray-500">{file.file_type}</p>
                </div>
                <button onClick={() => window.open(getMediaUrl(file.file_path), '_blank')} className="text-blue-600 hover:underline text-xs ml-4 whitespace-nowrap">View/Download</button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* ── Patient summary ─────────────────────────────────────── */}
      <PatientSummarySection
        patientSummary={patientSummary}
        patientSummaryLoading={patientSummaryLoading}
        patientSummaryError={patientSummaryError}
        feedback={feedback}
        setFeedback={setFeedback}
        handleGeneratePatientSummary={handleGeneratePatientSummary}
        post={post}
      />

      <div className="mt-8 text-xs text-gray-400 border-t border-gray-100 pt-4">
        <p>Created: {new Date(post.created_at).toLocaleString()}</p>
        <p>Last Updated: {new Date(post.updated_at).toLocaleString()}</p>
      </div>

      {/* Fragment import suppressor */}
      <Fragment />
    </div>
  );
}
