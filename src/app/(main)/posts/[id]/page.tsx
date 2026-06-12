import PostDetailClient from "./PostDetailClient";
import { supabase } from "@/lib/supabaseClient";

const STARRED_SHORTCUT_POST_ID = "5a57a71a-5508-4dcd-bc8e-c8227dffe5b1";

export const revalidate = 60;

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

type PageProps = {
  params: Promise<{ id: string }>;
};

export async function generateStaticParams() {
  return [{ id: STARRED_SHORTCUT_POST_ID }];
}

async function getInitialPost(id: string): Promise<{ post: Post | null; mediaFiles: MediaFile[] }> {
  try {
    const { data: post, error: postError } = await supabase
      .from("posts")
      .select("*")
      .eq("id", id)
      .single();

    if (postError || !post) {
      return { post: null, mediaFiles: [] };
    }

    const { data: mediaFiles, error: mediaError } = await supabase
      .from("media_files")
      .select("*")
      .eq("post_id", id)
      .order("uploaded_at", { ascending: true });

    return {
      post: post as Post,
      mediaFiles: mediaError ? [] : (mediaFiles || []) as MediaFile[],
    };
  } catch {
    return { post: null, mediaFiles: [] };
  }
}

export default async function PostPage({ params }: PageProps) {
  const { id } = await params;
  const { post, mediaFiles } = await getInitialPost(id);

  return <PostDetailClient initialPost={post} initialMediaFiles={mediaFiles} />;
}
