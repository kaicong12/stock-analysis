import { fetchMacroContext } from "@/lib/gemini/macro";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function GET() {
  const text = await fetchMacroContext();
  if (text === null) {
    return Response.json({ error: "Macro briefing unavailable — check GEMINI_API_KEY." }, { status: 500 });
  }
  return Response.json({ text });
}
