'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { useRouter, useParams } from 'next/navigation'; // Import useParams
import { supabase } from '../../../../lib/supabaseClient'; // Adjusted relative path
import type { Session } from '@supabase/supabase-js';
import ReactMarkdown from 'react-markdown';
import { v4 as uuidv4 } from 'uuid';

// Define Post type (can be shared if moved to a types file)
type Post = {
  id: string;
  created_at: string;
  updated_at: string;
  content: string;
  tags: string[] | null;
  is_starred: boolean;
  secret_url?: string | null;
  summary?: string | null;
};


export default function EditPostPage() { // Renamed component
  const [session, setSession] = useState<Session | null>(null);
  const [originalPost, setOriginalPost] = useState<Post | null>(null); // Store original post
  const [content, setContent] = useState('');
  // TODO: Add state for existing media files and new files to upload/delete
  const [files, setFiles] = useState<File[]>([]);
  const [loading, setLoading] = useState(true); // Used for loading existing post
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [uploadProgress, setUploadProgress] = useState<string | null>(null);
  const router = useRouter();
  const params = useParams(); // Get route parameters
  const postId = params?.id as string; // Extract post ID
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isDraggingOver, setIsDraggingOver] = useState(false);
  const [isFetchingUrl, setIsFetchingUrl] = useState(false);

  // Effect to check session and fetch existing post data
  useEffect(() => {
    setLoading(true);
    let isActive = true; // Flag to prevent state updates on unmounted component

    const checkSessionAndFetchPost = async () => {
      try {
        const { data: { session: currentSession }, error: sessionError } = await supabase.auth.getSession();
        if (sessionError) throw sessionError;

        if (!currentSession) {
          if (isActive) router.push('/auth');
          return;
        }
        if (isActive) setSession(currentSession);

        if (!postId) {
          throw new Error("Post ID is missing.");
        }

        // Fetch the specific post to edit
        const { data: postData, error: fetchError } = await supabase
          .from('posts')
          .select('*')
          .eq('id', postId)
          .eq('user_id', currentSession.user.id) // Ensure user owns the post
          .single();

        if (fetchError) {
          if (fetchError.code === 'PGRST116') throw new Error("Post not found or permission denied.");
          else throw fetchError;
        }

        if (isActive) {
          setOriginalPost(postData);
          setContent(postData.content || ''); // Pre-populate content
          // TODO: Fetch and set existing media files state here
          setLoading(false);
        }

      } catch (err: unknown) {
        console.error("Error fetching session or post:", err);
        if (isActive) {
          const message = err instanceof Error ? err.message : 'An unknown error occurred';
          setError(`Failed to load post for editing: ${message}`);
          setLoading(false);
        }
      }
    };

    checkSessionAndFetchPost();

    // Listen for auth changes (optional, but good practice)
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!session && isActive) {
        router.push('/auth');
      }
      if (isActive) setSession(session);
    });

    return () => {
      isActive = false; // Cleanup flag
      subscription?.unsubscribe();
    };
  }, [postId, router]); // Depend on postId and router

  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    setFiles(event.target.files ? Array.from(event.target.files) : []);
  };

  // --- Drag and Drop Handlers (Keep as is for now) ---
  const handleDragOver = useCallback((event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    setIsDraggingOver(true);
  }, []);

  const handleDragLeave = useCallback((event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    setIsDraggingOver(false);
  }, []);

  const handleDrop = useCallback((event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    setIsDraggingOver(false);
    const droppedFiles = event.dataTransfer.files;
    if (droppedFiles && droppedFiles.length > 0) {
      const newFiles = Array.from(droppedFiles);
      setFiles(prevFiles => [...prevFiles, ...newFiles]);
    } else if (event.dataTransfer.types.includes('text/uri-list')) {
        const uri = event.dataTransfer.getData('text/uri-list');
        fetchImageFromUrl(uri).then(fetchedFile => {
            if (fetchedFile) setFiles(prevFiles => [...prevFiles, fetchedFile]);
        });
    } else {
        setError('Could not process the dropped item.');
    }
  }, []);

  // Helper to fetch image from URL (Keep as is)
  const fetchImageFromUrl = async (url: string): Promise<File | null> => {
    setIsFetchingUrl(true);
    setError(null);
    try {
      const response = await fetch(url);
      if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
      const contentType = response.headers.get('content-type');
      if (!contentType || !contentType.startsWith('image/')) throw new Error('URL did not point to a valid image type.');
      const blob = await response.blob();
      let extension = contentType.split('/')[1] || 'png';
      extension = extension.replace(/[^a-z0-9]/gi, '').toLowerCase();
      if (!['png', 'jpg', 'jpeg', 'gif', 'webp', 'avif'].includes(extension)) extension = 'png';
      const filename = `downloaded-${uuidv4()}.${extension}`;
      const file = new File([blob], filename, { type: contentType });
      return file;
    } catch (err) {
      console.error('[fetchImageFromUrl] Error:', err);
      const message = err instanceof Error ? err.message : 'Unknown error';
      setError(`Failed to process image from URL: ${message}`);
      return null;
    } finally {
      setIsFetchingUrl(false);
    }
  };

  // Renamed function to handleUpdate
  const handleUpdate = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!session?.user || !postId) {
      setError('User session or Post ID is missing.');
      return;
    }
    if (!content.trim()) {
        setError('Post content cannot be empty.');
        return;
    }

    setSaving(true);
    setError(null);
    setUploadProgress(null); // Reset progress

    try {
      // Use supabase.update
      const extractedTags = content.match(/@\w+/g)?.map(tag => tag.substring(1)) || [];
      const { error: updateError } = await supabase
        .from('posts')
        .update({
          content: content,
          tags: extractedTags,
          updated_at: new Date().toISOString(), // Explicitly set updated_at
        })
        .eq('id', postId) // Match the post ID
        .eq('user_id', session.user.id); // Ensure user owns the post

      if (updateError) throw updateError;

      // TODO: Handle file uploads/deletions during edit
      // This part needs significant logic:
      // 1. Identify files to be deleted (compare existing vs. current state).
      // 2. Delete files from storage and media_files table.
      // 3. Upload NEW files added during edit.
      // 4. Insert records for new files into media_files table.
      // For now, we skip media file changes during edit.

      setUploadProgress("Update successful!"); // Update message
      // Short delay before redirecting to allow user to see message
      setTimeout(() => {
          router.push(`/posts/${postId}`); // Redirect back to the post detail page
      }, 1000);


    } catch (err) {
      console.error('Error updating post:', err);
      const message = err instanceof Error ? err.message : 'An unknown error occurred';
      setError(`Failed to update: ${message}`);
      setSaving(false); // Re-enable form on error
      setUploadProgress(null);
    }
    // Don't setSaving(false) here if redirecting on success
  };

  if (loading) {
    return <div className="p-8 text-center text-gray-500">Loading post...</div>;
  }

  if (error && !originalPost) { // Show error if post couldn't be loaded
      return (
          <div className="container mx-auto p-6 md:p-10 max-w-4xl text-center">
              <p className="text-red-600 mb-4">{error}</p>
              <button onClick={() => router.back()} className="text-blue-600 hover:underline">Go Back</button>
          </div>
      );
  }

  // Main component return
  return (
    <div className="container mx-auto p-6 md:p-10 max-w-4xl">
      {/* Changed heading */}
      <h1 className="text-3xl font-bold mb-6 text-gray-900">Edit Post</h1>
      {/* Use handleUpdate for onSubmit */}
      <form onSubmit={handleUpdate} className="space-y-6">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* Editor Column */}
          <div className="space-y-4">
            <div>
                <label htmlFor="content" className="block text-sm font-medium text-gray-700 mb-1">
                Markdown Content
                </label>
                <textarea
                  id="content"
                  name="content"
                  rows={15}
                  required
                  value={content} // Pre-populated by useEffect
                  onChange={(e) => setContent(e.target.value)}
                  disabled={saving}
                  className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm bg-white text-gray-900 placeholder-gray-500 font-mono"
                  placeholder="Write your medical notes here using Markdown... Use @tagname for tags."
                />
                <p className="mt-1 text-xs text-gray-500">
                Use Markdown for formatting. Tags start with @ (e.g., @diagnosis).
                </p>
            </div>
             {/* File Upload Section - TODO: Adapt for editing */}
             <div
                onDragOver={handleDragOver}
                onDragLeave={handleDragLeave}
                onDrop={handleDrop}
                className={`p-4 border-2 border-dashed rounded-md transition-colors ${
                    isDraggingOver
                    ? 'border-blue-500 bg-blue-50'
                    : 'border-gray-300 hover:border-gray-400 bg-white'
                }`}
             >
                <label htmlFor="media-upload" className="block text-sm font-medium text-gray-700 mb-1">
                    Attach Media (Editing media not fully supported yet)
                </label>
                <input
                    type="file"
                    id="media-upload"
                    name="media-upload"
                    multiple
                    onChange={handleFileChange}
                    ref={fileInputRef}
                    disabled={saving} // Disable while saving
                    className="block w-full text-sm text-gray-500 mt-2
                        file:mr-4 file:py-2 file:px-4
                        file:rounded-md file:border-0
                        file:text-sm file:font-semibold
                        file:bg-blue-50 file:text-blue-700
                        hover:file:bg-blue-100
                        disabled:opacity-50 cursor-pointer"
                />
                 <p className="text-center text-xs text-gray-500 mt-2">
                    {isDraggingOver ? 'Release to drop files' : 'Drag files here or click the button above'}
                </p>
                {/* TODO: Display existing files with delete options */}
                {/* Display newly added files for upload */}
                {files.length > 0 && (
                    <div className="mt-2 text-xs text-gray-600">
                        New files to upload ({files.length}): {files.map(f => f.name).join(', ')}
                    </div>
                )}
             </div>
          </div>

          {/* Preview Column */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Preview
            </label>
            <div className="prose p-3 border border-gray-300 rounded-md min-h-[300px] bg-white overflow-auto text-gray-700">
              <ReactMarkdown>{content || "Preview will appear here..."}</ReactMarkdown>
            </div>
          </div>
        </div>

        {/* Status Messages */}
        {isFetchingUrl && (
             <p className="text-yellow-600 text-sm">Fetching image from URL...</p>
        )}
        {uploadProgress && !error && !isFetchingUrl && (
            <p className="text-blue-600 text-sm">{uploadProgress}</p>
        )}
        {error && !isFetchingUrl && (
          <p className="text-red-600 text-sm">{error}</p>
        )}

        {/* Action Buttons */}
        <div>
          {/* Changed button text */}
          <button
            type="submit"
            disabled={saving || loading || !content.trim()}
            className="inline-flex justify-center px-4 py-2 rounded border border-blue-600 bg-blue-500 text-white hover:bg-blue-600 text-sm font-medium transition-colors shadow-sm focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 disabled:opacity-50"
          >
            {saving ? 'Saving...' : 'Update Post'}
          </button>
          <button
             type="button"
             // Go back to the specific post detail page
             onClick={() => router.push(`/posts/${postId}`)}
             disabled={saving}
             className="ml-4 inline-flex justify-center px-4 py-2 rounded border border-gray-300 bg-gray-100 text-gray-700 hover:bg-gray-200 text-sm font-medium transition-colors shadow-sm focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 disabled:opacity-50"
           >
             Cancel
           </button>
        </div>
      </form>
    </div>
  );
}