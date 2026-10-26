import { getDocs } from "@/app/lib/docs";

// Public list of the ingested documents, for ?doc= links and the focus chip.
export async function GET() {
  try {
    const docs = await getDocs();
    return Response.json(
      docs.map(({ slug, title, year, type, url }) => ({ slug, title, year, type, url })),
      { headers: { "Cache-Control": "public, max-age=600" } }
    );
  } catch (error: unknown) {
    console.error("Docs Error:", error);
    return Response.json(
      { error: "The chat is temporarily unavailable." },
      { status: 503 }
    );
  }
}
