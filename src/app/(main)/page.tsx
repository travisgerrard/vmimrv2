import PostsClient from '../PostsClient';
import { supabase } from '../../lib/supabaseClient';

type Post = {
  id: string;
  created_at: string;
  content: string;
  tags: string[] | null;
  is_starred: boolean;
  imagePaths?: string[];
  hasPdf?: boolean;
  user_id: string;
};

export default async function Home() {
  let posts: Post[] = [];
  try {
    const { data: postsData, error: postsError } = await supabase
      .from('posts')
      .select('id, created_at, content, tags, is_starred, user_id');
    if (postsError) throw postsError;
    posts = postsData || [];

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
    // ignore
  }

  return <PostsClient initialPosts={posts.map(post => ({ ...post, user_id: post.user_id || '' }))} />;
}
