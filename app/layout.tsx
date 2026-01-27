import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Chat with my Research - Alex Goldhoorn",
  description:
    "Ask questions about Alex Goldhoorn's PhD thesis and academic publications on robotics and multi-robot systems.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="bg-page-bg text-text-dark font-sans">{children}</body>
    </html>
  );
}
