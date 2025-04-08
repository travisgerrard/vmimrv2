'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '../../../lib/supabaseClient'; // Correct relative path
import type { Session } from '@supabase/supabase-js';
import ReactMarkdown from 'react-markdown';
import { v4 as uuidv4 } from 'uuid'; // Import UUID generator

export default function NewPostPage() {
  const [session, setSession] = useState<Session | null>(null);
  const [content, setContent] = useState('');
  const [files, setFiles] = useState<File[]>([]); // State for selected files (now an array)
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [uploadProgress, setUploadProgress] = useState<string | null>(null); // For upload feedback
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null); // Ref for file input
  const [isDraggingOver, setIsDraggingOver] = useState(false); // State for drag-over visual feedback
  const [isFetchingUrl, setIsFetchingUrl] = useState(false); // State for URL fetch loading

  useEffect(() => {
    // Check session on load
    supabase.auth.getSession().then(({ data: { session } }: { data: { session: Session | null } }) => {
      if (!session) {
        router.push('/auth');
      } else {
        setSession(session);
        setLoading(false);
      }
    }).catch((err: unknown) => {
      console.error("Error fetching session:", err);
      setError("Could not verify authentication.");
      setLoading(false);
    });

    // Listen for auth changes
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!session) {
        router.push('/auth');
      }
      setSession(session);
    });

    return () => subscription?.unsubscribe();
  }, [router]);

  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    // Replace selection when using the file input button
    setFiles(event.target.files ? Array.from(event.target.files) : []);
  };

  // --- Drag and Drop Handlers ---
  const handleDragOver = useCallback((event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault(); // Necessary to allow dropping
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

    console.log('[handleDrop] Drop event triggered.');
    const droppedFiles = event.dataTransfer.files;
    console.log('[handleDrop] event.dataTransfer.files:', droppedFiles);

    if (droppedFiles && droppedFiles.length > 0) {
      console.log(`[handleDrop] Found ${droppedFiles.length} file(s) in dataTransfer.files.`);
      const newFiles = Array.from(droppedFiles);
      setFiles(prevFiles => [...prevFiles, ...newFiles]);
    } else if (event.dataTransfer.types.includes('text/uri-list')) {
        const uri = event.dataTransfer.getData('text/uri-list');
        console.log('[handleDrop] Found text/uri-list:', uri);
        fetchImageFromUrl(uri).then(fetchedFile => {
            if (fetchedFile) {
                setFiles(prevFiles => [...prevFiles, fetchedFile]);
            }
        });
    } else {
        console.log('[handleDrop] Dropped item type is not a file or a recognized URI.');
        setError('Could not process the dropped item. Please drag an image file or a direct image URL.');
    }
  }, []);

  // Helper to fetch image from URL and convert to File object
  const fetchImageFromUrl = async (url: string): Promise<File | null> => {
    setIsFetchingUrl(true);
    setError(null);
    console.log(`[fetchImageFromUrl] Attempting to fetch: ${url}`);
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
      console.log(`[fetchImageFromUrl] Successfully created File object:`, file);
      return file;
    } catch (err) {
      console.error('[fetchImageFromUrl] Error fetching or processing image URL:', err);
      const message = err instanceof Error ? err.message : 'Unknown error fetching image';
      if (message.includes('Failed to fetch') || message.includes('NetworkError')) {
           setError(`Could not fetch image from URL. This might be due to CORS restrictions or a network issue.`);
      } else {
           setError(`Failed to process image from URL: ${message}`);
      }
      return null;
    } finally {
      setIsFetchingUrl(false);
    }
  };

  const handleSave = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!session?.user) {
      setError('You must be logged in to save a post.');
      return;
    }
    if (!content.trim()) {
        setError('Post content cannot be empty.');
        return;
    }

    setSaving(true);
    setError(null);
    setUploadProgress(null);

    let postId: string | null = null;
    try {
      const extractedTags = content.match(/@\w+/g)?.map(tag => tag.substring(1)) || [];
      const { data: postData, error: insertError } = await supabase
        .from('posts')
        .insert({
          content: content,
          tags: extractedTags,
          user_id: session.user.id,
        })
        .select('id')
        .single();

      if (insertError) throw insertError;
      if (!postData?.id) throw new Error("Failed to retrieve post ID after creation.");
      postId = postData.id;

      if (files && files.length > 0 && postId) {
        setUploadProgress(`Uploading ${files.length} file(s)...`);
        const uploadPromises = files.map(async (file, index) => {
          const uniqueFileName = `${uuidv4()}-${file.name}`;
          const filePath = `${session.user.id}/${postId}/${uniqueFileName}`;
          setUploadProgress(`Uploading ${index + 1}/${files.length}: ${file.name}`);

          const { error: uploadError } = await supabase.storage
            .from('post-media')
            .upload(filePath, file);

          let uploadSuccessful = false;
          // @ts-expect-error - Check for Supabase Storage 409 Duplicate error
          if (!uploadError || uploadError.statusCode === '409') {
              uploadSuccessful = true;
              if (uploadError) console.warn(`[Upload Loop ${index}] Storage object already exists (409): ${filePath}.`);
              else console.log(`[Upload Loop ${index}] Storage upload reported success for ${file.name}.`);
          } else {
              console.error(`[Upload Loop ${index}] Upload failed for ${file.name} (non-409 error):`, uploadError);
          }

          if (uploadSuccessful) {
              const { error: mediaInsertError } = await supabase
                .from('media_files')
                .insert({
                  post_id: postId,
                  user_id: session.user.id,
                  file_path: filePath,
                  file_name: file.name,
                  file_type: file.type || 'application/octet-stream',
                });
              if (mediaInsertError) console.error(`[Upload Loop ${index}] Failed to insert media record for ${file.name}:`, mediaInsertError);
              else console.log(`[Upload Loop ${index}] Successfully inserted DB record for: ${file.name}`);
          } else {
              console.log(`[Upload Loop ${index}] Skipping DB insert for ${file.name} due to upload failure.`);
          }
        });
        await Promise.all(uploadPromises);
        setUploadProgress("Uploads complete!");
      } else {
         setUploadProgress("Uploads complete!"); // Set progress even if no files
      }
      router.push(`/posts/${postId}`);
    } catch (err) {
      console.error('Error saving post or uploading files:', err);
      const message = err instanceof Error ? err.message : 'An unknown error occurred';
      setError(`Failed to save: ${message}`);
      setSaving(false);
      setUploadProgress(null);
    }
  };

  if (loading) {
    return <div className="p-8 text-center text-gray-500">Loading...</div>;
  }

  // Main component return
  return (
    <div className="container mx-auto p-6 md:p-10 max-w-4xl">
      <h1 className="text-3xl font-bold mb-6 text-gray-900">Create New Post</h1>
      <form onSubmit={handleSave} className="space-y-6">
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
                  value={content}
                  onChange={(e) => setContent(e.target.value)}
                  disabled={saving}
                  className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm bg-white text-gray-900 placeholder-gray-500 font-mono"
                  placeholder="Write your medical notes here using Markdown... Use @tagname for tags."
                />
                <p className="mt-1 text-xs text-gray-500">
                Use Markdown for formatting. Tags start with @ (e.g., @diagnosis).
                </p>
            </div>
             {/* File Upload Section */}
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
                    Attach Media (Images, PDFs, Docs) - Drag & Drop or Click Below
                </label>
                <input
                    type="file"
                    id="media-upload"
                    name="media-upload"
                    multiple
                    onChange={handleFileChange}
                    ref={fileInputRef}
                    disabled={saving}
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
                {files.length > 0 && (
                    <div className="mt-2 text-xs text-gray-600">
                        Selected ({files.length}): {files.map(f => f.name).join(', ')}
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
          <button
            type="submit"
            disabled={saving || loading || !content.trim()}
            className="inline-flex justify-center px-4 py-2 rounded border border-blue-600 bg-blue-500 text-white hover:bg-blue-600 text-sm font-medium transition-colors shadow-sm focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 disabled:opacity-50"
          >
            {saving ? (uploadProgress ? 'Uploading...' : 'Saving...') : 'Save Post & Media'}
          </button>
          <button
             type="button"
             onClick={() => router.back()}
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
