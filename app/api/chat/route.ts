import { createClient } from "@supabase/supabase-js";
import { anthropic, type AnthropicLanguageModelOptions } from "@ai-sdk/anthropic";
import { google, type GoogleEmbeddingModelOptions } from "@ai-sdk/google";
import {
  convertToModelMessages,
  createUIMessageStreamResponse,
  embed,
  streamText,
  toUIMessageStream,
  type UIMessage,
} from "ai";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

// Must match the model and dimension used in scripts/ingest.py and thesis-rag.sql.
const EMBEDDING_MODEL = "gemini-embedding-001";
const EMBEDDING_DIMENSIONS = 768;
const CHAT_MODEL = process.env.CHAT_MODEL || "claude-opus-5-5";

export const maxDuration = 60;

type MatchedDocument = {
  content: string;
  metadata: Record<string, string | undefined> | null;
};

export async function POST(req: Request) {
  try {
    const { messages }: { messages: UIMessage[] } = await req.json();
    const lastMessage = messages[messages.length - 1];
    const question = lastMessage.parts
      .map((part) => (part.type === "text" ? part.text : ""))
      .join("");

    // 1. Generate Embedding
    const { embedding } = await embed({
      model: google.embedding(EMBEDDING_MODEL),
      value: question,
      providerOptions: {
        google: {
          outputDimensionality: EMBEDDING_DIMENSIONS,
          taskType: "RETRIEVAL_QUERY",
        } satisfies GoogleEmbeddingModelOptions,
      },
    });

    // 2. Search Supabase
    const { data: documents, error: searchError } = await supabase.rpc(
      "match_documents",
      {
        query_embedding: embedding,
        match_threshold: 0.1,
        match_count: 5,
      }
    );
    if (searchError) {
      throw new Error(`Vector search failed: ${searchError.message}`);
    }

    // 3. Construct "Smart Context" with Metadata
    const context = (documents as MatchedDocument[] | null)
      ?.map((doc) => {
        const meta = doc.metadata || {};

        // A. Extract fields
        const title = meta.title || "Unknown Title";
        const year = meta.year || "n.d.";
        const type = meta.type || "Document";

        // B. Use URL from BibTeX if available, otherwise link to the website
        const url =
          meta.url ||
          `https://alex.goldhoorn.net/publications/dl/${meta.source}`;

        // C. Create a header block for the AI to read
        // We format it clearly so the AI knows this block belongs to this source.
        return `<source>
Title: ${title}
Year: ${year}
Type: ${type}
URL: ${url}
Content:
${doc.content}
</source>`;
      })
      .join("\n\n");

    // 4. System Prompt with Citation Rules
    const systemPrompt = `You answer questions about Alex Goldhoorn's PhD thesis and academic papers, using only the sources below.

<context>
${context || "(no matching sources)"}
</context>

Base every answer on the sources. Cite each source you use as a Markdown link in the form [Title (Year)](URL), for example "The cooperative method was introduced in [New Cooperative Method (2016)](https://...)." If the sources don't contain the answer, reply "I couldn't find that in the thesis documents." Keep the tone professional but conversational.`;

    // 5. Stream Response (Claude)
    const result = streamText({
      model: anthropic(CHAT_MODEL),
      instructions: systemPrompt,
      messages: await convertToModelMessages(messages),
      providerOptions: {
        anthropic: {
          effort: "low",
          // Retry server-side on a fallback model if a safety classifier declines.
          fallbacks: "default",
        } satisfies AnthropicLanguageModelOptions,
      },
    });

    return createUIMessageStreamResponse({
      stream: toUIMessageStream({ stream: result.stream }),
    });
  } catch (error: unknown) {
    console.error("API Error:", error);
    const message = error instanceof Error ? error.message : "Unknown error";
    return new Response(JSON.stringify({ error: message }), { status: 500 });
  }
}
