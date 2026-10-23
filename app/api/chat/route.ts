import { Pool } from "pg";
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

// Read-only role: it can only SELECT documents and call match_documents (db/init.sh).
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 3,
  statement_timeout: 10_000,
});

// Must match the model and dimension used in scripts/ingest.py and db/init.sh.
const EMBEDDING_MODEL = "gemini-embedding-001";
const EMBEDDING_DIMENSIONS = 768;
const CHAT_MODEL = process.env.CHAT_MODEL || "claude-opus-5-5";

export const maxDuration = 60;

// The route is public, so every request is bounded: question size, history
// length and answer length all cap what one visitor can spend.
const MAX_QUESTION_CHARS = 1000;
const MAX_MESSAGE_CHARS = 8000;
const MAX_HISTORY_MESSAGES = 10;
const MAX_OUTPUT_TOKENS = 1500;

// Global backstop on Anthropic spend: at most DAILY_ANSWER_LIMIT answers per
// day (Europe/Madrid) across all visitors. In memory, so a restart resets it;
// fine for a single container.
const DAILY_ANSWER_LIMIT = Number(process.env.DAILY_ANSWER_LIMIT) || 200;
const answersToday = { day: "", count: 0 };

function takeDailySlot() {
  const day = new Date().toLocaleDateString("sv-SE", {
    timeZone: "Europe/Madrid",
  });
  if (answersToday.day !== day) {
    answersToday.day = day;
    answersToday.count = 0;
  }
  if (answersToday.count >= DAILY_ANSWER_LIMIT) return false;
  answersToday.count++;
  return true;
}

function badRequest(message: string) {
  return new Response(JSON.stringify({ error: message }), { status: 400 });
}

function textOf(message: UIMessage) {
  return message.parts
    .map((part) => (part.type === "text" ? part.text : ""))
    .join("");
}

// Keep only well-formed user/assistant text messages from the tail of the history.
function sanitizeMessages(raw: unknown): UIMessage[] | null {
  if (!Array.isArray(raw) || raw.length === 0) return null;
  const messages: UIMessage[] = [];
  for (const m of raw.slice(-MAX_HISTORY_MESSAGES)) {
    if (
      !m ||
      (m.role !== "user" && m.role !== "assistant") ||
      !Array.isArray(m.parts)
    ) {
      return null;
    }
    const text = m.parts
      .filter(
        (p: unknown): p is { type: "text"; text: string } =>
          !!p &&
          (p as { type?: unknown }).type === "text" &&
          typeof (p as { text?: unknown }).text === "string"
      )
      .map((p: { text: string }) => p.text)
      .join("")
      .slice(0, MAX_MESSAGE_CHARS);
    messages.push({
      id: typeof m.id === "string" ? m.id.slice(0, 64) : "",
      role: m.role,
      parts: [{ type: "text", text }],
    });
  }
  return messages;
}

type MatchedDocument = {
  content: string;
  metadata: Record<string, string | undefined> | null;
};

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => null);
    const messages = sanitizeMessages(body?.messages);
    if (!messages) return badRequest("Invalid request.");
    const lastMessage = messages[messages.length - 1];
    const question = textOf(lastMessage).trim();
    if (lastMessage.role !== "user" || !question) {
      return badRequest("Ask a question.");
    }
    if (question.length > MAX_QUESTION_CHARS) {
      return badRequest(
        `Please keep questions under ${MAX_QUESTION_CHARS} characters.`
      );
    }

    if (!takeDailySlot()) {
      console.warn(`Daily answer limit (${DAILY_ANSWER_LIMIT}) reached`);
      return new Response(
        JSON.stringify({
          error: "The chat has answered enough questions for today. Please try again tomorrow.",
        }),
        { status: 503 }
      );
    }

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

    // 2. Vector search
    const { rows: documents } = await pool.query<MatchedDocument>(
      "select content, metadata from match_documents($1::vector, $2, $3)",
      [JSON.stringify(embedding), 0.1, 5]
    );

    // 3. Construct "Smart Context" with Metadata
    const context = documents
      .map((doc) => {
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
      maxOutputTokens: MAX_OUTPUT_TOKENS,
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
    // Details stay in the server log; visitors get a generic message.
    console.error("API Error:", error);
    return new Response(
      JSON.stringify({ error: "Something went wrong. Please try again." }),
      { status: 500 }
    );
  }
}
