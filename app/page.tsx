"use client";

import { useChat } from "@ai-sdk/react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { useEffect, useRef } from "react";

export default function Chat() {
  const { messages, input, handleInputChange, handleSubmit, isLoading } =
    useChat();
  const messagesEndRef = useRef<HTMLDivElement>(null);

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

      {/* Messages */}
      <div className="flex-1 overflow-y-auto mb-4 space-y-4 pr-2">
        {messages.length === 0 && (
          <div className="text-center text-gray-400 mt-16 space-y-4">
            <p className="text-lg">No messages yet. Try asking:</p>
            <div className="flex flex-wrap justify-center gap-2">
              {[
                "What is the main contribution of your thesis?",
                "How does the cooperative search method work?",
                "Which robots were used in the experiments?",
              ].map((q) => (
                <button
                  key={q}
                  type="button"
                  onClick={() => {
                    const nativeInputValueSetter =
                      Object.getOwnPropertyDescriptor(
                        window.HTMLInputElement.prototype,
                        "value"
                      )?.set;
                    const inputEl = document.querySelector(
                      'input[type="text"]'
                    ) as HTMLInputElement;
                    if (inputEl && nativeInputValueSetter) {
                      nativeInputValueSetter.call(inputEl, q);
                      inputEl.dispatchEvent(
                        new Event("input", { bubbles: true })
                      );
                    }
                  }}
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
              <div
                className={`prose prose-sm max-w-none ${
                  m.role === "user" ? "prose-invert" : ""
                }`}
              >
                <ReactMarkdown
                  remarkPlugins={[remarkGfm]}
                  components={{
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
                  {m.content}
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

        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <form onSubmit={handleSubmit} className="flex gap-3 pt-2">
        <input
          type="text"
          className="flex-1 p-3 bg-white border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent text-text-dark placeholder-gray-400 transition-all shadow-sm"
          value={input}
          placeholder="Ask a question about my research..."
          onChange={handleInputChange}
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
