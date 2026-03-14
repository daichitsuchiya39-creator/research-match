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
  source?: "openalex" | "kakenhi";
}

// 研究者IDを安定した正整数に変換（ソース別に名前空間を分離）
function stableId(researcherId: string, source: "openalex" | "kakenhi" = "openalex"): number {
  const KAKENHI_OFFSET = 2_000_000_000; // 研究者番号は最大8桁 → 衝突しない
  const num = parseInt(researcherId.replace(/\D/g, ""), 10);
  if (isNaN(num)) {
    return Math.abs(researcherId.split("").reduce((h, c) => (h * 31 + c.charCodeAt(0)) | 0, 0)) || 1;
  }
  return source === "kakenhi" ? KAKENHI_OFFSET + num : num;
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
          id: stableId(r.id, r.source ?? "openalex"),
          vector,
          payload: {
            researcher_id: r.id,
            name: r.name,
            affiliation: r.affiliation,
            field: r.field,
            abstract: r.abstract,
            keywords: r.keywords,
            source: r.source ?? "openalex",
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
