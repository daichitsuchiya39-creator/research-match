/**
 * OpenAlex APIから日本の研究者データを取得してQdrantに投入するスクリプト
 * Usage: OPENAI_API_KEY=sk-... node --experimental-strip-types scripts/fetch-openalex.ts [検索キーワード] [件数]
 * Example: OPENAI_API_KEY=sk-... node --experimental-strip-types scripts/fetch-openalex.ts "machine learning" 20
 */

const API_URL = process.env.API_URL ?? "http://localhost:3001";
const OPENAI_API_KEY = process.env.OPENAI_API_KEY ?? "";
const OPENALEX_MAILTO = "research-match@chiapuru.com";

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

async function translateTopics(englishNames: string[]): Promise<Record<string, string>> {
  if (!OPENAI_API_KEY) {
    console.warn("⚠ OPENAI_API_KEY未設定のため翻訳をスキップ（英語のまま投入）");
    return {};
  }
  const uniqueNames = [...new Set(englishNames)];
  console.log(`🌐 トピック名を日本語訳中 (${uniqueNames.length}件)...`);

  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${OPENAI_API_KEY}`,
    },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content:
            "あなたは学術用語の翻訳者です。英語の研究分野名を簡潔な日本語に翻訳してください。" +
            "JSON形式で {\"英語名\": \"日本語名\"} として返してください。余分なテキストは不要です。",
        },
        {
          role: "user",
          content: JSON.stringify(uniqueNames),
        },
      ],
      response_format: { type: "json_object" },
      temperature: 0.2,
    }),
  });

  if (!res.ok) {
    console.warn(`  翻訳APIエラー: ${res.status}`);
    return {};
  }
  const data = (await res.json()) as { choices: Array<{ message: { content: string } }> };
  const parsed = JSON.parse(data.choices[0].message.content ?? "{}") as Record<string, string>;
  console.log(`  ✓ ${Object.keys(parsed).length}件翻訳完了`);
  return parsed;
}

function toResearcher(author: OpenAlexAuthor, translationMap: Record<string, string>) {
  const topTopics = author.topics.slice(0, 5);
  const field = topTopics[0]?.field.display_name ?? "General Research";
  const institution = author.last_known_institutions[0]?.display_name ?? "Unknown";

  const topicNames = topTopics.map((t) => t.display_name).join(", ");
  const abstract = `${topicNames} に関する研究を行っている。論文数: ${author.works_count}件、被引用数: ${author.cited_by_count}件。`;
  const keywords = topTopics.map((t) => t.display_name);

  const field_ja = translationMap[field] ?? field;
  const topicNames_ja = topTopics.map((t) => translationMap[t.display_name] ?? t.display_name).join("、");
  const abstract_ja = `${topicNames_ja} に関する研究を行っている。論文数: ${author.works_count}件、被引用数: ${author.cited_by_count}件。`;
  const keywords_ja = topTopics.map((t) => translationMap[t.display_name] ?? t.display_name);

  return {
    id: author.id.replace("https://openalex.org/", ""),
    name: author.display_name,
    affiliation: institution,
    field,
    abstract,
    keywords,
    field_ja,
    abstract_ja,
    keywords_ja,
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
const filtered = authors.filter(
  (a) => a.last_known_institutions.length > 0 && a.topics.length > 0
);

const allTopicNames = filtered.flatMap((a) => [
  ...a.topics.slice(0, 5).map((t) => t.display_name),
  ...a.topics.slice(0, 1).map((t) => t.field.display_name),
]);
const translationMap = await translateTopics(allTopicNames);

const researchers = filtered.map((a) => toResearcher(a, translationMap));
console.log(`Transformed ${researchers.length} researchers`);

const result = await ingest(researchers);
console.log("Ingest result:", result);
