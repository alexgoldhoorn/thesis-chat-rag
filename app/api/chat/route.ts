import { createClient } from "@supabase/supabase-js";
import { google } from "@ai-sdk/google";
import { streamText, embed } from "ai";

// Initialize Supabase client
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

export const maxDuration = 30;

export async function POST(req: Request) {
  const { messages } = await req.json();
  const lastMessage = messages[messages.length - 1];

  // 1. Generate embedding for the user's query
  const { embedding } = await embed({
    model: google.textEmbeddingModel("text-embedding-004"),
    value: lastMessage.content,
  });

  // 2. Search Supabase for similar content
  const { data: documents } = await supabase.rpc("match_documents", {
    query_embedding: embedding,
    match_threshold: 0.5, // Adjust sensitivity
    match_count: 5,
  });

  // 3. Construct context block
  const context = documents
    ?.map((doc: any) => doc.content)
    .join("\n\n");

  // 4. Create system prompt with context
  const systemPrompt = `You are a helpful assistant. 
  Answer the user's question based strictly on the context provided below. 
  If the answer is not in the context, say you don't know.
  
  Context:
  ${context}`;

  // 5. Stream response using Gemini 1.5 Flash
  const result = streamText({
    model: google("gemini-1.5-flash"),
    system: systemPrompt,
    messages,
  });

  return result.toDataStreamResponse();
}