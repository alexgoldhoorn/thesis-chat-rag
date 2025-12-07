"use client";

import { useChat } from "@ai-sdk/react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { useEffect, useRef } from "react";

export default function Chat() {
  const { messages, input, handleInputChange, handleSubmit, isLoading } = useChat();
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom when messages change
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isLoading]);

  return (
    <div className="flex flex-col w-full max-w-3xl mx-auto h-screen py-6 px-4 bg-white">
      {/* Header */}
      <div className="mb-6 border-b pb-4">
        <h1 className="text-3xl font-bold text-gray-900">Chat with my Thesis</h1>
        <p className="text-gray-500 text-sm mt-1">
          Ask questions about my PhD research and publications.
        </p>
      </div>
      
      {/* Messages Area */}
      <div className="flex-1 overflow-y-auto mb-4 space-y-6 pr-2">
        {messages.length === 0 && (
          <div className="text-center text-gray-400 mt-20">
            <p>No messages yet. Ask something like:</p>
            <p className="italic mt-2">"What is the main contribution of the 2016 paper?"</p>
          </div>
        )}

        {messages.map((m) => (
          <div
            key={m.id}
            className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}
          >
            <div
              className={`p-4 rounded-2xl max-w-[85%] shadow-sm border ${
                m.role === "user"
                  ? "bg-blue-600 text-white border-blue-600"
                  : "bg-gray-50 text-gray-900 border-gray-200"
              }`}
            >
              {/* Markdown Rendering */}
              <div
                className={`prose prose-sm max-w-none ${
                  m.role === "user" ? "prose-invert" : ""
                }`}
              >
                <ReactMarkdown 
                  remarkPlugins={[remarkGfm]}
                  components={{
                    // Make links open in new tab
                    a: ({node, ...props}) => <a {...props} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline font-medium" />
                  }}
                >
                  {m.content}
                </ReactMarkdown>
              </div>
            </div>
          </div>
        ))}

        {/* Loading Indicator */}
        {isLoading && messages[messages.length - 1]?.role === "user" && (
          <div className="flex justify-start animate-pulse">
            <div className="bg-gray-100 p-4 rounded-2xl border border-gray-200 text-gray-500 text-sm">
              Thinking... <span className="inline-block animate-bounce">●</span>
            </div>
          </div>
        )}
        
        {/* Invisible div to scroll to */}
        <div ref={messagesEndRef} />
      </div>

      {/* Input Area */}
      <form onSubmit={handleSubmit} className="flex gap-3 pt-2">
        <input
          className="flex-1 p-3 bg-gray-50 border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent text-gray-900 placeholder-gray-400 transition-all"
          value={input}
          placeholder="Ask a question..."
          onChange={handleInputChange}
          disabled={isLoading}
        />
        <button
          type="submit"
          disabled={isLoading || !input.trim()}
          className="px-6 py-3 bg-blue-600 text-white font-semibold rounded-xl hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors shadow-sm"
        >
          Send
        </button>
      </form>
    </div>
  );
}