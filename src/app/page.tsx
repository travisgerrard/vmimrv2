// Remove 'use client' from this file and convert to a server component
import PostsClient from './PostsClient';
import { supabase } from '../lib/supabaseClient';

// Define Post type (reuse from client component)
type Post = {
  id: string;
  created_at: string;
  content: string;
  tags: string[] | null;
  is_starred: boolean;
  imagePaths?: string[];
  hasPdf?: boolean;
};

export default async function Home() {
  // Fetch posts and their media info on the server
  // (No session filtering here; client will filter by user session)
  let posts: Post[] = [];
  try {
    // Fetch all posts (optionally limit for demo)
    const { data: postsData, error: postsError } = await supabase
      .from('posts')
      .select('id, created_at, content, tags, is_starred');
    if (postsError) throw postsError;
    posts = postsData || [];

    // Fetch media info for all posts
    if (posts.length > 0) {
      const postIds = posts.map((p) => p.id);
      const { data: mediaFiles, error: mediaError } = await supabase
        .from('media_files')
        .select('post_id, file_path, file_type')
        .in('post_id', postIds);
      if (!mediaError && mediaFiles) {
        const postMediaInfo: Record<string, { imagePaths: string[]; hasPdf: boolean }> = {};
        mediaFiles.forEach((file) => {
          if (!file.post_id || !file.file_path) return;
          if (!postMediaInfo[file.post_id]) {
            postMediaInfo[file.post_id] = { imagePaths: [], hasPdf: false };
          }
          if (file.file_type?.includes('pdf')) {
            postMediaInfo[file.post_id].hasPdf = true;
          }
          if (file.file_type?.startsWith('image/')) {
            if (!postMediaInfo[file.post_id].imagePaths.includes(file.file_path)) {
              postMediaInfo[file.post_id].imagePaths.push(file.file_path);
            }
          }
        });
        posts = posts.map((post) => ({
          ...post,
          imagePaths: postMediaInfo[post.id]?.imagePaths || [],
          hasPdf: postMediaInfo[post.id]?.hasPdf || false,
        }));
      }
    }
  } catch {
    // Optionally log error
  }

  // Pass posts to the client component
  return <PostsClient initialPosts={posts} />;
}
