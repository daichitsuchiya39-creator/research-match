/**
 * OpenAlex から特定機関の研究者を全件取得して投入
 *
 * Usage:
 *   node --experimental-strip-types --env-file=api/.env scripts/ingest-institution.ts <institution_id> [label]
 *
 * Example:
 *   node --experimental-strip-types --env-file=api/.env scripts/ingest-institution.ts I137975476 "信州大学"
 */
export {};

const INSTITUTION_ID = process.argv[2];
const LABEL = process.argv[3] ?? INSTITUTION_ID;
const API_URL = process.env.API_URL ?? "http://localhost:3001";
const MAILTO = "research-match@chiapuru.com";
const PER_PAGE = 200;
const BATCH_SIZE = 50;

if (!INSTITUTION_ID) {
  console.error("Usage: node ... ingest-institution.ts <institution_id> [label]");
  process.exit(1);
}

interface OpenAlexAuthor {
  id: string;
  display_name: string;
  last_known_institutions: Array<{ display_name: string; country_code: string }>;
  topics: Array<{
    display_name: string;
    subfield: { display_name: string };
    field: { display_name: string };
    count: number;
  }>;
  works_count: number;
  cited_by_count: number;
}

function toResearcher(author: OpenAlexAuthor) {
  const topTopics = author.topics.slice(0, 5);
  const field = topTopics[0]?.field.display_name ?? "General Research";
  const institution = author.last_known_institutions[0]?.display_name ?? "Unknown";
  const topicNames = topTopics.map((t) => t.display_name).join(", ");
  const abstract = `${topicNames || field} に関する研究を行っている。論文数: ${author.works_count}件、被引用数: ${author.cited_by_count}件。`;
  const keywords = topTopics.map((t) => t.display_name);

  return {
    id: author.id.replace("https://openalex.org/", ""),
    name: author.display_name,
    affiliation: institution,
    field,
    abstract,
    keywords,
    source: "openalex" as const,
  };
}

async function ingestBatch(batch: ReturnType<typeof toResearcher>[], label: string): Promise<number> {
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await fetch(`${API_URL}/ingest`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(batch),
      });
      if (!res.ok) {
        console.warn(`  ${label}: HTTP ${res.status} (試行${attempt})`);
        await new Promise((r) => setTimeout(r, 3000 * attempt));
        continue;
      }
      return ((await res.json()) as { ingested: number }).ingested;
    } catch (e) {
      console.warn(`  ${label} 失敗 (試行${attempt}): ${(e as Error).message}`);
      if (attempt < 3) await new Promise((r) => setTimeout(r, 5000 * attempt));
    }
  }
  console.error(`  ${label} をスキップ（3回失敗）`);
  return 0;
}

// --- main ---
console.log(`=== ResearchMatch Institution Ingest ===`);
console.log(`機関: ${LABEL} (${INSTITUTION_ID})`);
console.log(`API: ${API_URL}\n`);

// 1. 全件取得（cursor pagination）
const allAuthors: OpenAlexAuthor[] = [];
let cursor = "*";
let page = 1;

while (true) {
  const url = new URL("https://api.openalex.org/authors");
  url.searchParams.set("filter", `last_known_institutions.id:${INSTITUTION_ID}`);
  url.searchParams.set("per-page", String(PER_PAGE));
  url.searchParams.set("cursor", cursor);
  url.searchParams.set("sort", "cited_by_count:desc");
  url.searchParams.set("mailto", MAILTO);

  const res = await fetch(url.toString());
  if (!res.ok) {
    console.error(`API エラー: HTTP ${res.status}`);
    break;
  }

  const data = (await res.json()) as {
    results: OpenAlexAuthor[];
    meta: { count: number; next_cursor: string | null };
  };

  if (page === 1) {
    console.log(`総件数: ${data.meta.count}件\n`);
  }

  allAuthors.push(...data.results);
  process.stdout.write(`\r取得中: ${allAuthors.length}/${data.meta.count}件`);

  if (!data.meta.next_cursor || data.results.length === 0) break;
  cursor = data.meta.next_cursor;
  page++;
  await new Promise((r) => setTimeout(r, 300));
}

console.log(`\n\n取得完了: ${allAuthors.length}件`);

// 2. 変換
const researchers = allAuthors
  .filter((a) => a.topics.length > 0)
  .map(toResearcher);

console.log(`投入対象（topics有り）: ${researchers.length}件\n`);

// 3. バッチ投入
let totalIngested = 0;
for (let i = 0; i < researchers.length; i += BATCH_SIZE) {
  const batch = researchers.slice(i, i + BATCH_SIZE);
  const label = `バッチ ${i + 1}-${i + batch.length}`;
  const ingested = await ingestBatch(batch, label);
  totalIngested += ingested;
  console.log(`  ${label}: ${ingested}件投入 (累計 ${totalIngested})`);
  await new Promise((r) => setTimeout(r, 1000));
}

console.log(`\n✅ 完了: ${LABEL} から ${totalIngested}件投入`);
