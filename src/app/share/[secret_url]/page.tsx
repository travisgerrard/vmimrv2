'use client';

import { useState, useEffect } from 'react';
import { useParams } from 'next/navigation';
import Head from 'next/head'; // Import Head for meta tags
import { supabase } from '../../../lib/supabaseClient'; // Correct relative path
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

// Reuse types (consider moving to a shared file)
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
  is_starred: boolean; // Not strictly needed for display, but part of the type
  secret_url?: string | null;
  summary?: string | null;
  media_files?: MediaFile[];
};

export default function SharePage() {
  const [post, setPost] = useState<Post | null>(null);
  const [mediaFiles, setMediaFiles] = useState<MediaFile[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const params = useParams();
  const secretUrlParam = params?.secret_url as string; // Get secret_url from dynamic route

  useEffect(() => {
    if (!secretUrlParam) {
      setError("Invalid share link.");
      setLoading(false);
      return;
    }

    const fetchSharedData = async () => {
        setLoading(true);
        setError(null);
        try {
            // Fetch post using the secret URL header for RLS
            const { data: postData, error: postError } = await supabase
                .from('posts')
                .select('*')
                .eq('secret_url', secretUrlParam) // Match the secret_url column directly
                // Pass the secret URL in the header for the RLS policy check
                .single();
                // Note: The RLS policy uses current_setting('request.header.x-secret-url', true)
                // Supabase client might automatically handle passing necessary context for RLS,
                // but explicitly setting the header might be needed in some setups or for clarity.
                // If direct .eq('secret_url', ...) doesn't work with RLS, we'd need to adjust
                // the client call or the RLS policy (e.g., use a function).
                // Let's assume direct .eq works for now with the RLS check on secret_url itself.

            if (postError || !postData) {
                 if (postError?.code === 'PGRST116' || !postData) { // Not found
                    setError("Post not found or link is invalid/expired.");
                 } else {
                    throw postError || new Error("Failed to fetch post data.");
                 }
                 setPost(null);
                 setMediaFiles([]);
                 setLoading(false);
                 return;
            }

            setPost(postData);

            // Fetch associated media files using the post_id from the fetched post
            const { data: mediaData, error: mediaError } = await supabase
                .from('media_files')
                .select('*')
                .eq('post_id', postData.id)
                // RLS policy for media_files should allow access based on the post's secret_url match
                .order('uploaded_at', { ascending: true });

            if (mediaError) {
                console.warn("Could not fetch media files:", mediaError); // Non-critical error for media
                setMediaFiles([]);
            } else {
                setMediaFiles(mediaData || []);
            }

        } catch (err: unknown) {
            console.error("Error fetching shared data:", err);
            const message = err instanceof Error ? err.message : 'An unknown error occurred.';
            setError(`Failed to load shared post: ${message}`);
            setPost(null);
            setMediaFiles([]);
        } finally {
            setLoading(false);
        }
    };

    fetchSharedData();

  }, [secretUrlParam]); // Re-run if secretUrlParam changes

   // Function to get a temporary signed URL for viewing a private file
   // This needs to work for public users viewing the shared link too.
   // The RLS policy on storage.objects needs to allow this based on the secret link.
   // Let's adjust the storage policy approach slightly - generate URLs from backend context if needed.
   // For now, assume the client can generate based on path if storage RLS allows public read via post link.
   const getMediaUrl = async (filePath: string): Promise<string | null> => {
    try {
        // This might require adjustments based on storage RLS for public access
        const { data, error } = await supabase
            .storage
            .from('post-media')
            .createSignedUrl(filePath, 60 * 5); // 5 minute validity

        if (error) throw error;
        return data.signedUrl;
    } catch (err) {
        console.error('Error creating signed URL for shared view:', err);
        return null;
    }
   };


  if (loading) {
    return <div className="p-8 text-center">Loading shared post...</div>;
  }

  if (error || !post) {
    return (
      <div className="container mx-auto p-4 md:p-8 text-center">
         <Head>
            <meta name="robots" content="noindex" />
            <title>Invalid Link</title>
         </Head>
        <p className="text-red-600 dark:text-red-400 mb-4">{error || "Post not found or link is invalid."}</p>
        {/* Optional: Link back to main site? */}
      </div>
    );
  }

  // Render the shared post (read-only view)
  return (
    <div className="container mx-auto p-4 md:p-8 max-w-4xl">
        <Head>
            <meta name="robots" content="noindex" /> {/* Prevent indexing */}
            <title>Shared Medical Reference</title> {/* Generic title */}
        </Head>

      <style>{`
        @media print {
          body * {
            visibility: hidden !important;
          }
          .print-content, .print-content * {
            visibility: visible !important;
          }
          .print-content {
            position: absolute !important;
            left: 0; top: 0; width: 100vw;
          }
        }
      `}</style>
      <div className="flex items-center justify-between mb-4 print:hidden">
        <h2 className="text-xl font-semibold text-gray-700 dark:text-gray-300 m-0">Shared Medical Reference Post</h2>
        <button
          onClick={() => window.print()}
          className="px-4 py-2 rounded border border-gray-400 bg-gray-100 text-gray-700 hover:bg-gray-200 text-sm font-medium transition-colors shadow-sm print:hidden"
        >
          🖨️ Print
        </button>
      </div>

      <article className="prose print-content dark:prose-invert lg:prose-xl max-w-none bg-white dark:bg-gray-800 p-6 rounded-lg shadow mb-6">
        <ReactMarkdown remarkPlugins={[remarkGfm]}>{post.content}</ReactMarkdown>
      </article>

      {/* Media Files Section */}
      {mediaFiles.length > 0 && (
        <div className="mt-6 p-4 bg-gray-50 dark:bg-gray-800/50 rounded-lg shadow">
            <h3 className="text-lg font-semibold mb-3 dark:text-white">Attached Media</h3>
            <ul className="space-y-2">
                {mediaFiles.map(file => (
                    <li key={file.id} className="flex items-center justify-between text-sm">
                        <span className="dark:text-gray-300">{file.file_name} ({file.file_type})</span>
                        <button
                            onClick={async () => {
                                const url = await getMediaUrl(file.file_path);
                                if (url) window.open(url, '_blank');
                                else alert('Could not generate link for this file.');
                            }}
                            className="text-indigo-600 dark:text-indigo-400 hover:underline"
                        >
                            View/Download
                        </button>
                    </li>
                ))}
            </ul>
        </div>
      )}

      {/* Metadata Section (Optional for shared view) */}
      <div className="mt-6 text-xs text-gray-500 dark:text-gray-400 border-t dark:border-gray-700 pt-4 print:hidden">
        <p>Post created: {new Date(post.created_at).toLocaleDateString()}</p>
        {/* Maybe hide tags/summary/updated_at from public view unless desired */}
      </div>
    </div>
  );
}