import Chat from "@/app/chat";

// ?doc=<slug> opens the chat focused on one document; ?q= prefills the input
// (never sent, so a crawler following a link cannot spend an answer).
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { doc, q } = await searchParams;
  return (
    <Chat
      doc={typeof doc === "string" ? doc : null}
      question={typeof q === "string" ? q : ""}
    />
  );
}
