"use client";

import { useState, useEffect, useRef, useMemo, useLayoutEffect, type ReactNode } from "react";
import Link from "next/link";
import { supabase } from "../lib/supabaseClient";
import type { Session } from "@supabase/supabase-js";
import Image from "next/image";
import { useRouter, useSearchParams } from 'next/navigation';

// Define Post type
export type Post = {
  id: string;
  created_at: string;
  content: string;
  tags: string[] | null;
  is_starred: boolean;
  user_id: string;
  imagePaths?: string[];
  hasPdf?: boolean;
  summary?: string;
};

type Props = {
  initialPosts: Post[];
};


// Strip markdown image syntax for card previews, return text and extracted image URLs
function stripMarkdownImages(content: string): { text: string; inlineImageUrls: string[] } {
  const inlineImageUrls: string[] = [];
  const text = content
    .replace(/!\[.*?\]\((.*?)\)/g, (_match, url) => { inlineImageUrls.push(url); return ''; })
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return { text, inlineImageUrls };
}

// Convert markdown to plain text for card previews
function toPlainText(md: string): string {
  return md
    .replace(/!\[.*?\]\(.*?\)/g, '')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/\*{1,2}([^*\n]+)\*{1,2}/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/^[-*+]\s+/gm, '')
    .replace(/^\d+\.\s+/gm, '')
    .replace(/^-{3,}$/gm, '')
    .replace(/\n+/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

// Wrap occurrences of `term` in <mark> for card preview highlighting
function highlightText(text: string, term: string): ReactNode {
  if (!term.trim()) return text;
  const escaped = term.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const parts = text.split(new RegExp(`(${escaped})`, 'gi'));
  if (parts.length === 1) return text;
  return (
    <>
      {parts.map((part, i) =>
        i % 2 === 1
          ? <mark key={i} className="bg-yellow-100 rounded-sm px-0.5">{part}</mark>
          : part
      )}
    </>
  );
}

function formatCardDate(iso: string): string {
  const date = new Date(iso);
  const now = new Date();
  const isToday = date.toDateString() === now.toDateString();
  const isThisYear = date.getFullYear() === now.getFullYear();
  if (isToday) {
    return date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  }
  if (isThisYear) {
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  }
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

// ── Accent color system ────────────────────────────────────────────────────
const TAG_COLOR_MAP: Record<string, string> = {
  // green — infectious / peds
  'infectious disease': 'green', 'pediatrics': 'green', 'neonatal': 'green',
  'strep': 'green', 'antibiotic': 'green', 'infection': 'green', 'vaccines': 'green',
  // orange — neuro / sleep
  'neurology': 'orange', 'sleep': 'orange', 'neuroscience': 'orange',
  // purple — education / training
  'resident': 'purple', 'teaching': 'purple', 'education': 'purple',
  // red — cardiology
  'cardiology': 'red', 'cardiac': 'red', 'heart': 'red', 'ecg': 'red',
  // teal — pulm / resp (mapped to blue since Tailwind teal ≈ blue-ish)
  'pulmonology': 'blue', 'respiratory': 'blue', 'asthma': 'blue', 'copd': 'blue',
  // orange — musculoskeletal / ortho
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
// ───────────────────────────────────────────────────────────────────────────

function PostsSkeleton() {
  return (
    <div className="space-y-4">
      {[1, 2, 3, 4, 5].map((i) => (
        <div key={i} className="p-6 bg-white rounded-lg shadow animate-pulse">
          <div className="h-3 bg-gray-200 rounded w-24 mb-3" />
          <div className="space-y-2">
            <div className="h-4 bg-gray-200 rounded w-full" />
            <div className="h-4 bg-gray-200 rounded w-5/6" />
            <div className="h-4 bg-gray-200 rounded w-4/6" />
          </div>
        </div>
      ))}
    </div>
  );
}

export default function PostsClient({ initialPosts }: Props) {
  const [session, setSession] = useState<Session | null>(null);
  const [posts, setPosts] = useState<Post[]>(() => {
    if (typeof window === 'undefined') return initialPosts;
    try {
      const cached = sessionStorage.getItem('postsCache');
      if (cached) return JSON.parse(cached) as Post[];
    } catch { /* ignore */ }
    return initialPosts;
  });
  const [loadingSession, setLoadingSession] = useState(true);
  const [loadingPosts, setLoadingPosts] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const postsContainerRef = useRef<HTMLDivElement | null>(null);
  const firstFetchComplete = useRef<boolean>(
    typeof window !== 'undefined' && !!sessionStorage.getItem('postsCache')
  );
  const router = useRouter();
  const searchParams = useSearchParams();

  // Filters and search term are driven by URL params (managed by the layout)
  const searchTerm = searchParams?.get('q') || '';
  const showOnlyMine = searchParams?.get('mine') === '1';
  const showOnlyStarred = searchParams?.get('starred') === '1';

  // Fetch session and listen for changes
  useEffect(() => {
    setLoadingSession(true);
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      setLoadingSession(false);
    });
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session);
      if (!session) {
        setPosts([]);
        setError(null);
      }
    });
    return () => subscription?.unsubscribe();
  }, []);

  // Fetch posts when session, searchTerm, or mine-filter changes
  useEffect(() => {
    const fetchAndSetPosts = async () => {
      setLoadingPosts(true);
      setError(null);
      try {
        let queryBuilder = supabase
          .from("posts")
          .select("id, created_at, content, tags, is_starred, user_id")
          .order("created_at", { ascending: false });
        if (session && showOnlyMine) {
          queryBuilder = queryBuilder.eq("user_id", session.user.id);
        }
        if (searchTerm.trim()) {
          // Full-text search on the indexed fts column (stemming + ranking),
          // OR exact tag match. Sanitise the term to keep PostgREST syntax clean.
          const term = searchTerm.trim().replace(/[(),]/g, ' ').trim();
          queryBuilder = queryBuilder.or(
            `fts.plfts(english).${term},tags.cs.{${term}}`
          );
        }
        const { data: postsData, error: fetchError } = await queryBuilder;
        if (fetchError) throw fetchError;
        let postsWithImages: Post[] = (postsData || []).map((post) => ({
          ...post,
          user_id: (post as { user_id?: string }).user_id || '',
        }));
        if (postsWithImages.length > 0) {
          const postIds = postsWithImages.map((p) => p.id);
          const { data: mediaFiles, error: mediaError } = await supabase
            .from("media_files")
            .select("post_id, file_path, file_type")
            .in("post_id", postIds);
          if (!mediaError && mediaFiles) {
            const postMediaInfo: Record<string, { imagePaths: string[]; hasPdf: boolean }> = {};
            mediaFiles.forEach((file) => {
              if (!file.post_id || !file.file_path) return;
              if (!postMediaInfo[file.post_id]) {
                postMediaInfo[file.post_id] = { imagePaths: [], hasPdf: false };
              }
              if (file.file_type?.includes("pdf")) {
                postMediaInfo[file.post_id].hasPdf = true;
              }
              if (file.file_type?.startsWith("image/")) {
                if (!postMediaInfo[file.post_id].imagePaths.includes(file.file_path)) {
                  postMediaInfo[file.post_id].imagePaths.push(file.file_path);
                }
              }
            });
            postsWithImages = postsWithImages.map((post) => ({
              ...post,
              user_id: post.user_id || '',
              imagePaths: postMediaInfo[post.id]?.imagePaths || [],
              hasPdf: postMediaInfo[post.id]?.hasPdf || false,
            }));
          }
        }
        setPosts(postsWithImages);
        firstFetchComplete.current = true;
        sessionStorage.setItem('postsCache', JSON.stringify(postsWithImages));
      } catch (err) {
        const message = err instanceof Error ? err.message : "An unknown error occurred";
        setError(`Failed to load posts: ${message}`);
        setPosts([]);
      } finally {
        setLoadingPosts(false);
      }
    };
    fetchAndSetPosts();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session, searchTerm, showOnlyMine]);

  const getPublicImageUrl = (path: string): string =>
    supabase.storage.from("post-media").getPublicUrl(path).data.publicUrl;

  // Restore scroll position robustly: wait until posts are rendered in the DOM
  useEffect(() => {
    let raf: number | null = null;
    function tryRestoreScroll() {
      const saved = sessionStorage.getItem('postsScroll');
      if (saved && postsContainerRef.current && postsContainerRef.current.children.length > 0) {
        window.scrollTo(0, parseInt(saved, 10));
        sessionStorage.removeItem('postsScroll');
      } else if (saved) {
        raf = requestAnimationFrame(tryRestoreScroll);
      }
    }
    tryRestoreScroll();
    return () => {
      if (raf) cancelAnimationFrame(raf);
    };
  }, [posts]);

  // When returning to the list, restore scroll + view-transition-name on the last-viewed
  // card synchronously (before paint) so the View Transitions API captures the right state,
  // then resolve the waiting back-transition promise.
  useLayoutEffect(() => {
    if (typeof window === 'undefined' || posts.length === 0) return;
    const lastId = sessionStorage.getItem('lastViewedPostId');
    if (!lastId) return;
    const card = document.querySelector<HTMLElement>(`[data-post-id="${lastId}"]`);
    if (!card) return;

    // Restore scroll synchronously so the card is visible when the new state is captured.
    const savedScroll = sessionStorage.getItem('postsScroll');
    if (savedScroll) {
      window.scrollTo(0, parseInt(savedScroll, 10));
      sessionStorage.removeItem('postsScroll');
    }

    card.style.setProperty('view-transition-name', 'active-card');

    // Resolve the waiting back-transition (set up in the detail page back button handler).
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const resolve = (window as any).__vtResolve as (() => void) | undefined;
    if (resolve) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (window as any).__vtResolve = null;
      resolve();
    }

    const timer = setTimeout(() => {
      card.style.removeProperty('view-transition-name');
      sessionStorage.removeItem('lastViewedPostId');
    }, 600);
    return () => clearTimeout(timer);
  }, [posts]);

  // Background refresh: fetch new posts and prepend if found
  useEffect(() => {
    if (!session) return;
    (async () => {
      try {
        const queryBuilder = supabase
          .from("posts")
          .select("id, created_at, content, tags, is_starred")
          .eq("user_id", session.user.id)
          .order("created_at", { ascending: false });
        const { data: postsData, error: fetchError } = await queryBuilder;
        if (fetchError) throw fetchError;
        let postsWithImages: Post[] = (postsData || []).map((post) => ({
          ...post,
          user_id: (post as { user_id?: string }).user_id || '',
        }));
        if (postsWithImages.length > 0) {
          const postIds = postsWithImages.map((p) => p.id);
          const { data: mediaFiles, error: mediaError } = await supabase
            .from("media_files")
            .select("post_id, file_path, file_type")
            .in("post_id", postIds);
          if (!mediaError && mediaFiles) {
            const postMediaInfo: Record<string, { imagePaths: string[]; hasPdf: boolean }> = {};
            mediaFiles.forEach((file) => {
              if (!file.post_id || !file.file_path) return;
              if (!postMediaInfo[file.post_id]) {
                postMediaInfo[file.post_id] = { imagePaths: [], hasPdf: false };
              }
              if (file.file_type?.includes("pdf")) {
                postMediaInfo[file.post_id].hasPdf = true;
              }
              if (file.file_type?.startsWith("image/")) {
                if (!postMediaInfo[file.post_id].imagePaths.includes(file.file_path)) {
                  postMediaInfo[file.post_id].imagePaths.push(file.file_path);
                }
              }
            });
            postsWithImages = postsWithImages.map((post) => ({
              ...post,
              user_id: post.user_id || '',
              imagePaths: postMediaInfo[post.id]?.imagePaths || [],
              hasPdf: postMediaInfo[post.id]?.hasPdf || false,
            }));
          }
        }
        // Prepend new posts if found
        if (postsWithImages.length > 0 && posts.length > 0 && postsWithImages[0].id !== posts[0].id) {
          // Find new posts not in current list
          const newPosts = postsWithImages.filter(p => !posts.some(q => q.id === p.id));
          if (newPosts.length > 0) {
            // Merge and deduplicate by id
            const merged = [...newPosts, ...posts];
            const deduped = Array.from(new Map(merged.map(p => [p.id, p])).values());
            setPosts(deduped);
          }
        } else if (postsWithImages.length > 0 && posts.length === 0) {
          setPosts(postsWithImages);
        }
      } catch {
        // Ignore background errors
      }
    })();
  }, [session]);

  useEffect(() => {
    if (session) {
      console.log('Current session user ID:', session.user.id);
    } else {
      console.log('No user session');
    }
  }, [session]);

  const renderPostsList = useMemo(() => {
    // Show skeleton until the first real fetch completes — prevents flash of stale cached data
    if (!firstFetchComplete.current && loadingPosts) {
      return <PostsSkeleton />;
    }

    let visiblePosts = posts;
    if (showOnlyMine && session) {
      visiblePosts = visiblePosts.filter((p) => p.user_id === session.user.id);
    }
    if (showOnlyStarred) {
      visiblePosts = visiblePosts.filter((p) => p.is_starred);
    }
    if (error) {
      return <p className="text-center text-red-600">{error}</p>;
    }
    if (posts.length === 0 && !searchTerm.trim()) {
      return (
        <p className="text-center text-gray-500">
          You haven&apos;t created any posts yet.
          <Link href="/posts/new" legacyBehavior>
            <a className="text-blue-600 hover:underline ml-1">Create one now!</a>
          </Link>
        </p>
      );
    }
    if (posts.length === 0 && searchTerm.trim()) {
      return (
        <p className="text-center text-gray-500">
          No posts found matching &quot;{searchTerm}&quot;.
        </p>
      );
    }
    if (visiblePosts.length === 0 && (showOnlyMine || showOnlyStarred)) {
      return (
        <p className="text-center text-gray-500">
          No {showOnlyStarred ? 'starred ' : ''}{showOnlyMine ? 'posts by you' : 'posts'}
          {searchTerm.trim() ? ` matching "${searchTerm}"` : ''}.
        </p>
      );
    }
    if (visiblePosts.length > 0) {
      return (
        <div ref={postsContainerRef} className="space-y-4">
          {visiblePosts.map((post) => {
            const accent = getAccentColor(post.tags);
            const colors = COLOR_CONFIG[accent];
            return (
            <Link href={`/posts/${post.id}`} legacyBehavior passHref key={post.id}>
              <a
                className="block bg-white rounded-xl shadow-sm border border-gray-100 px-5 py-4 hover:shadow-md transition-shadow duration-150 cursor-pointer focus:ring-2 focus:ring-blue-500"
                tabIndex={0}
                role="button"
                aria-label="Open post"
                data-post-id={post.id}
                style={{ textDecoration: "none", borderLeft: `3px solid ${colors.border}` }}
                onClick={(e) => {
                  e.preventDefault();
                  const card = e.currentTarget as HTMLElement;
                  card.style.setProperty('view-transition-name', 'active-card');
                  sessionStorage.setItem('lastViewedPostId', post.id);
                  sessionStorage.setItem('pendingPost', JSON.stringify(post));
                  sessionStorage.setItem('postsScroll', window.scrollY.toString());

                  if (!('startViewTransition' in document)) {
                    router.push(`/posts/${post.id}`);
                    return;
                  }

                  // IMPORTANT: set __vtResolve on window BEFORE calling startViewTransition.
                  // In Safari the callback is scheduled on a later rAF (not a microtask),
                  // so the new page's useLayoutEffect can fire before the callback runs.
                  // Setting it first eliminates that race condition.
                  let vtResolve!: () => void;
                  const vtPromise = new Promise<void>(r => { vtResolve = r; });
                  // eslint-disable-next-line @typescript-eslint/no-explicit-any
                  (window as any).__vtResolve = vtResolve;

                  // eslint-disable-next-line @typescript-eslint/no-explicit-any
                  (document as any).startViewTransition(async () => { await vtPromise; });
                  router.push(`/posts/${post.id}`);
                }}
              >
                {(() => {
                  const { text, inlineImageUrls } = stripMarkdownImages(post.content);
                  const plain = toPlainText(text);
                  const newlineIdx = plain.indexOf('. ');
                  const title = newlineIdx > 0 && newlineIdx < 120 ? plain.substring(0, newlineIdx + 1) : plain.substring(0, 80);
                  const body = plain.substring(title.length).trim();
                  const bodyPreview = body.substring(0, 160) + (body.length > 160 ? "…" : "");
                  return (
                    <>
                      <div className="flex items-center gap-2 mb-2">
                        {post.hasPdf && <span title="Contains PDF" className="text-xs">📄</span>}
                        <span className="text-xs text-gray-400">{formatCardDate(post.created_at)}</span>
                      </div>
                      <p className="text-gray-900 text-sm font-semibold leading-snug mb-1">
                        {highlightText(title, searchTerm)}
                      </p>
                      {bodyPreview && (
                        <p className="text-gray-500 text-sm leading-relaxed">
                          {highlightText(bodyPreview, searchTerm)}
                        </p>
                      )}
                      {inlineImageUrls.length > 0 && (
                        <div className="mt-3 grid grid-cols-4 gap-2">
                          {inlineImageUrls.slice(0, 4).map((url, i) => (
                            <div key={i} className="w-full h-20 bg-gray-100 rounded overflow-hidden flex items-center justify-center">
                              {/* eslint-disable-next-line @next/next/no-img-element */}
                              <img src={url} alt="" className="w-full h-full object-cover" loading="lazy" />
                            </div>
                          ))}
                        </div>
                      )}
                    </>
                  );
                })()}
                {post.tags && post.tags.length > 0 && (
                  <div className="flex flex-wrap gap-1.5 mt-3">
                    {post.tags.map(tag => (
                      <button
                        key={tag}
                        onClick={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          router.replace(`/?q=${encodeURIComponent(tag)}`, { scroll: false });
                        }}
                        className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium border transition-opacity hover:opacity-80 ${colors.tagBg} ${colors.tagText} ${colors.tagBorder}`}
                      >
                        {tag}
                      </button>
                    ))}
                  </div>
                )}
                {post.imagePaths && post.imagePaths.length > 0 && (
                  <div className="mt-3 grid grid-cols-4 gap-2">
                    {post.imagePaths.slice(0, 4).map((path, index) => (
                      <div key={index} className="w-full h-20 bg-gray-100 rounded overflow-hidden">
                        <Image
                          src={getPublicImageUrl(path)}
                          alt={`Post thumbnail ${index + 1}`}
                          className="w-full h-full object-cover rounded"
                          width={128}
                          height={80}
                          loading="lazy"
                          unoptimized
                        />
                      </div>
                    ))}
                  </div>
                )}
              </a>
            </Link>
            );
          })}
        </div>
      );
    }
    return null;
  }, [posts, showOnlyMine, showOnlyStarred, session, loadingPosts, error, searchTerm, getPublicImageUrl]);

  if (loadingSession) {
    return <p className="text-center text-gray-400 py-8 text-sm">Loading...</p>;
  }

  return <>{renderPostsList}</>;
} 