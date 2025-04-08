'use client';

import { useState, useEffect, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { supabase } from '../../../lib/supabaseClient'; // Correct relative path
import ReactMarkdown from 'react-markdown';
import { v4 as uuidv4 } from 'uuid'; // Import UUID generator
import type { Session } from '@supabase/supabase-js'; // Import Session type

// Define MediaFile type
type MediaFile = {
    id: string;
    file_name: string;
    file_path: string;
    file_type: string;
    uploaded_at: string;
};

// Update Post type
type Post = {
  id: string;
  created_at: string;
  updated_at: string;
  content: string;
  tags: string[] | null;
  is_starred: boolean;
  secret_url?: string | null; // Add secret_url
  summary?: string | null;
  media_files?: MediaFile[];
};

export default function PostDetailPage() {
  const [post, setPost] = useState<Post | null>(null);
  const [session, setSession] = useState<Session | null>(null); // Add session state
  const [mediaFiles, setMediaFiles] = useState<MediaFile[]>([]);
  const [isStarred, setIsStarred] = useState(false);
  const [secretUrl, setSecretUrl] = useState<string | null>(null); // State for share URL
  const [loading, setLoading] = useState(true);
  const [togglingStar, setTogglingStar] = useState(false);
  const [generatingLink, setGeneratingLink] = useState(false); // Loading state for link generation
  const [deleting, setDeleting] = useState(false); // Loading state for deletion
  const [error, setError] = useState<string | null>(null);
  const [signedImageUrls, setSignedImageUrls] = useState<Record<string, string | null>>({}); // State for signed URLs
  const [revokingLink, setRevokingLink] = useState(false); // State for revoke loading
  const params = useParams();
  const router = useRouter();
  const postId = params?.id as string;

  useEffect(() => {
    const checkSessionAndFetch = async () => {
        setLoading(true);
        setError(null);
        try {
            const { data: { session: currentSession }, error: sessionError } = await supabase.auth.getSession();
            if (sessionError) throw sessionError;

            if (!currentSession) {
                router.push('/auth');
                return;
            }
            // Set session state if found
            setSession(currentSession);

            if (!postId) {
                setError("Post ID is missing.");
                setLoading(false);
                return;
            }

            await Promise.all([
                fetchPost(postId),
                fetchMediaFiles(postId)
            ]);

        } catch (err: unknown) {
            console.error("Error during initial load:", err);
            const message = err instanceof Error ? err.message : 'An unknown error occurred during setup.';
            setError(`Failed to load page: ${message}`);
        } finally {
            setLoading(false);
        }
    };

    checkSessionAndFetch();

     const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
        if (!session) {
          router.push('/auth');
        }
        // Update session state on auth change
        setSession(session);
      });

      return () => subscription?.unsubscribe();

  }, [postId, router]); // Dependencies remain the same

  const fetchPost = async (id: string) => {
    try {
      const { data, error: fetchError } = await supabase
        .from('posts')
        .select('*')
        .eq('id', id)
        .single();

      if (fetchError) {
        if (fetchError.code === 'PGRST116') {
             setError(prev => prev || "Post not found or permission denied.");
        } else {
            throw fetchError;
        }
        setPost(null);
        setIsStarred(false);
        setSecretUrl(null);
      } else {
         setPost(data);
         setIsStarred(data.is_starred);
         setSecretUrl(data.secret_url || null);
      }
    } catch (err) {
      console.error('Error fetching post:', err);
      const message = err instanceof Error ? err.message : 'An unknown error occurred fetching post';
      setError(prev => prev || `Failed to load post details: ${message}`);
      setPost(null);
      setIsStarred(false);
      setSecretUrl(null);
    }
  };

  const fetchMediaFiles = async (id: string) => {
     try {
        const { data, error: fetchError } = await supabase
            .from('media_files')
            .select('*')
            .eq('post_id', id)
            .order('uploaded_at', { ascending: true });

        if (fetchError) {
             console.error('Error fetching media files from Supabase:', fetchError);
             throw fetchError;
        }
        setMediaFiles(data || []);
     } catch (err) {
        console.error('Error fetching media files:', err);
        const message = err instanceof Error ? err.message : 'An unknown error occurred fetching media';
        setError(prev => prev || `Failed to load media files: ${message}`);
        setMediaFiles([]);
     }
  };

   const getMediaUrl = useCallback(async (filePath: string): Promise<string | null> => {
       try {
           const { data, error } = await supabase
               .storage
               .from('post-media')
               .createSignedUrl(filePath, 60 * 5);

           if (error) throw error;
           return data.signedUrl;
       } catch (err) {
           console.error(`Error creating signed URL for ${filePath}:`, err);
           return null;
       }
   }, []);

   const toggleStar = async () => {
        if (!post || togglingStar) return;
        setTogglingStar(true);
        const currentStarredStatus = isStarred;
        const newStarredStatus = !currentStarredStatus;
        try {
            setIsStarred(newStarredStatus);
            const { error: updateError } = await supabase
                .from('posts')
                .update({ is_starred: newStarredStatus })
                .eq('id', post.id);
            if (updateError) {
                setIsStarred(currentStarredStatus);
                throw updateError;
            }
            setPost(prevPost => prevPost ? { ...prevPost, is_starred: newStarredStatus } : null);
        } catch (err) {
            console.error('Error toggling star status:', err);
            alert(`Error: Could not update star status`);
        } finally {
            setTogglingStar(false);
        }
   };

   const generateShareLink = async () => {
        if (!post || generatingLink) return;
        setGeneratingLink(true);
        setError(null);

        try {
            let linkToShare = secretUrl;
            if (!linkToShare) {
                const newSecret = uuidv4();
                const { data: updatedPost, error: updateError } = await supabase
                    .from('posts')
                    .update({ secret_url: newSecret })
                    .eq('id', post.id)
                    .select('secret_url')
                    .single();

                if (updateError) throw updateError;
                if (!updatedPost?.secret_url) throw new Error("Failed to retrieve updated secret URL.");

                linkToShare = updatedPost.secret_url;
                setSecretUrl(linkToShare);
                setPost(prevPost => prevPost ? { ...prevPost, secret_url: linkToShare } : null);
            }
        } catch (err) {
            console.error('Error generating share link:', err);
            const message = err instanceof Error ? err.message : 'Could not generate share link';
            setError(`Error: ${message}`);
            setSecretUrl(null);
        } finally {
            setGeneratingLink(false);
        }
   };

   const copyToClipboard = (text: string) => {
        navigator.clipboard.writeText(text).then(() => {
            alert('Share link copied to clipboard!');
        }, (err) => {
            console.error('Failed to copy text: ', err);
            alert('Failed to copy link. Please copy it manually.');
        });
    };

    // --- Revoke Share Link Handler ---
    const revokeShareLink = async () => {
        // Ensure session exists before proceeding
        if (!session?.user || !post || !secretUrl || revokingLink) return;

        setRevokingLink(true);
        setError(null);

        try {
            const { error: updateError } = await supabase
                .from('posts')
                .update({ secret_url: null }) // Set secret_url to null
                .eq('id', post.id)
                .eq('user_id', session.user.id); // Ensure ownership using session state

            if (updateError) throw updateError;

            setSecretUrl(null);
            setPost(prevPost => prevPost ? { ...prevPost, secret_url: null } : null);
            alert('Share link revoked successfully.');

        } catch (err) {
            console.error('Error revoking share link:', err);
            const message = err instanceof Error ? err.message : 'Could not revoke share link';
            setError(`Error: ${message}`);
        } finally {
            setRevokingLink(false);
        }
    };

    const handleDelete = async () => {
        if (!post || deleting) return;
        if (!window.confirm("Are you sure you want to delete this post and all its associated media? This action cannot be undone.")) return;

        setDeleting(true);
        setError(null);
        try {
            const filePathsToDelete = mediaFiles.map(file => file.file_path);
            if (filePathsToDelete.length > 0) {
                const { error: storageError } = await supabase.storage.from('post-media').remove(filePathsToDelete);
                if (storageError) console.error("Error deleting files from storage:", storageError);
            }
            const { error: mediaDbError } = await supabase.from('media_files').delete().eq('post_id', post.id);
            if (mediaDbError) throw new Error(`Failed to delete associated media records: ${mediaDbError.message}`);
            const { error: postDbError } = await supabase.from('posts').delete().eq('id', post.id);
            if (postDbError) throw new Error(`Failed to delete post: ${postDbError.message}`);
            alert("Post deleted successfully.");
            router.push('/');
        } catch (err) {
            console.error('Error during deletion process:', err);
            const message = err instanceof Error ? err.message : 'An unknown error occurred during deletion.';
            setError(`Deletion failed: ${message}`);
            setDeleting(false);
        }
    };

   useEffect(() => {
     const fetchSignedUrls = async () => {
       if (mediaFiles.length > 0) {
         const urls: Record<string, string | null> = {};
         await Promise.all(mediaFiles.map(async (file) => {
           if (file.file_type?.startsWith('image/') && file.file_path) {
             const url = await getMediaUrl(file.file_path);
             urls[file.id] = url;
           }
         }));
         setSignedImageUrls(urls);
       } else {
         setSignedImageUrls({});
       }
     };
     fetchSignedUrls();
   }, [mediaFiles, getMediaUrl]);

   if (loading) {
     return <div className="p-8 text-center">Loading post details...</div>;
   }

   if (error && !post) {
       return (
         <div className="container mx-auto p-4 md:p-8 text-center">
           <p className="text-red-600 mb-4">{error}</p>
           <Link href="/" legacyBehavior><a className="text-blue-600 hover:underline">Go back home</a></Link>
         </div>
       );
   }

   if (!post) {
        return (
            <div className="container mx-auto p-4 md:p-8 text-center">
                <p className="text-gray-600 mb-4">Post data could not be loaded.</p>
                 <Link href="/" legacyBehavior><a className="text-blue-600 hover:underline">Go back home</a></Link>
            </div>
        );
   }

   const imageFiles = mediaFiles.filter(file => file.file_type?.startsWith('image/'));
   const otherFiles = mediaFiles.filter(file => !file.file_type?.startsWith('image/'));

  return (
    <div className="container mx-auto p-6 md:p-10 max-w-4xl font-sans">
       <div className="mb-6 flex flex-wrap justify-between items-center gap-4">
            <Link href="/" legacyBehavior><a className="text-blue-600 hover:underline">&larr; Back to Posts</a></Link>
            <div className="flex items-center flex-wrap gap-2"> {/* Added flex-wrap */}
                <button
                    onClick={toggleStar}
                    disabled={togglingStar}
                    className={`px-4 py-2 rounded border border-gray-300 text-sm font-medium transition-colors disabled:opacity-50 ${isStarred ? 'bg-yellow-400 border-yellow-500 text-yellow-900 hover:bg-yellow-300' : 'bg-gray-100 border-gray-300 text-gray-700 hover:bg-gray-200'}`}
                >
                    {togglingStar ? '...' : (isStarred ? '★ Unstar' : '☆ Star')}
                </button>
                 <button
                    onClick={generateShareLink}
                    disabled={generatingLink || !!secretUrl}
                    className="px-4 py-2 rounded border border-blue-600 bg-blue-500 text-white hover:bg-blue-600 text-sm font-medium transition-colors disabled:opacity-50 disabled:bg-blue-300 disabled:border-blue-400"
                >
                    {generatingLink ? 'Generating...' : (secretUrl ? 'Link Generated' : 'Generate Share Link')}
                </button>
                 <button
                    onClick={handleDelete}
                    disabled={deleting}
                    className="px-4 py-2 rounded border border-red-600 bg-red-500 text-white hover:bg-red-600 text-sm font-medium transition-colors disabled:opacity-50 disabled:bg-red-300 disabled:border-red-400"
                 >
                    {deleting ? 'Deleting...' : 'Delete Post'}
                 </button>
                 <Link href={`/posts/${post.id}/edit`} legacyBehavior>
                    <a className="px-4 py-2 rounded border border-gray-300 bg-gray-100 text-gray-700 hover:bg-gray-200 text-sm font-medium transition-colors">Edit</a>
                 </Link>
            </div>
       </div>

        {secretUrl && (
            <div className="mb-6 p-3 bg-gray-50 rounded border border-gray-200 flex items-center justify-between gap-4">
                <span className="text-sm font-mono break-all text-gray-600">
                    {`${window.location.origin}/share/${secretUrl}`}
                </span>
                <div className="flex items-center gap-2"> {/* Group copy and revoke */}
                    <button
                        onClick={() => copyToClipboard(`${window.location.origin}/share/${secretUrl}`)}
                        className="px-2 py-1 rounded border border-gray-300 bg-gray-100 hover:bg-gray-200 text-gray-600 text-xs font-medium"
                    >
                        Copy
                    </button>
                    <button
                        onClick={revokeShareLink}
                        disabled={revokingLink}
                        className="px-2 py-1 rounded border border-red-300 bg-red-100 hover:bg-red-200 text-red-700 text-xs font-medium disabled:opacity-50"
                        title="Revoke this share link"
                    >
                        {revokingLink ? 'Revoking...' : 'Revoke'}
                    </button>
                </div>
            </div>
        )}

       {error && <p className="text-red-600 text-sm mb-4">Note: {error}</p>}

      <article className="prose lg:prose-xl max-w-none bg-white p-6 rounded-lg shadow mb-6">
        <ReactMarkdown>{post.content}</ReactMarkdown>
      </article>

      {imageFiles.length > 0 && (
        <div className="mb-6 space-y-4">
          {imageFiles.map(file => {
            const imageUrl = signedImageUrls[file.id];
            return (
              <div key={file.id}>
                {imageUrl === undefined ? (
                  <div className="w-full h-64 bg-gray-100 rounded-lg flex items-center justify-center text-gray-400 animate-pulse">Loading Image...</div>
                ) : imageUrl ? (
                  <img src={imageUrl} alt={file.file_name} className="w-full max-w-full h-auto rounded-lg shadow" loading="lazy"/>
                ) : (
                  <div className="w-full h-32 bg-gray-100 rounded-lg flex items-center justify-center text-gray-400">Image Preview Unavailable</div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {otherFiles.length > 0 && (
        <div className="mt-6 p-6 bg-white rounded-lg shadow">
            <h3 className="text-lg font-semibold mb-4 text-gray-800">Attached Files</h3>
            <ul className="space-y-3">
                {otherFiles.map(file => (
                    <li key={file.id} className="border border-gray-200 rounded-lg p-3 text-sm flex justify-between items-center">
                        <div>
                            <p className="text-gray-800 font-medium mb-1 truncate" title={file.file_name}>{file.file_name}</p>
                            <p className="text-xs text-gray-500">{file.file_type}</p>
                        </div>
                        <button
                            onClick={async () => {
                                const url = await getMediaUrl(file.file_path);
                                if (url) window.open(url, '_blank');
                                else alert('Could not generate download link for this file.');
                            }}
                            className="text-blue-600 hover:underline text-xs ml-4 whitespace-nowrap"
                        >
                            View/Download
                        </button>
                    </li>
                ))}
            </ul>
        </div>
      )}

      <div className="mt-8 text-sm text-gray-500 border-t border-gray-200 pt-4">
        <p>Created: {new Date(post.created_at).toLocaleString()}</p>
        <p>Last Updated: {new Date(post.updated_at).toLocaleString()}</p>
        {post.tags && post.tags.length > 0 && (
            <div className="mt-2">
                Tags: {post.tags.map(tag => (
                    <span key={tag} className="ml-1 inline-block bg-gray-100 rounded-full px-2 py-0.5 text-xs font-semibold text-gray-600">@{tag}</span>
                ))}
            </div>
        )}
         {post.summary && (
            <div className="mt-4 p-4 border-l-4 border-blue-300 bg-blue-50 rounded">
                <h3 className="font-semibold text-blue-700">Summary:</h3>
                <p className="mt-1 text-sm text-gray-700">{post.summary}</p>
            </div>
         )}
      </div>
    </div>
  );
}
