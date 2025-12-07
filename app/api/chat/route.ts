import { createClient } from "@supabase/supabase-js";
import { google } from "@ai-sdk/google";
import { streamText, embed } from "ai";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

export const maxDuration = 30;

export async function POST(req: Request) {
  try {
    const { messages } = await req.json();
    const lastMessage = messages[messages.length - 1];

    // 1. Generate Embedding
    const { embedding } = await embed({
      model: google.textEmbeddingModel("text-embedding-004"),
      value: lastMessage.content,
    });

    // 2. Search Supabase
    const { data: documents } = await supabase.rpc("match_documents", {
      query_embedding: embedding,
      match_threshold: 0.1,
      match_count: 5,
    });

    // 3. Construct "Smart Context" with Metadata
    const context = documents
      ?.map((doc: any) => {
        const meta = doc.metadata || {};
        
        // A. Extract fields
        const title = meta.title || "Unknown Title";
        const year = meta.year || "n.d.";
        const type = meta.type || "Document";
        
        // B. Handle the URL (Logic to find the link)
        // Option 1: Use URL from BibTeX if available
        let url = meta.url;
        
        // Option 2: Fallback - Construct link to your website manually if missing
        if (!url) {
            // Example: https://alexgoldhoorn.com/publications/Goldhoorn2016.pdf
            url = `https://alex.goldhoorn.net/publications/dl/${meta.source}`;
        }

        // C. Create a header block for the AI to read
        // We format it clearly so the AI knows this block belongs to this source.
        return `
SOURCE_START
Title: ${title}
Year: ${year}
Type: ${type}
URL: ${url}
Content:
${doc.content}
SOURCE_END`;
      })
      .join("\n\n");

    // 4. System Prompt with Citation Rules
    const systemPrompt = `You are an advanced academic assistant answering questions about the author's thesis and papers.

    CONTEXT:
    ${context}

    INSTRUCTIONS:
    1. Answer the user's question strictly based on the provided CONTEXT.
    2. CITATIONS ARE MANDATORY:
       - When you use information from a source, you MUST cite it.
       - Format citations as Markdown links: [Title (Year)](URL).
       - Example: "The cooperative method was introduced in [New Cooperative Method (2016)](https://...)."
    3. If the answer is not in the context, say "I couldn't find that in the thesis documents."
    4. Keep answers professional but conversational.
    `;

    // 5. Stream Response (Gemini 2.5)
    const result = await streamText({
      model: google("gemini-2.5-flash"),
      system: systemPrompt,
      messages,
    });

    return result.toDataStreamResponse();

  } catch (error: any) {
    console.error("API Error:", error);
    return new Response(JSON.stringify({ error: error.message }), { status: 500 });
  }
}