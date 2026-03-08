import { readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const API_URL = process.env.API_URL ?? "http://localhost:3001";

const data = JSON.parse(
  readFileSync(resolve(__dirname, "sample-data.json"), "utf-8")
);

const res = await fetch(`${API_URL}/ingest`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(data),
});

const result = await res.json();
console.log("Ingest result:", result);
