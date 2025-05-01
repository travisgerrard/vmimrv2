"use client";

import { useState, useEffect, useRef } from "react";
import Link from "next/link";
import { supabase } from "../lib/supabaseClient";
import type { Session } from "@supabase/supabase-js";
import ReactMarkdown from "react-markdown";
import { Auth } from "@supabase/auth-ui-react";
import { ThemeSupa } from "@supabase/auth-ui-shared";
import Image from "next/image";
import remarkGfm from 'remark-gfm';
import { useRouter } from "next/navigation";
import { format, subDays } from 'date-fns';

// Define Post type
export type Post = {
  id: string;
  created_at: string;
  content: string;
  tags: string[] | null;
  is_starred: boolean;
  imagePaths?: string[];
  hasPdf?: boolean;
};

type QuizQuestion = {
  noteId: string;
  question: string;
  choices: string[];
  correct: string;
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
  const router = useRouter();
  const [session, setSession] = useState<Session | null>(null);
  const [posts, setPosts] = useState<Post[]>(initialPosts);
  const [showOnlyStarred, setShowOnlyStarred] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const [loadingSession, setLoadingSession] = useState(true);
  const [loadingPosts, setLoadingPosts] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [signedThumbnailUrls, setSignedThumbnailUrls] = useState<Record<string, string | null>>({});
  const postsContainerRef = useRef<HTMLDivElement | null>(null);

  // Quiz state
  const [quizLoading, setQuizLoading] = useState(false);
  const [quizQuestions, setQuizQuestions] = useState<QuizQuestion[] | null>(null);
  const [quizError, setQuizError] = useState<string | null>(null);
  const [quizAnswers, setQuizAnswers] = useState<Record<number, string>>({});
  const [quizRange, setQuizRange] = useState<{from: string, to: string}>(() => {
    const today = format(new Date(), 'yyyy-MM-dd');
    const weekAgo = format(subDays(new Date(), 7), 'yyyy-MM-dd');
    return { from: weekAgo, to: today };
  });

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
        setShowOnlyStarred(false);
        setSearchTerm("");
      }
    });
    return () => subscription?.unsubscribe();
  }, []);

  // Fetch posts when session is available OR when debounced search term or starred filter changes
  useEffect(() => {
    if (session) {
      const fetchAndSetPosts = async () => {
        setLoadingPosts(true);
        setError(null);
        try {
          let queryBuilder = supabase
            .from("posts")
            .select("id, created_at, content, tags, is_starred")
            .eq("user_id", session.user.id);
          if (debouncedSearchTerm.trim()) {
            queryBuilder = queryBuilder.ilike("content", `%${debouncedSearchTerm.trim()}%`);
          }
          queryBuilder = queryBuilder.order("created_at", { ascending: false });
          const { data: postsData, error: fetchError } = await queryBuilder;
          if (fetchError) throw fetchError;
          let postsWithImages: Post[] = postsData || [];
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
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session, debouncedSearchTerm, showOnlyStarred]);

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
        let postsWithImages: Post[] = postsData || [];
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
            setPosts(prev => [...newPosts, ...prev]);
          }
        } else if (postsWithImages.length > 0 && posts.length === 0) {
          setPosts(postsWithImages);
        }
      } catch {
        // Ignore background errors
      }
    })();
  }, [session]);

  const handleLogout = async () => {
    setLoadingSession(true);
    await supabase.auth.signOut();
    setSession(null);
    setPosts([]);
    setError(null);
    setShowOnlyStarred(false);
    setSearchTerm("");
    setLoadingSession(false);
  };

  const handlePostClick = (postId: string) => {
    sessionStorage.setItem('postsScroll', window.scrollY.toString());
    router.push(`/posts/${postId}`);
  };

  // Fetch notes in range and generate quiz
  async function handleGenerateQuiz() {
    setQuizLoading(true);
    setQuizError(null);
    setQuizQuestions(null);
    setQuizAnswers({});
    try {
      // Fetch notes in range from Supabase
      const { data: notes, error } = await supabase
        .from('posts')
        .select('id, content, created_at')
        .gte('created_at', quizRange.from)
        .lte('created_at', quizRange.to)
        .order('created_at', { ascending: false });
      if (error) throw error;
      if (!notes || notes.length === 0) {
        setQuizError('No notes found in selected range.');
        setQuizLoading(false);
        return;
      }
      // Call API
      const res = await fetch('/api/generate-quiz', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ notes }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Failed to generate quiz');
      setQuizQuestions(json.questions);
    } catch (e: unknown) {
      setQuizError(e instanceof Error ? e.message : 'Failed to generate quiz');
    } finally {
      setQuizLoading(false);
    }
  }

  const renderPostsList = () => {
    let visiblePosts = posts;
    if (showOnlyStarred) {
      visiblePosts = visiblePosts.filter((p) => p.is_starred);
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
    if (visiblePosts.length === 0 && showOnlyStarred) {
      return (
        <p className="text-center text-gray-500">
          You have no starred posts {searchTerm.trim() ? `matching "${searchTerm}"` : ''}.
        </p>
      );
    }
    if (visiblePosts.length > 0) {
      return (
        <div ref={postsContainerRef} className="space-y-4">
          {visiblePosts.map((post) => (
            <a
              key={post.id}
              className="block p-6 bg-white rounded-lg shadow hover:shadow-md transition-shadow duration-150 cursor-pointer"
              onClick={() => handlePostClick(post.id)}
              tabIndex={0}
              onKeyDown={e => { if (e.key === 'Enter') handlePostClick(post.id); }}
            >
              <div className="prose max-w-none mb-4 text-gray-700">
                <ReactMarkdown remarkPlugins={[remarkGfm]}>
                  {post.content.substring(0, 200) + (post.content.length > 200 ? "..." : "")}
                </ReactMarkdown>
              </div>
              {post.imagePaths && post.imagePaths.length > 0 && (
                <div className="mt-2 grid grid-cols-4 gap-2">
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
              <div className="text-xs text-gray-500 flex justify-between items-center mt-4 pt-3 border-t border-gray-100">
                <span className="flex items-center">
                  {post.hasPdf && <span className="mr-2" title="Contains PDF">📄</span>}
                  {new Date(post.created_at).toLocaleString()}
                </span>
                <span className={`ml-2 ${post.is_starred ? "text-yellow-500" : "text-gray-400"}`}>
                  {post.is_starred ? "★" : "☆"}
                </span>
              </div>
            </a>
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

  if (!session) {
    const isDarkMode = typeof window !== "undefined" && document.documentElement.classList.contains("dark");
    return (
      <main className="container mx-auto p-4 md:p-8 flex justify-center items-center min-h-[calc(100vh-10rem)]">
        <div className="w-full max-w-md p-8 bg-white rounded-lg shadow-md">
          <h1 className="text-2xl font-bold mb-6 text-center text-gray-900">Welcome</h1>
          <Auth
            supabaseClient={supabase}
            appearance={{ theme: ThemeSupa }}
            view="magic_link"
            providers={[]}
            showLinks={false}
            theme={isDarkMode ? "dark" : "default"}
          />
        </div>
      </main>
    );
  }

  return (
    <main className="container mx-auto p-4 md:p-8 font-sans">
      <div className="flex flex-wrap justify-between items-center gap-4 mb-6">
        <h1 className="text-3xl font-bold text-gray-900 mb-4">Your Posts</h1>
        <div className="flex items-center gap-4">
          <button
            onClick={() => setShowOnlyStarred(!showOnlyStarred)}
            className={`px-4 py-2 rounded border border-gray-300 text-sm font-medium transition-colors disabled:opacity-50 ${
              showOnlyStarred
                ? "bg-yellow-400 border-yellow-500 text-yellow-900 hover:bg-yellow-300"
                : "bg-gray-100 border-gray-300 text-gray-700 hover:bg-gray-200"
            }`}
          >
            {showOnlyStarred ? "★ Show All" : "☆ Show Starred"}
          </button>
          <Link href="/quiz" legacyBehavior>
            <a className="inline-flex items-center px-4 py-2 rounded border border-gray-300 bg-gray-50 text-gray-700 hover:bg-gray-100 text-sm font-medium transition-colors shadow-sm focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500">
              Quiz
            </a>
          </Link>
          <Link href="/posts/new" legacyBehavior>
            <a className="inline-flex items-center px-4 py-2 rounded border border-blue-600 bg-blue-500 text-white hover:bg-blue-600 text-sm font-medium transition-colors shadow-sm focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500">
              + New Post
            </a>
          </Link>
          <button
            onClick={handleLogout}
            className="inline-flex items-center px-4 py-2 rounded border border-red-600 bg-red-500 text-white hover:bg-red-600 text-sm font-medium transition-colors shadow-sm focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-red-500"
          >
            Logout {session?.user?.email ? `(${session.user.email.split("@")[0]})` : ""}
          </button>
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
      {/* Quiz Controls */}
      <div className="mb-6 flex flex-wrap items-end gap-4">
        <div>
          <label className="block text-sm font-medium text-gray-700">From</label>
          <input type="date" value={quizRange.from} onChange={e => setQuizRange(r => ({ ...r, from: e.target.value }))} className="border rounded px-2 py-1" />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700">To</label>
          <input type="date" value={quizRange.to} onChange={e => setQuizRange(r => ({ ...r, to: e.target.value }))} className="border rounded px-2 py-1" />
        </div>
        <button
          onClick={handleGenerateQuiz}
          className="px-4 py-2 rounded border border-blue-600 bg-blue-500 text-white hover:bg-blue-600 text-sm font-medium transition-colors shadow-sm"
          disabled={quizLoading}
        >
          {quizLoading ? 'Generating Quiz...' : 'Generate Quiz'}
        </button>
      </div>
      {/* Quiz UI */}
      {quizQuestions && (
        <div className="mb-8 p-4 border rounded bg-white shadow">
          <h2 className="text-lg font-bold mb-4">Quiz</h2>
          {quizQuestions.map((q, idx) => (
            <div key={idx} className="mb-6">
              <div className="font-medium mb-2">{idx + 1}. {q.question}</div>
              <div className="space-y-1">
                {q.choices.map((choice: string, cidx: number) => (
                  <label key={cidx} className="block">
                    <input
                      type="radio"
                      name={`q${idx}`}
                      value={choice}
                      checked={quizAnswers[idx] === choice}
                      onChange={() => setQuizAnswers(a => ({ ...a, [idx]: choice }))}
                      className="mr-2"
                    />
                    {choice}
                  </label>
                ))}
              </div>
              {quizAnswers[idx] && (
                <div className={quizAnswers[idx] === q.correct ? 'text-green-600 mt-2' : 'text-red-600 mt-2'}>
                  {quizAnswers[idx] === q.correct ? 'Correct!' : `Incorrect. Correct answer: ${q.correct}`}
                </div>
              )}
              <div className="mt-2">
                <a
                  href={`/posts/${q.noteId}`}
                  className="text-blue-600 hover:underline text-xs"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  View Source Note
                </a>
              </div>
            </div>
          ))}
        </div>
      )}
      {quizError && <div className="text-red-600 mb-4">{quizError}</div>}
      {renderPostsList()}
    </main>
  );
} 