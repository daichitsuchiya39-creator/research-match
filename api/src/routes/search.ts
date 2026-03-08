import { Hono } from "hono";
import OpenAI from "openai";
import { embed } from "../lib/embedding.js";
import { qdrant, COLLECTION_NAME } from "../lib/qdrant.js";

const app = new Hono();
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

async function generateMatchReason(query: string, researcher: Record<string, unknown>): Promise<string> {
  const res = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [
      {
        role: "system",
        content: "あなたは産学連携の専門家です。企業ニーズと研究者プロフィールを照らし合わせ、なぜマッチするかを2〜3文で簡潔に説明してください。",
      },
      {
        role: "user",
        content: `【企業ニーズ】\n${query}\n\n【研究者】\n名前: ${researcher.name}\n所属: ${researcher.affiliation}\n分野: ${researcher.field}\n研究概要: ${researcher.abstract}\nキーワード: ${(researcher.keywords as string[]).join(", ")}`,
      },
    ],
    max_tokens: 200,
    temperature: 0.7,
  });
  return res.choices[0].message.content ?? "";
}

// POST /search — 企業ニーズで研究者を検索
app.post("/", async (c) => {
  const { query, limit = 5, explain = true } = await c.req.json<{
    query: string;
    limit?: number;
    explain?: boolean;
  }>();

  if (!query) return c.json({ error: "query is required" }, 400);

  const vector = await embed(query);

  const results = await qdrant.search(COLLECTION_NAME, {
    vector,
    limit,
    with_payload: true,
  });

  const matches = await Promise.all(
    results.map(async (r) => {
      const base = {
        score: Math.round(r.score * 1000) / 1000,
        ...(r.payload as Record<string, unknown>),
      };
      if (!explain) return base;
      const match_reason = await generateMatchReason(query, r.payload as Record<string, unknown>);
      return { ...base, match_reason };
    })
  );

  return c.json({ query, matches });
});

export default app;
