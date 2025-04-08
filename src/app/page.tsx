'use client';

import { useState, useEffect, useMemo, useCallback } from 'react';
import Link from 'next/link';
import { supabase } from '../lib/supabaseClient';
import type { Session } from '@supabase/supabase-js';
import ReactMarkdown from 'react-markdown';
import { Auth } from '@supabase/auth-ui-react';
import { ThemeSupa } from '@supabase/auth-ui-shared';

// Define Post type
type Post = {
  id: string;
  created_at: string;
  content: string;
  tags: string[] | null;
  is_starred: boolean;
  imagePaths?: string[]; // Store file paths instead of URLs
};

// Debounce hook/utility (simple implementation)
function useDebounce(value: string, delay: number): string {
  const [debouncedValue, setDebouncedValue] = useState(value);

  useEffect(() => {
    const handler = setTimeout(() => {
      setDebouncedValue(value);
    }, delay);

    // Cancel the timeout if value changes (also on delay change or unmount)
    return () => {
      clearTimeout(handler);
    };
  }, [value, delay]);

  return debouncedValue;
}


export default function Home() {
  const [session, setSession] = useState<Session | null>(null);
  const [posts, setPosts] = useState<Post[]>([]);
  const [showOnlyStarred, setShowOnlyStarred] = useState(false);
  const [searchTerm, setSearchTerm] = useState(''); // State for search input
  const [loadingSession, setLoadingSession] = useState(true);
  const [loadingPosts, setLoadingPosts] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [signedThumbnailUrls, setSignedThumbnailUrls] = useState<Record<string, string | null>>({}); // State for signed URLs

  const debouncedSearchTerm = useDebounce(searchTerm, 500); // Debounce search term by 500ms

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
        setSearchTerm(''); // Clear search on logout
      }
    });

    return () => subscription?.unsubscribe();
  }, []);

  // Fetch posts when session is available OR when debounced search term changes
  const fetchPosts = useCallback(async (currentSession: Session | null, query: string) => {
    console.log(`[fetchPosts] Called. Query: "${query}", Session User: ${currentSession?.user?.id}`); // Log function call
    if (!currentSession?.user) return;

    setLoadingPosts(true);
    setError(null);
    try {
      let queryBuilder = supabase
        .from('posts')
        .select('id, created_at, content, tags, is_starred')
        .eq('user_id', currentSession.user.id); // Base query for user's posts

      // Apply case-insensitive partial matching if query exists
      if (query.trim()) {
        // Use ilike for partial word matching within the content
        // The pattern %term% matches the term anywhere in the string
        queryBuilder = queryBuilder.ilike('content', `%${query.trim()}%`);
        // Note: Searching within the 'tags' array with ilike requires a different approach
        // (e.g., database function or client-side filtering) if needed.
      }

      // Apply ordering
      queryBuilder = queryBuilder.order('created_at', { ascending: false });

      const { data: postsData, error: fetchError } = await queryBuilder;

      if (fetchError) throw fetchError;

      let postsWithImages: Post[] = postsData || [];

      // If posts were found, fetch their associated images
      if (postsWithImages.length > 0) {
        const postIds = postsWithImages.map(p => p.id);

        // Fetch image media files associated with these posts
        const { data: mediaFiles, error: mediaError } = await supabase
          .from('media_files')
          .select('post_id, file_path')
          .in('post_id', postIds)
          .like('file_type', 'image/%'); // Only fetch image types

        if (mediaError) {
          console.error("Error fetching media files:", mediaError);
          // Proceed without images if media fetch fails, but log the error
        } else if (mediaFiles) {
          // Create a map of postId to list of image file paths
          const imagePathsMap: Record<string, string[]> = {};
          mediaFiles.forEach(file => {
            if (file.post_id && file.file_path) {
                if (!imagePathsMap[file.post_id]) {
                    imagePathsMap[file.post_id] = [];
                }
                // Avoid adding duplicate paths per post if query returns multiple rows for same path somehow
                if (!imagePathsMap[file.post_id].includes(file.file_path)) {
                    imagePathsMap[file.post_id].push(file.file_path);
                }
            }
          });

          // Attach image paths to the corresponding posts
          postsWithImages = postsWithImages.map(post => ({
            ...post,
            imagePaths: imagePathsMap[post.id] || [], // Store paths, not URLs
          }));
        } // End else if (mediaFiles)
      } // End if (postsWithImages.length > 0)
      setPosts(postsWithImages);
    } catch (err) {
      console.error('Error fetching posts:', err);
      const message = err instanceof Error ? err.message : 'An unknown error occurred';
      setError(`Failed to load posts: ${message}`);
      setPosts([]);
    } finally {
      setLoadingPosts(false);
    }
  }, []); // useCallback depends on supabase instance which is stable

  // Effect to trigger fetchPosts based on session and debounced search term
  useEffect(() => {
    if (session) {
      fetchPosts(session, debouncedSearchTerm);
    }
  }, [session, debouncedSearchTerm, fetchPosts]); // Added fetchPosts back as dependency

  // Effect to fetch signed URLs for all unique image paths when posts change
  useEffect(() => {
    const fetchAllSignedUrls = async () => {
      // 1. Collect all unique file paths from all posts
      const uniquePaths = new Set<string>();
      posts.forEach(post => {
        post.imagePaths?.forEach(path => {
          if (path) uniquePaths.add(path);
        });
      });

      if (uniquePaths.size === 0) {
        setSignedThumbnailUrls({}); // Clear if no paths
        return;
      }

      console.log(`[Fetch All Signed URLs] Found ${uniquePaths.size} unique paths to fetch URLs for.`);

      // 2. Fetch signed URLs for unique paths concurrently
      const urlsMap: Record<string, string | null> = {};
      const fetchPromises = Array.from(uniquePaths).map(async (path) => {
        try {
          const { data, error } = await supabase.storage
            .from('post-media')
            .createSignedUrl(path, 60 * 5); // 5 min expiry

          if (error) throw error;
          urlsMap[path] = data.signedUrl;
        } catch (err) {
          console.error(`Error creating signed URL for path ${path}:`, err);
          urlsMap[path] = null; // Store null on error for this path
        }
      });

      await Promise.all(fetchPromises);

      // 3. Update the state with all fetched URLs (or nulls for errors)
      console.log(`[Fetch All Signed URLs] Finished fetching. Updating state.`);
      setSignedThumbnailUrls(prevUrls => ({ ...prevUrls, ...urlsMap })); // Merge new URLs, keeping existing ones if needed
    };

    fetchAllSignedUrls();

  }, [posts]); // Re-run whenever the posts array changes


  const handleLogout = async () => {
    setLoadingSession(true);
    await supabase.auth.signOut();
    setSession(null);
    setPosts([]);
    setError(null);
    setShowOnlyStarred(false);
    setSearchTerm('');
    setLoadingSession(false);
  };

  // Memoize the filtered posts list (applies star filter *after* search)
  const filteredPosts = useMemo(() => {
    if (showOnlyStarred) {
      return posts.filter(p => p.is_starred);
    }
    return posts;
  }, [posts, showOnlyStarred]);

  // Helper function to render the posts list or messages
  const renderPostsList = () => {
    if (loadingPosts) {
      return <p className="text-center text-gray-500">Loading posts...</p>;
    }
    if (error) {
      return <p className="text-center text-red-600">{error}</p>;
    }
    // Message when no posts exist at all for the user
    if (posts.length === 0 && !searchTerm.trim()) {
      return (
        <p className="text-center text-gray-500">
          You haven&apos;t created any posts yet.
          <Link href="/posts/new" legacyBehavior><a className="text-blue-600 hover:underline ml-1">Create one now!</a></Link>
        </p>
      );
    }
    // Message when search yields no results
     if (posts.length === 0 && searchTerm.trim()) {
        return (
          <p className="text-center text-gray-500">
            No posts found matching &quot;{searchTerm}&quot;.
          </p>
        );
      }
    // Message when star filter yields no results (but search might have)
    if (filteredPosts.length === 0 && showOnlyStarred) {
      return (
        <p className="text-center text-gray-500">
          You have no starred posts {searchTerm.trim() ? `matching &quot;{searchTerm}&quot;` : ''}.
        </p>
      );
    }
    // Display filtered list
    if (filteredPosts.length > 0) {
      return (
        <div className="space-y-4">
          {filteredPosts.map((post) => (
            <Link key={post.id} href={`/posts/${post.id}`} legacyBehavior>
              {/* Apply consistent card styling */}
              <a className="block p-6 bg-white rounded-lg shadow hover:shadow-md transition-shadow duration-150 cursor-pointer">
                {/* Remove prose class for simpler text styling within card */}
                {/* Add back prose class for markdown styling */}
                <div className="prose max-w-none mb-4 text-gray-700">
                  {/* Use standard Markdown component, limit preview length */}
                  <ReactMarkdown>{post.content.substring(0, 200) + (post.content.length > 200 ? '...' : '')}</ReactMarkdown>
                </div>
                {/* Thumbnail Grid - Use imagePaths and signedThumbnailUrls */}
                {post.imagePaths && post.imagePaths.length > 0 && (
                  <div className="mt-2 grid grid-cols-4 gap-2">
                    {post.imagePaths.slice(0, 4).map((path, index) => {
                      const signedUrl = signedThumbnailUrls[path]; // Get URL from state using path as key
                      return (
                        // Adjust thumbnail placeholder background
                        <div key={index} className="w-full h-32 bg-gray-100 rounded flex items-center justify-center"> {/* Increased height */}
                          {signedUrl === undefined ? ( // Still loading?
                             <span className="text-xs text-gray-500">...</span>
                          ) : signedUrl ? ( // URL fetched successfully?
                            <img
                              src={signedUrl}
                              alt={`Post thumbnail ${index + 1}`}
                              className="w-full h-full object-contain rounded" // Contain image within bounds
                              loading="lazy"
                            />
                          ) : ( // URL fetch failed (null)?
                             <span className="text-xs text-red-500">!</span> // Error indicator
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
                {/* Footer with date and star */}
                {/* Adjust footer text color and add top padding/border */}
                <div className="text-xs text-gray-500 flex justify-between items-center mt-4 pt-3 border-t border-gray-100">
                  <span>{new Date(post.created_at).toLocaleString()}</span>
                  <span className={`ml-2 ${post.is_starred ? 'text-yellow-500' : 'text-gray-400'}`}>
                    {post.is_starred ? '★' : '☆'}
                  </span>
                </div>
              </a>
            </Link>
          ))}
        </div>
      );
    }
    return null;
  };


  // Render Loading state
  if (loadingSession) {
    return (
      <main className="container mx-auto p-4 md:p-8 text-center">
        <p className="text-gray-500">Loading session...</p>
      </main>
    );
  }

  // Render Logged Out state
  if (!session) {
    // Determine theme based on HTML class (set by layout.tsx if theme switching was added back)
    const isDarkMode = typeof window !== 'undefined' && document.documentElement.classList.contains('dark');
    return (
      <main className="container mx-auto p-4 md:p-8 flex justify-center items-center min-h-[calc(100vh-10rem)]">
        <div className="w-full max-w-md p-8 bg-white rounded-lg shadow-md"> {/* Removed dark mode class */}
          <h1 className="text-2xl font-bold mb-6 text-center text-gray-900">Welcome</h1> {/* Removed dark mode class */}
          <Auth
            supabaseClient={supabase}
            appearance={{ theme: ThemeSupa }}
            view="magic_link"
            providers={[]}
            showLinks={false}
            theme={isDarkMode ? 'dark' : 'default'} // Match Supabase theme
          />
        </div>
      </main>
    );
  }

  // Render Logged In state
  return (
    <main className="container mx-auto p-4 md:p-8 font-sans">
      {/* Header Section */}
      <div className="flex flex-wrap justify-between items-center gap-4 mb-6">
        {/* Removed dark:text-white */}
        <h1 className="text-3xl font-bold text-gray-900 mb-4">Your Posts</h1>
        <div className="flex items-center gap-4">
          {/* Filter Button - Style to match gray button from detail page */}
          <button
            onClick={() => setShowOnlyStarred(!showOnlyStarred)}
            className={`px-4 py-2 rounded border border-gray-300 text-sm font-medium transition-colors disabled:opacity-50 ${
              showOnlyStarred
                ? 'bg-yellow-400 border-yellow-500 text-yellow-900 hover:bg-yellow-300' // Keep starred style distinct
                : 'bg-gray-100 border-gray-300 text-gray-700 hover:bg-gray-200' // Default gray button
            }`}
          >
            {showOnlyStarred ? '★ Show All' : '☆ Show Starred'}
          </button>
          {/* New Post Button - Style to match blue button from detail page */}
          <Link href="/posts/new" legacyBehavior>
            <a className="inline-flex items-center px-4 py-2 rounded border border-blue-600 bg-blue-500 text-white hover:bg-blue-600 text-sm font-medium transition-colors shadow-sm focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500">
              + New Post
            </a>
          </Link>
          {/* Logout Button - Style to match red button from detail page */}
          <button
            onClick={handleLogout}
            className="inline-flex items-center px-4 py-2 rounded border border-red-600 bg-red-500 text-white hover:bg-red-600 text-sm font-medium transition-colors shadow-sm focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-red-500"
          >
            Logout {session?.user?.email ? `(${session.user.email.split('@')[0]})` : ''}
          </button>
        </div>
      </div>

      {/* Search Bar Section */}
      <div className="mb-6">
        <input
          type="search"
          placeholder="Search posts by content or tags..."
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          // Removed dark mode classes from search input
          className="block w-full px-4 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm text-gray-900 placeholder-gray-500"
        />
      </div>

      {/* Render the posts list or relevant messages */}
      {renderPostsList()}

    </main>
  );
}
