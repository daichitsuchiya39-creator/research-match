import { Hono } from "hono";
import { embed } from "../lib/embedding.js";
import { qdrant, COLLECTION_NAME } from "../lib/qdrant.js";

const app = new Hono();

export interface Researcher {
  id: string;
  name: string;
  affiliation: string;
  field: string;
  abstract: string; // 研究概要
  keywords: string[];
}

// OpenAlex ID (例: "A1234567890") を安定した正整数に変換
function stableId(researcherId: string): number {
  const num = parseInt(researcherId.replace(/\D/g, ""), 10);
  return isNaN(num) ? Math.abs(researcherId.split("").reduce((h, c) => (h * 31 + c.charCodeAt(0)) | 0, 0)) || 1 : num;
}

// POST /ingest — 研究者データを投入（バッチ重複を防ぐため安定IDを使用）
app.post("/", async (c) => {
  const researchers: Researcher[] = await c.req.json();

  // 20件ずつ並列処理してOpenAIレート制限を緩和
  const CHUNK = 20;
  const points = [];
  for (let i = 0; i < researchers.length; i += CHUNK) {
    const chunk = researchers.slice(i, i + CHUNK);
    const chunkPoints = await Promise.all(
      chunk.map(async (r) => {
        const text = `${r.name} ${r.field} ${r.abstract} ${r.keywords.join(" ")}`;
        const vector = await embed(text);
        return {
          id: stableId(r.id),
          vector,
          payload: {
            researcher_id: r.id,
            name: r.name,
            affiliation: r.affiliation,
            field: r.field,
            abstract: r.abstract,
            keywords: r.keywords,
          },
        };
      })
    );
    points.push(...chunkPoints);
  }

  await qdrant.upsert(COLLECTION_NAME, { points });

  return c.json({ ingested: points.length });
});

export default app;
