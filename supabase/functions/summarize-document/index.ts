import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import OpenAI from 'https://esm.sh/openai@4'; // Use esm.sh for Deno compatibility
import pdf from 'https://esm.sh/pdf-parse@1.1.1/lib/pdf-parse.js'; // Import specific path if needed

// --- Interfaces ---
interface RequestPayload {
  postId: string;
  filePath: string; // e.g., user_id/post_id/filename.pdf
  fileType: string; // e.g., 'application/pdf'
}

// --- Environment Variables ---
// Ensure these are set in your Supabase project's Function settings
const supabaseUrl = Deno.env.get('SUPABASE_URL');
const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY');
// IMPORTANT: Use Service Role Key for backend updates if needed, or ensure RLS allows updates via anon key + user context.
// For simplicity here, we'll use Anon Key and assume RLS allows the user (if authenticated context is passed) or a specific role to update.
// const supabaseServiceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
const openaiApiKey = Deno.env.get('OPENAI_API_KEY');

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
  // Required for invocation from browser clients like the Next.js app
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*', // Adjust for production
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS', // Allow POST and OPTIONS for preflight
  };

  // Handle OPTIONS request (preflight)
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  // --- Validate Environment ---
  if (!supabaseUrl || !supabaseAnonKey || !openaiApiKey) {
    console.error('Missing environment variables');
    return new Response(JSON.stringify({ error: 'Internal server configuration error.' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  // --- Initialize Clients ---
  const supabaseAdmin = createClient(supabaseUrl, supabaseAnonKey); // Or use Service Role Key if needed
  const openai = new OpenAI({ apiKey: openaiApiKey });

  try {
    // --- Parse Request ---
    if (req.headers.get("content-type") !== "application/json") {
        throw new ApiError("Expected application/json", 415);
    }
    const payload: RequestPayload = await req.json();
    const { postId, filePath, fileType } = payload;

    if (!postId || !filePath || !fileType) {
      throw new ApiError('Missing required fields: postId, filePath, fileType', 400);
    }

    // --- Check File Type ---
    // Extend this later for DOCX etc.
    if (!fileType.includes('pdf')) {
      console.log(`Skipping summarization for non-PDF file: ${filePath} (${fileType})`);
      return new Response(JSON.stringify({ message: 'File type not supported for summarization.' }), {
        status: 200, // Not an error, just not applicable
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // --- Download File from Storage ---
    console.log(`Downloading file: ${filePath}`);
    const { data: blobData, error: downloadError } = await supabaseAdmin.storage
      .from('post-media') // Ensure bucket name matches
      .download(filePath);

    if (downloadError) throw new ApiError(`Failed to download file: ${downloadError.message}`, 500);
    if (!blobData) throw new ApiError('Downloaded file data is empty.', 500);

    // --- Extract Text (PDF) ---
    console.log('Extracting text from PDF...');
    const buffer = await blobData.arrayBuffer();
    const pdfData = await pdf(buffer);
    const textContent = pdfData.text;

    if (!textContent || textContent.trim().length === 0) {
        console.log(`No text content found in PDF: ${filePath}`);
        // Optionally update post summary to indicate no text found?
         await supabaseAdmin
            .from('posts')
            .update({ summary: '(No text content found in PDF)' })
            .eq('id', postId);
        return new Response(JSON.stringify({ message: 'No text content found in PDF.' }), {
            status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
    }
    console.log(`Extracted ${textContent.length} characters.`);

    // --- Generate Summary with OpenAI ---
    // Truncate text if too long for the model's context window
    const MAX_CHARS = 15000; // Adjust based on model (e.g., gpt-3.5-turbo context limit)
    const truncatedText = textContent.length > MAX_CHARS ? textContent.substring(0, MAX_CHARS) + "..." : textContent;

    console.log('Generating summary with OpenAI...');
    const completion = await openai.chat.completions.create({
      model: 'gpt-3.5-turbo', // Or choose another model
      messages: [
        { role: 'system', content: 'You are a helpful assistant that summarizes medical documents concisely.' },
        { role: 'user', content: `Please summarize the following document text:\n\n${truncatedText}` },
      ],
      max_tokens: 150, // Limit summary length
      temperature: 0.5, // Adjust creativity
    });

    const summary = completion.choices[0]?.message?.content?.trim();

    if (!summary) {
      throw new ApiError('Failed to generate summary from OpenAI.', 500);
    }
    console.log('Summary generated.');

    // --- Update Post Record in Database ---
    console.log(`Updating post ${postId} with summary...`);
    const { error: updateError } = await supabaseAdmin
      .from('posts')
      .update({ summary: summary, updated_at: new Date().toISOString() }) // Also update updated_at
      .eq('id', postId);

    if (updateError) {
      // Log detailed error but return generic message
      console.error('Database update error:', updateError);
      throw new ApiError('Failed to save summary to the database.', 500);
    }
    console.log('Post updated successfully.');

    // --- Return Success ---
    return new Response(JSON.stringify({ message: 'Summary generated and saved successfully.', summary }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    // --- Handle Errors ---
    console.error('Error in summarize-document function:', error);
    const status = error instanceof ApiError ? error.status : 500;
    const message = error instanceof Error ? error.message : 'An unexpected error occurred.';
    return new Response(JSON.stringify({ error: message }), {
      status: status,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
