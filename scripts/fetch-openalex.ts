/**
 * OpenAlex APIから日本の研究者データを取得してQdrantに投入するスクリプト
 * Usage: node --experimental-strip-types scripts/fetch-openalex.ts [検索キーワード] [件数]
 * Example: node --experimental-strip-types scripts/fetch-openalex.ts "machine learning" 20
 */

const API_URL = process.env.API_URL ?? "http://localhost:3001";
const OPENALEX_MAILTO = "research-match@example.com"; // レート制限緩和のため

interface OpenAlexAuthor {
  id: string;
  display_name: string;
  last_known_institutions: Array<{
    display_name: string;
    country_code: string;
  }>;
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
  const field = topTopics[0]?.field.display_name ?? "研究分野不明";
  const institution = author.last_known_institutions[0]?.display_name ?? "所属不明";

  // topicsから研究概要を生成
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

async function fetchResearchers(query: string, perPage: number) {
  const url = new URL("https://api.openalex.org/authors");
  url.searchParams.set("filter", "last_known_institutions.country_code:JP");
  url.searchParams.set("search", query);
  url.searchParams.set("per-page", String(perPage));
  url.searchParams.set("mailto", OPENALEX_MAILTO);

  console.log(`Fetching: ${url}`);
  const res = await fetch(url.toString());
  if (!res.ok) throw new Error(`OpenAlex API error: ${res.status}`);

  const data = (await res.json()) as { results: OpenAlexAuthor[]; meta: { count: number } };
  console.log(`Found ${data.meta.count} researchers (fetching ${data.results.length})`);
  return data.results;
}

async function ingest(researchers: ReturnType<typeof toResearcher>[]) {
  const res = await fetch(`${API_URL}/ingest`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(researchers),
  });
  return res.json();
}

// --- main ---
const query = process.argv[2] ?? "machine learning";
const perPage = Math.min(Number(process.argv[3] ?? 10), 50);

const authors = await fetchResearchers(query, perPage);
const researchers = authors
  .filter((a) => a.last_known_institutions.length > 0 && a.topics.length > 0)
  .map(toResearcher);

console.log(`Transformed ${researchers.length} researchers`);

const result = await ingest(researchers);
console.log("Ingest result:", result);
