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

// POST /ingest — 研究者データを投入
app.post("/", async (c) => {
  const researchers: Researcher[] = await c.req.json();

  const points = await Promise.all(
    researchers.map(async (r, i) => {
      const text = `${r.name} ${r.field} ${r.abstract} ${r.keywords.join(" ")}`;
      const vector = await embed(text);
      return {
        id: i + 1,
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

  await qdrant.upsert(COLLECTION_NAME, { points });

  return c.json({ ingested: points.length });
});

export default app;
