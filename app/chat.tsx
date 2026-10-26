"use client";

import { useChat } from "@ai-sdk/react";
import type { UIMessage } from "ai";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { useEffect, useRef, useState } from "react";
import { SLUG_PATTERN, type DocInfo } from "@/app/lib/focus";

// Mirrors the route's limit; the route still enforces it.
const MAX_QUESTION_CHARS = 1000;

const GENERAL_SUGGESTIONS = [
  "What is the main contribution of your thesis?",
  "How does the cooperative search method work?",
  "Which robots were used in the experiments?",
];
const FOCUSED_SUGGESTIONS = [
  "What is the main contribution of this paper?",
  "Which methods does it compare?",
  "What were the experimental results?",
];

type Focus =
  | { state: "none" }
  | { state: "loading" }
  | { state: "focused"; doc: DocInfo }
  | { state: "unknown" }
  | { state: "unavailable" };

// The route answers errors as {"error": "..."}; anything else (e.g. the proxy's
// 429 page) gets the generic message.
function errorText(error: Error) {
  try {
    const parsed = JSON.parse(error.message);
    if (typeof parsed?.error === "string") return parsed.error;
  } catch {}
  return "Something went wrong. Please try again.";
}

type ArxivOutput = { query?: string; papers?: unknown[]; error?: string };

// One status line per arxiv_search call, shown above the answer text.
function arxivStatus(part: UIMessage["parts"][number]) {
  if (part.type !== "tool-arxiv_search") return null;
  const query = (part.input as { query?: string } | undefined)?.query;
  if (part.state === "output-available") {
    const output = part.output as ArxivOutput;
    if (output.error) return `arXiv search failed: ${output.error}`;
    return `Searched arXiv for “${output.query ?? query}” (${output.papers?.length ?? 0} results)`;
  }
  if (part.state === "output-error") return "arXiv search failed.";
  return query ? `Searching arXiv for “${query}”…` : "Searching arXiv…";
}

// Drops ?doc= from the address bar, so a reload opens the general chat.
function clearDocParam() {
  const url = new URL(window.location.href);
  url.searchParams.delete("doc");
  window.history.replaceState(null, "", url);
}

