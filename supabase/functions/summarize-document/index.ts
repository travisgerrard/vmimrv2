import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import OpenAI from 'https://esm.sh/openai@4';
import type { ThreadMessage } from 'https://esm.sh/openai@4/resources/beta/threads/messages.mjs'; // Import Message type
import { delay } from "https://deno.land/std@0.177.0/async/delay.ts"; // Import delay

// --- Interfaces ---
interface RequestPayload {
  postId: string;
  filePath: string; // e.g., user_id/post_id/filename.pdf
  fileType: string; // e.g., 'application/pdf'
}

// --- Environment Variables ---
const supabaseUrl = Deno.env.get('SUPABASE_URL');
const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY'); // Use Service Role Key
const openaiApiKey = Deno.env.get('OPENAI_API_KEY');
const assistantId = Deno.env.get('OPENAI_ASSISTANT_ID');

// --- Error Handling ---
class ApiError extends Error {
  status: number;
  constructor(message: string, status: number = 500) {
    super(message);
    this.status = status;
  }
}

// --- Main Handler ---
serve(async (req: Request) => {
  // --- CORS Headers ---
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*', // Adjust for production
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
  };

  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  // --- Validate Environment ---
  if (!supabaseUrl || !supabaseServiceKey || !openaiApiKey || !assistantId) { // Check for Service Key
    console.error('Missing environment variables (SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, OPENAI_API_KEY, OPENAI_ASSISTANT_ID)');
    return new Response(JSON.stringify({ error: 'Internal server configuration error.' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  // --- Initialize Clients ---
  // Use Service Role Key for admin tasks like updating posts, bypassing RLS
  const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);
  const openai = new OpenAI({ apiKey: openaiApiKey });

  let openAiFileId: string | null = null;
  let postId: string | null = null; // Declare postId here

  try {
    // --- Parse Request ---
    if (req.headers.get("content-type") !== "application/json") {
        throw new ApiError("Expected application/json", 415);
    }
    const payload: RequestPayload = await req.json();
    // Assign postId after parsing
    postId = payload.postId;
    const { filePath, fileType } = payload; // Keep others local
    // const { postId, filePath, fileType } = payload; // postId is now assigned above

    if (!postId || !filePath || !fileType) {
      throw new ApiError('Missing required fields: postId, filePath, fileType', 400);
    }

    // --- Check File Type (Assistants API supports PDF) ---
    if (!fileType.includes('pdf')) {
      console.log(`Skipping summarization for non-PDF file: ${filePath} (${fileType})`);
      return new Response(JSON.stringify({ message: 'File type not supported for summarization by this function.' }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // --- Download File from Storage ---
    console.log(`Downloading file: ${filePath}`);
    const { data: blobData, error: downloadError } = await supabaseAdmin.storage
      .from('post-media')
      .download(filePath);

    if (downloadError) throw new ApiError(`Failed to download file: ${downloadError.message}`, 500);
    if (!blobData) throw new ApiError('Downloaded file data is empty.', 500);
    console.log(`File downloaded successfully (${blobData.size} bytes).`);

    // --- Upload File to OpenAI ---
    console.log('Uploading file to OpenAI...');
    // Use ReadableStream directly if OpenAI SDK supports it, otherwise convert Blob to File-like object
    // Note: Deno's File constructor might differ. Creating a File-like object for compatibility.
    const fileObject = new File([blobData], filePath.split('/').pop() || 'document.pdf', { type: fileType });

    const uploadedFile = await openai.files.create({
        file: fileObject,
        purpose: 'assistants',
    });
    openAiFileId = uploadedFile.id; // Store for potential cleanup
    console.log(`File uploaded to OpenAI. File ID: ${openAiFileId}`);

    // --- Create a Thread ---
    console.log('Creating OpenAI Thread...');
    const thread = await openai.beta.threads.create();
    console.log(`Thread created. Thread ID: ${thread.id}`);

    // --- Add Message to Thread ---
    console.log('Adding message to Thread...');
    await openai.beta.threads.messages.create(thread.id, {
      role: 'user',
      content: `Please summarize the document provided in the attached file.`,
      attachments: [ // Use attachments for File Search
        { file_id: openAiFileId, tools: [{ type: "file_search" }] }
      ],
    });
    console.log('Message added.');

    // --- Create and Run Assistant ---
    console.log(`Creating Run with Assistant ID: ${assistantId}...`);
    let run = await openai.beta.threads.runs.create(thread.id, {
      assistant_id: assistantId,
      // Optional: Add instructions specific to this run if needed
    });
    console.log(`Run created. Run ID: ${run.id}, Status: ${run.status}`);

    // --- Poll for Run Completion ---
    const maxAttempts = 20; // ~2 minutes total polling time
    const pollInterval = 6000; // 6 seconds
    let attempts = 0;

    while (['queued', 'in_progress', 'cancelling'].includes(run.status) && attempts < maxAttempts) {
        await delay(pollInterval);
        console.log(`Polling Run status... Attempt ${attempts + 1}`);
        run = await openai.beta.threads.runs.retrieve(thread.id, run.id);
        console.log(`Run status: ${run.status}`);
        attempts++;
    }

    if (run.status !== 'completed') {
        console.error(`Run did not complete successfully. Final status: ${run.status}`);
        // Optionally cancel the run if needed: await openai.beta.threads.runs.cancel(thread.id, run.id);
        throw new ApiError(`Assistant run failed or timed out. Status: ${run.status}`, 500);
    }
    console.log('Run completed.');

    // --- Retrieve Messages from Thread ---
    console.log('Retrieving messages from Thread...');
    const messages = await openai.beta.threads.messages.list(thread.id, { order: 'desc' }); // Get latest first

    // Find the latest assistant message
    const assistantMessage = messages.data.find((m: ThreadMessage) => m.role === 'assistant'); // Add type for 'm'
    let summary = 'Summary could not be generated.'; // Default summary

    if (assistantMessage && assistantMessage.content[0]?.type === 'text') {
        summary = assistantMessage.content[0].text.value;
        console.log('Summary extracted from assistant message.');
    } else {
        console.warn('Could not find assistant text response in messages.');
    }

    // --- Update Post Record in Database ---
    console.log(`Updating post ${postId} with summary...`);
    const { error: updateError } = await supabaseAdmin
      .from('posts')
      .update({ summary: summary, updated_at: new Date().toISOString() })
      .eq('id', postId);

    if (updateError) {
      console.error('Database update error:', updateError);
      throw new ApiError('Failed to save summary to the database.', 500);
    }
    console.log('Post updated successfully.');

    // --- Return Success ---
    return new Response(JSON.stringify({ message: 'Summary generated and saved successfully via Assistant.', summary }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    // --- Handle Errors ---
    console.error('Error in summarize-document function (Assistants API):', error);
    const status = error instanceof ApiError ? error.status : 500;
    const message = error instanceof Error ? error.message : 'An unexpected error occurred.';

    // Attempt to update the post summary with an error message
    const errorSummary = `Error: Summarization failed. (${message.substring(0, 100)}${message.length > 100 ? '...' : ''})`; // Truncate long messages
    try {
        if (postId) { // Ensure postId was parsed earlier
             await supabaseAdmin
                .from('posts')
                .update({ summary: errorSummary, updated_at: new Date().toISOString() })
                .eq('id', postId);
             console.log(`Updated post ${postId} summary with error message.`);
        }
    } catch (updateErr) {
        console.error('Failed to update post summary with error message:', updateErr);
    }

    // Return the error response to the caller
    return new Response(JSON.stringify({ error: message }), {
      status: status,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } finally {
      // --- Optional: Clean up uploaded OpenAI file ---
      if (openAiFileId) {
          try {
              console.log(`Attempting to delete OpenAI file: ${openAiFileId}`);
              await openai.files.del(openAiFileId);
              console.log(`Successfully deleted OpenAI file: ${openAiFileId}`);
          } catch (cleanupError) {
              console.warn(`Failed to delete OpenAI file ${openAiFileId}:`, cleanupError);
          }
      }
  }
});
