"use client";

import { useChat } from "ai/react";

export default function Chat() {
  const { messages, input, handleInputChange, handleSubmit } = useChat();

  return (
    <div className="flex flex-col w-full max-w-2xl mx-auto h-screen py-10 px-4">
      <h1 className="text-2xl font-bold mb-4 text-gray-800">Chat with my Thesis</h1>
      
      <div className="flex-1 overflow-y-auto mb-4 space-y-4">
        {messages.map((m) => (
          <div
            key={m.id}
            className={`p-4 rounded-lg ${
              m.role === "user"
                ? "bg-blue-100 text-blue-900 self-end ml-10"
                : "bg-gray-100 text-gray-900 self-start mr-10"
            }`}
          >
            <span className="font-semibold text-xs uppercase block mb-1 opacity-50">
              {m.role}
            </span>
            {m.content}
          </div>
        ))}
      </div>

      <form onSubmit={handleSubmit} className="flex gap-2">
        <input
          className="flex-1 p-3 border border-gray-300 rounded-lg shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 text-black"
          value={input}
          placeholder="Ask something about the thesis..."
          onChange={handleInputChange}
        />
        <button
          type="submit"
          className="px-6 py-3 bg-blue-600 text-white font-medium rounded-lg hover:bg-blue-700 transition"
        >
          Send
        </button>
      </form>
    </div>
  );
}