export default function Chat({
  doc,
  question,
}: {
  doc: string | null;
  question: string;
}) {
  const [input, setInput] = useState(question.slice(0, MAX_QUESTION_CHARS));
  const [focus, setFocus] = useState<Focus>(
    doc === null
      ? { state: "none" }
      : SLUG_PATTERN.test(doc)
        ? { state: "loading" }
        : { state: "unknown" }
  );
  const { messages, sendMessage, status, error } = useChat();
  const isLoading = status === "submitted" || status === "streaming";
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Resolve ?doc= against the document list. Unknown is shown, never a
  // silent fallback; a failed lookup also leaves the chat unfocused.
  useEffect(() => {
    if (doc === null || !SLUG_PATTERN.test(doc)) return;
    let cancelled = false;
    fetch("/api/docs")
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json() as Promise<DocInfo[]>;
      })
      .then((docs) => {
        if (cancelled) return;
        const found = docs.find((d) => d.slug === doc);
        setFocus(found ? { state: "focused", doc: found } : { state: "unknown" });
      })
      .catch(() => {
        if (!cancelled) setFocus({ state: "unavailable" });
      });
    return () => {
      cancelled = true;
    };
  }, [doc]);

  const focusedDoc = focus.state === "focused" ? focus.doc : null;

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isLoading]);

  return (
    <div className="flex flex-col w-full max-w-[1000px] mx-auto h-screen py-6 px-5">
      {/* Header */}
      <div className="mb-6 pb-4 bg-gradient-to-r from-primary to-primary-dark rounded-xl p-6 text-white shadow-md">
        <h1 className="text-3xl font-bold tracking-tight">
          Chat with my Research
        </h1>
        <p className="text-sm mt-2 opacity-95 leading-relaxed max-w-2xl">
          Ask questions about my PhD thesis on cooperative robotics, multi-robot
          search, and related academic publications. Answers are generated from
          the actual documents using retrieval-augmented generation.
        </p>
        <a
          href="https://alex.goldhoorn.net"
          target="_blank"
          rel="noopener noreferrer"
          className="inline-block mt-3 text-xs font-medium opacity-80 hover:opacity-100 transition-opacity"
        >
          alex.goldhoorn.net
        </a>
      </div>

      {/* Document focus */}
      {focusedDoc && (
        <div className="mb-4 flex items-center gap-2 self-start max-w-full px-3 py-2 text-sm bg-white border border-primary rounded-lg text-text-dark shadow-sm">
          <span className="shrink-0 text-gray-500">Focused on:</span>
          <a
            href={focusedDoc.url}
            target="_blank"
            rel="noopener noreferrer"
            className="truncate font-medium text-primary hover:text-primary-dark hover:underline"
          >
            {focusedDoc.title} ({focusedDoc.year})
          </a>
          <button
            type="button"
            onClick={() => {
              setFocus({ state: "none" });
              clearDocParam();
            }}
            aria-label="Ask the whole collection instead"
            title="Ask the whole collection instead"
            className="shrink-0 ml-1 px-1.5 text-gray-400 hover:text-text-dark cursor-pointer"
          >
            ✕
          </button>
        </div>
      )}
      {(focus.state === "unknown" || focus.state === "unavailable") && (
        <div className="mb-4 flex items-center gap-2 self-start px-3 py-2 text-sm bg-amber-50 border border-amber-200 rounded-lg text-amber-800">
          <span>
            {focus.state === "unknown"
              ? "That document isn't in the chat's library; asking the whole collection instead."
              : "The document library couldn't be loaded; asking the whole collection instead."}
          </span>
          <button
            type="button"
            onClick={() => {
              setFocus({ state: "none" });
              clearDocParam();
            }}
            aria-label="Dismiss"
            className="shrink-0 px-1.5 text-amber-600 hover:text-amber-900 cursor-pointer"
          >
            ✕
          </button>
        </div>
      )}

      {/* Messages */}
      <div className="flex-1 overflow-y-auto mb-4 space-y-4 pr-2">
        {messages.length === 0 && (
          <div className="text-center text-gray-400 mt-16 space-y-4">
            <p className="text-lg">No messages yet. Try asking:</p>
            <div className="flex flex-wrap justify-center gap-2">
              {(focusedDoc ? FOCUSED_SUGGESTIONS : GENERAL_SUGGESTIONS).map((q) => (
                <button
                  key={q}
                  type="button"
                  onClick={() => setInput(q)}
                  className="px-4 py-2 text-sm bg-white border border-gray-200 rounded-lg text-text-dark hover:border-primary hover:shadow-sm transition-all cursor-pointer"
                >
                  {q}
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((m) => (
          <div
            key={m.id}
            className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}
          >
            <div
              className={`p-4 rounded-xl max-w-[85%] shadow-sm border transition-all ${
                m.role === "user"
                  ? "bg-primary text-white border-primary"
                  : "bg-white text-text-dark border-gray-200"
              }`}
            >
              {m.parts.map((part, i) => {
                const status = arxivStatus(part);
                return (
                  status && (
                    <p key={i} className="mb-2 text-xs text-gray-400 italic">
                      {status}
                    </p>
                  )
                );
              })}
              <div
                className={`prose prose-sm max-w-none ${
                  m.role === "user" ? "prose-invert" : ""
                }`}
              >
                <ReactMarkdown
                  remarkPlugins={[remarkGfm]}
                  components={{
                    // eslint-disable-next-line @typescript-eslint/no-unused-vars -- keep `node` off the DOM element
                    a: ({ node, ...props }) => (
                      <a
                        {...props}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-primary hover:text-primary-dark hover:underline font-medium transition-colors"
                      />
                    ),
                  }}
                >
                  {m.parts
                    .map((part) => (part.type === "text" ? part.text : ""))
                    .join("")}
                </ReactMarkdown>
              </div>
            </div>
          </div>
        ))}

        {isLoading && messages[messages.length - 1]?.role === "user" && (
          <div className="flex justify-start">
            <div className="bg-white p-4 rounded-xl border border-gray-200 text-gray-400 text-sm shadow-sm">
              Thinking...{" "}
              <span className="inline-block animate-bounce">&#9679;</span>
            </div>
          </div>
        )}

        {error && (
          <div className="flex justify-start">
            <div className="bg-red-50 p-4 rounded-xl border border-red-200 text-red-700 text-sm shadow-sm">
              {errorText(error)}
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (!input.trim()) return;
          sendMessage(
            { text: input },
            focusedDoc ? { body: { doc: focusedDoc.slug } } : undefined
          );
          setInput("");
        }}
        className="flex gap-3 pt-2"
      >
        <input
          type="text"
          className="flex-1 p-3 bg-white border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent text-text-dark placeholder-gray-400 transition-all shadow-sm"
          value={input}
          placeholder="Ask a question about my research..."
          onChange={(e) => setInput(e.target.value)}
          maxLength={MAX_QUESTION_CHARS}
          disabled={isLoading}
        />
        <button
          type="submit"
          disabled={isLoading || !input.trim()}
          className="px-6 py-3 bg-primary text-white font-semibold rounded-xl hover:bg-primary-dark disabled:opacity-50 disabled:cursor-not-allowed transition-all shadow-sm hover:shadow-md hover:-translate-y-0.5"
        >
          Send
        </button>
      </form>
    </div>
  );
}
