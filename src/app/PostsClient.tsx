"use client";

import { useState, useEffect, useRef } from "react";
import Link from "next/link";
import { supabase } from "../lib/supabaseClient";
import type { Session } from "@supabase/supabase-js";
import ReactMarkdown from "react-markdown";
import Image from "next/image";
import remarkGfm from 'remark-gfm';
import { Menu } from '@headlessui/react';
import { Bars3Icon } from '@heroicons/react/24/outline';

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

function useDebounce(value: string, delay: number): string {
  const [debouncedValue, setDebouncedValue] = useState(value);
  useEffect(() => {
    const handler = setTimeout(() => setDebouncedValue(value), delay);
    return () => clearTimeout(handler);
  }, [value, delay]);
  return debouncedValue;
}

type Props = {
  initialPosts: Post[];
};

export default function PostsClient({ initialPosts }: Props) {
  const [session, setSession] = useState<Session | null>(null);
  const [posts, setPosts] = useState<Post[]>(initialPosts);
  const [showOnlyMine, setShowOnlyMine] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const [loadingSession, setLoadingSession] = useState(true);
  const [loadingPosts, setLoadingPosts] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [signedThumbnailUrls, setSignedThumbnailUrls] = useState<Record<string, string | null>>({});
  const postsContainerRef = useRef<HTMLDivElement | null>(null);

  const debouncedSearchTerm = useDebounce(searchTerm, 500);

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
        setShowOnlyMine(false);
        setSearchTerm("");
      }
    });
    return () => subscription?.unsubscribe();
  }, []);

  // Fetch posts when session is available OR when debounced search term or starred filter changes
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
        if (debouncedSearchTerm.trim()) {
          queryBuilder = queryBuilder.textSearch('fts', debouncedSearchTerm.trim(), { type: 'websearch' });
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
  }, [session, debouncedSearchTerm, showOnlyMine]);

  // Effect to fetch signed URLs for all unique image paths when posts change
  useEffect(() => {
    const fetchAllSignedUrls = async () => {
      const uniquePaths = new Set<string>();
      posts.forEach((post) => {
        post.imagePaths?.forEach((path) => {
          if (path) uniquePaths.add(path);
        });
      });
      if (uniquePaths.size === 0) {
        setSignedThumbnailUrls({});
        return;
      }
      const urlsMap: Record<string, string | null> = {};
      const fetchPromises = Array.from(uniquePaths).map(async (path) => {
        try {
          const { data, error } = await supabase.storage
            .from("post-media")
            .createSignedUrl(path, 60 * 5);
          if (error) throw error;
          urlsMap[path] = data.signedUrl;
        } catch {
          urlsMap[path] = null;
        }
      });
      await Promise.all(fetchPromises);
      setSignedThumbnailUrls((prevUrls) => ({ ...prevUrls, ...urlsMap }));
    };
    fetchAllSignedUrls();
  }, [posts]);

  // Hydrate posts from sessionStorage cache on mount (client only)
  useEffect(() => {
    if (typeof window !== 'undefined') {
      const cached = sessionStorage.getItem('postsCache');
      if (cached) {
        try {
          setPosts(JSON.parse(cached) as Post[]);
        } catch {
          // ignore
        }
      }
    }
  }, []);

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

  const handleLogout = async () => {
    setLoadingSession(true);
    await supabase.auth.signOut();
    setSession(null);
    setPosts([]);
    setError(null);
    setShowOnlyMine(false);
    setSearchTerm("");
    setLoadingSession(false);
  };

  const renderPostsList = () => {
    let visiblePosts = posts;
    if (showOnlyMine && session) {
      visiblePosts = visiblePosts.filter((p) => p.user_id === session.user.id);
    }
    if (posts.length === 0 && loadingPosts) {
      return <p className="text-center text-gray-500">Loading posts...</p>;
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
    if (visiblePosts.length === 0 && showOnlyMine) {
      return (
        <p className="text-center text-gray-500">
          You have no posts {searchTerm.trim() ? `matching "${searchTerm}"` : ''}.
        </p>
      );
    }
    if (visiblePosts.length > 0) {
      return (
        <div ref={postsContainerRef} className="space-y-4">
          {visiblePosts.map((post) => (
            <div key={post.id} className="bg-white rounded-lg shadow hover:shadow-md transition-shadow duration-150">
              <Link href={`/posts/${post.id}`} legacyBehavior passHref>
                <a
                  className="block p-6 cursor-pointer focus:ring-2 focus:ring-blue-500"
                  tabIndex={0}
                  role="button"
                  aria-label="Open post"
                  style={{ textDecoration: "none" }}
                >
                  {/* You can add a summary/title here if you want a clickable area */}
                  <div className="text-xs text-gray-500 flex justify-between items-center mb-2">
                    <span className="flex items-center">
                      {post.hasPdf && <span className="mr-2" title="Contains PDF">📄</span>}
                      {new Date(post.created_at).toLocaleString()}
                    </span>
                  </div>
                </a>
              </Link>
              <div className="prose max-w-none mb-4 text-gray-700 px-6 pb-6">
                <ReactMarkdown remarkPlugins={[remarkGfm]}>
                  {post.content.substring(0, 200) + (post.content.length > 200 ? "..." : "")}
                </ReactMarkdown>
              </div>
              {post.imagePaths && post.imagePaths.length > 0 && (
                <div className="mt-2 grid grid-cols-4 gap-2 px-6 pb-6">
                  {post.imagePaths.slice(0, 4).map((path, index) => {
                    const signedUrl = signedThumbnailUrls[path];
                    return (
                      <div key={index} className="w-full h-32 bg-gray-100 rounded flex items-center justify-center">
                        {signedUrl === undefined ? (
                          <span className="text-xs text-gray-500">...</span>
                        ) : signedUrl ? (
                          <Image
                            src={signedUrl}
                            alt={`Post thumbnail ${index + 1}`}
                            className="w-full h-full object-contain rounded"
                            width={128}
                            height={128}
                            loading="lazy"
                            unoptimized
                          />
                        ) : (
                          <span className="text-xs text-red-500">!</span>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          ))}
        </div>
      );
    }
    return null;
  };

  if (loadingSession) {
    return (
      <main className="container mx-auto p-4 md:p-8 text-center">
        <p className="text-gray-500">Loading session...</p>
      </main>
    );
  }

  return (
    <main className="container mx-auto p-4 md:p-8 font-sans">
      <div className="flex items-center justify-between mb-6 w-full">
        <h1 className="text-3xl font-bold text-gray-900 mb-0">{session ? 'Your Posts' : 'All Posts'}</h1>
        {/* Desktop Button Group */}
        <div className="hidden sm:flex flex-row gap-2">
          {session && (
            <>
              <button
                onClick={() => setShowOnlyMine(!showOnlyMine)}
                className={`px-4 py-2 rounded border border-gray-300 text-sm font-medium transition-colors disabled:opacity-50 ${
                  showOnlyMine
                    ? "bg-yellow-400 border-yellow-500 text-yellow-900 hover:bg-yellow-300"
                    : "bg-gray-100 border-gray-300 text-gray-700 hover:bg-gray-200"
                }`}
              >
                {showOnlyMine ? "Show All Posts" : "Show Only My Posts"}
              </button>
              <Link href="/quiz" legacyBehavior>
                <a className="inline-flex items-center justify-center px-4 py-2 rounded border border-gray-300 bg-gray-50 text-gray-700 hover:bg-gray-100 text-sm font-medium transition-colors shadow-sm focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500">
                  Quiz
                </a>
              </Link>
              <Link href="/posts/new" legacyBehavior>
                <a className="inline-flex items-center justify-center px-4 py-2 rounded border border-blue-600 bg-blue-500 text-white hover:bg-blue-600 text-sm font-medium transition-colors shadow-sm focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500">
                  + New Post
                </a>
              </Link>
              <button
                onClick={handleLogout}
                className="inline-flex items-center justify-center px-4 py-2 rounded border border-red-600 bg-red-500 text-white hover:bg-red-600 text-sm font-medium transition-colors shadow-sm focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-red-500"
              >
                Logout {session?.user?.email ? `(${session.user.email.split("@")[0]})` : ""}
              </button>
            </>
          )}
          {!session && (
            <button
              onClick={() => supabase.auth.signInWithOtp({ email: prompt('Enter your email to login:') || '' })}
              className="inline-flex items-center justify-center px-4 py-2 rounded border border-blue-600 bg-blue-100 text-blue-700 hover:bg-blue-200 text-sm font-medium transition-colors shadow-sm focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
            >
              Login
            </button>
          )}
        </div>
        {/* Mobile Hamburger Menu */}
        <div className="sm:hidden">
          <Menu as="div" className="relative inline-block text-left">
            <Menu.Button className="inline-flex items-center justify-center p-2 rounded-md text-gray-700 hover:bg-gray-200 focus:outline-none focus:ring-2 focus:ring-inset focus:ring-blue-500">
              <Bars3Icon className="h-6 w-6" aria-hidden="true" />
            </Menu.Button>
            <Menu.Items className="origin-top-right absolute right-0 mt-2 w-48 rounded-md shadow-lg bg-white ring-1 ring-black ring-opacity-5 focus:outline-none z-50">
              <div className="py-1">
                {session && (
                  <>
                    <Menu.Item>
                      {({ active }: { active: boolean }) => (
                        <button
                          onClick={() => setShowOnlyMine(!showOnlyMine)}
                          className={`w-full text-left px-4 py-2 text-sm ${
                            showOnlyMine
                              ? "bg-yellow-100 text-yellow-900"
                              : active
                              ? "bg-gray-100 text-gray-900"
                              : "text-gray-700"
                          }`}
                        >
                          {showOnlyMine ? "Show All Posts" : "Show Only My Posts"}
                        </button>
                      )}
                    </Menu.Item>
                    <Menu.Item>
                      {({ active }: { active: boolean }) => (
                        <Link href="/quiz" legacyBehavior>
                          <a className={`block px-4 py-2 text-sm ${active ? "bg-gray-100 text-gray-900" : "text-gray-700"}`}>Quiz</a>
                        </Link>
                      )}
                    </Menu.Item>
                    <Menu.Item>
                      {({ active }: { active: boolean }) => (
                        <Link href="/posts/new" legacyBehavior>
                          <a className={`block px-4 py-2 text-sm ${active ? "bg-blue-100 text-blue-900" : "text-blue-700"}`}>+ New Post</a>
                        </Link>
                      )}
                    </Menu.Item>
                    <Menu.Item>
                      {({ active }: { active: boolean }) => (
                        <button
                          onClick={handleLogout}
                          className={`w-full text-left px-4 py-2 text-sm ${active ? "bg-red-100 text-red-900" : "text-red-700"}`}
                        >
                          Logout {session?.user?.email ? `(${session.user.email.split("@")[0]})` : ""}
                        </button>
                      )}
                    </Menu.Item>
                  </>
                )}
                {!session && (
                  <Menu.Item>
                    {({ active }: { active: boolean }) => (
                      <button
                        onClick={() => supabase.auth.signInWithOtp({ email: prompt('Enter your email to login:') || '' })}
                        className={`w-full text-left px-4 py-2 text-sm ${active ? "bg-blue-100 text-blue-900" : "text-blue-700"}`}
                      >
                        Login
                      </button>
                    )}
                  </Menu.Item>
                )}
              </div>
            </Menu.Items>
          </Menu>
        </div>
      </div>
      <div className="mb-6">
        <input
          type="search"
          placeholder="Search posts by content or tags..."
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          className="block w-full px-4 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm text-gray-900 placeholder-gray-500"
        />
      </div>
      {renderPostsList()}
    </main>
  );
} 