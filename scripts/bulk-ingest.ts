/**
 * OpenAlex から複数分野の日本在籍研究者を大量取得して一括投入
 * Usage: API_URL=https://... node --experimental-strip-types scripts/bulk-ingest.ts
 */

const API_URL = process.env.API_URL ?? "http://localhost:3001";
const MAILTO = "research-match@chiapuru.com";
const PER_PAGE = 200; // OpenAlex max

const QUERIES = [
  "machine learning",
  "deep learning",
  "robotics automation",
  "materials science",
  "biomedical engineering",
  "renewable energy battery",
  "agriculture smart farming",
  "natural language processing",
  "computer vision",
  "semiconductor electronics",
  "environmental science climate",
  "drug discovery pharmaceutical",
  "civil engineering infrastructure",
  "economics policy",
  "quantum computing",
];

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
  const topicNames = topTopics.map((t) => t.display_name).join("、");
  const abstract = `${topicNames} に関する研究を行っている。論文数: ${author.works_count}件、被引用数: ${author.cited_by_count}件。`;
  const keywords = topTopics.map((t) => t.display_name);
  return {
    id: author.id.replace("https://openalex.org/", ""),
    name: author.display_name,
    affiliation: institution,
    field,
    abstract,
    keywords,
  };
}

async function fetchQuery(query: string): Promise<OpenAlexAuthor[]> {
  const url = new URL("https://api.openalex.org/authors");
  url.searchParams.set("filter", "last_known_institutions.country_code:JP");
  url.searchParams.set("search", query);
  url.searchParams.set("per-page", String(PER_PAGE));
  url.searchParams.set("sort", "cited_by_count:desc");
  url.searchParams.set("mailto", MAILTO);

  const res = await fetch(url.toString());
  if (!res.ok) {
    console.warn(`  ⚠ ${query}: HTTP ${res.status}`);
    return [];
  }
  const data = (await res.json()) as { results: OpenAlexAuthor[]; meta: { count: number } };
  console.log(`  "${query}": ${data.results.length} / ${data.meta.count} 件`);
  return data.results;
}

// --- main ---
console.log("=== ResearchMatch Bulk Ingest ===");
console.log(`API: ${API_URL}`);
console.log(`分野数: ${QUERIES.length}, 各最大 ${PER_PAGE} 件\n`);

const seen = new Set<string>();
const allResearchers: ReturnType<typeof toResearcher>[] = [];

for (const query of QUERIES) {
  const authors = await fetchQuery(query);
  // 所属・topicsがある研究者のみ、重複除外
  for (const a of authors) {
    if (a.last_known_institutions.length === 0 || a.topics.length === 0) continue;
    if (seen.has(a.id)) continue;
    seen.add(a.id);
    allResearchers.push(toResearcher(a));
  }
  // OpenAlexレート制限対策
  await new Promise((r) => setTimeout(r, 300));
}

console.log(`\n重複除外後: ${allResearchers.length} 件`);
console.log("投入中...");

// バッチサイズ100で分割投入（タイムアウト対策）
const BATCH_SIZE = 100;
let totalIngested = 0;
let idOffset = 0;

for (let i = 0; i < allResearchers.length; i += BATCH_SIZE) {
  const batch = allResearchers.slice(i, i + BATCH_SIZE);
  // IDを通し番号にするためオフセット付きで送る
  const batchWithOffset = batch.map((r, j) => ({ ...r, _seq: idOffset + j + 1 }));

  const res = await fetch(`${API_URL}/ingest`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(batch),
  });

  if (!res.ok) {
    console.error(`  バッチ ${i}-${i + batch.length}: HTTP ${res.status}`);
    continue;
  }

  const result = (await res.json()) as { ingested: number };
  totalIngested += result.ingested;
  idOffset += batch.length;
  console.log(`  バッチ ${i + 1}-${i + batch.length}: ${result.ingested} 件 (累計 ${totalIngested})`);

  await new Promise((r) => setTimeout(r, 200));
}

console.log(`\n✅ 完了: 合計 ${totalIngested} 件を投入`);
