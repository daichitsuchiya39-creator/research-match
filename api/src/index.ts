import "dotenv/config";
import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import { ensureCollection } from "./lib/qdrant.js";
import ingestRoute from "./routes/ingest.js";
import searchRoute from "./routes/search.js";

const app = new Hono();

app.use("*", logger());
app.use("*", cors());

app.get("/", (c) => c.json({ status: "ok", service: "research-match-api" }));
app.route("/ingest", ingestRoute);
app.route("/search", searchRoute);

const PORT = Number(process.env.PORT ?? 3001);

await ensureCollection();

serve({ fetch: app.fetch, port: PORT }, () => {
  console.log(`API running at http://localhost:${PORT}`);
});
