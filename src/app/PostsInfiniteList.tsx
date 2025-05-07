"use client";

import useSWRInfinite from "swr/infinite";
import { useEffect, useRef } from "react";
import { supabase } from "../lib/supabaseClient";

const PAGE_SIZE = 10;

type Post = {
  id: string;
  created_at: string;
  content: string;
  tags: string[] | null;
  is_starred: boolean;
  user_id: string;
  summary?: string;
  secret_url?: string;
};

// Fetch a page of posts, optionally filtered by user
const fetchPostsPage = async (
  pageIndex: number,
  userId?: string,
  searchTerm?: string
): Promise<Post[]> => {
  let query = supabase
    .from("posts")
    .select("id, created_at, content, tags, is_starred, user_id, summary, secret_url")
    .order("created_at", { ascending: false })
    .range(pageIndex * PAGE_SIZE, (pageIndex + 1) * PAGE_SIZE - 1);
  if (userId) query = query.eq("user_id", userId);
  if (searchTerm) query = query.textSearch('fts', searchTerm, { type: 'websearch' });
  const { data, error } = await query;
  if (error) throw error;
  return data as Post[];
};

interface PostsInfiniteListProps {
  userId?: string;
  searchTerm?: string;
}

export default function PostsInfiniteList({ userId, searchTerm }: PostsInfiniteListProps) {
  const {
    data,
    error,
    setSize,
    isValidating,
  } = useSWRInfinite<Post[], Error>(
    (index: number) => ["posts", index, userId, searchTerm],
    (key: [string, number, string | undefined, string | undefined]) => fetchPostsPage(key[1], key[2], key[3])
  );

  const posts = data ? ([] as Post[]).concat(...data) : [];

  // Infinite scroll: use Intersection Observer or a Load More button
  const loadMoreRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!loadMoreRef.current) return;
    const observer = new window.IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && !isValidating) {
          setSize((s: number) => s + 1);
        }
      },
      { threshold: 1 }
    );
    observer.observe(loadMoreRef.current);
    return () => observer.disconnect();
  }, [isValidating, setSize]);

  // If you see a type error for swr/infinite, ensure @types/swr or swr is installed in node_modules

  return (
    <div>
      {posts.map((post) => (
        <div key={post.id} style={{ borderBottom: "1px solid #eee", marginBottom: 16, paddingBottom: 16 }}>
          <h3>{post.summary || post.content.slice(0, 50)}</h3>
          <p>{post.created_at}</p>
          {post.secret_url && (
            <img src={post.secret_url} alt="media" style={{ maxWidth: 200, maxHeight: 200 }} />
          )}
        </div>
      ))}
      <div ref={loadMoreRef} style={{ height: 40, textAlign: "center", color: "#888" }}>
        {isValidating ? "Loading more..." : "Scroll down to load more"}
      </div>
      {error && <div style={{ color: "red" }}>Error loading posts: {error.message}</div>}
    </div>
  );
} 