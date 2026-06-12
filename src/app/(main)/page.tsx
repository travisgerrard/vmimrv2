import PostsClient from '../PostsClient';
import type { Post } from '../PostsClient';
import { supabase } from '../../lib/supabaseClient';

const PAGE_SIZE = 20;
const LIST_CONTENT_MAX_LENGTH = 800;

export const revalidate = 60;

function toListContent(content: string) {
  return content.length > LIST_CONTENT_MAX_LENGTH
    ? content.slice(0, LIST_CONTENT_MAX_LENGTH)
    : content;
}

async function attachMediaInfo(posts: Post[]): Promise<Post[]> {
  if (posts.length === 0) return posts;

  const postIds = posts.map((p) => p.id);
  const { data: mediaFiles, error: mediaError } = await supabase
    .from('media_files')
    .select('post_id, file_path, file_type')
    .in('post_id', postIds);

  if (mediaError || !mediaFiles) {
    return posts.map((post) => ({
      ...post,
      imagePaths: [],
      hasPdf: false,
    }));
  }

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

  return posts.map((post) => ({
    ...post,
    imagePaths: postMediaInfo[post.id]?.imagePaths || [],
    hasPdf: postMediaInfo[post.id]?.hasPdf || false,
  }));
}

async function getInitialPosts() {
  try {
    const { data: postsData, error: postsError } = await supabase
      .from('posts')
      .select('id, created_at, content, tags, is_starred, user_id')
      .order('created_at', { ascending: false })
      .range(0, PAGE_SIZE - 1);

    if (postsError) throw postsError;

    const posts: Post[] = (postsData || []).map((post) => ({
      ...post,
      content: toListContent(post.content || ''),
      user_id: (post as { user_id?: string }).user_id || '',
    }));

    return attachMediaInfo(posts);
  } catch {
    return [];
  }
}

export default async function Home() {
  const initialPosts = await getInitialPosts();

  return (
    <PostsClient
      initialPosts={initialPosts}
      initialPostsReady
    />
  );
}
