/**
 * OpenAlex から複数分野の日本在籍研究者を大量取得して一括投入
 * Usage: API_URL=https://... OPENAI_API_KEY=sk-... node --experimental-strip-types scripts/bulk-ingest.ts
 */
export {};

const API_URL = process.env.API_URL ?? "http://localhost:3001";
const OPENAI_API_KEY = process.env.OPENAI_API_KEY ?? "";
const MAILTO = "research-match@chiapuru.com";
const PER_PAGE = 200; // OpenAlex max
const MAX_PAGES = 2; // 各トピック最大2ページ（最大400件）

// OpenAlex topic IDs で分野別に研究者を絞り込む
const TOPICS = [
  // AI・情報工学
  { id: "T12072", label: "Machine Learning" },
  { id: "T10036", label: "Neural Networks / Computer Vision" },
  { id: "T10181", label: "Natural Language Processing" },
  { id: "T10191", label: "Robotics" },
  { id: "T10586", label: "Robotic Path Planning" },
  { id: "T10571", label: "Robotic Mechanisms" },
  { id: "T10734", label: "Information Security" },
  { id: "T10682", label: "Quantum Computing" },
  { id: "T11159", label: "Manufacturing Optimization" },
  { id: "T11948", label: "ML in Materials Science" },
  { id: "T12254", label: "ML in Bioinformatics" },
  { id: "T10530", label: "Data Mining" },
  { id: "T10068", label: "Human-Computer Interaction" },
  { id: "T10412", label: "Internet of Things" },
  { id: "T10623", label: "Edge Computing" },
  // 材料・エネルギー
  { id: "T10472", label: "Semiconductor Materials" },
  { id: "T11007", label: "Renewable Energy" },
  { id: "T10018", label: "Battery Materials" },
  { id: "T10179", label: "Supercapacitor Materials" },
  { id: "T10253", label: "Photovoltaic Solar Energy" },
  { id: "T10287", label: "Hydrogen Energy" },
  { id: "T10614", label: "Polymer Materials" },
  { id: "T10354", label: "Nanomaterials" },
  { id: "T10258", label: "Catalysis" },
  { id: "T10138", label: "Carbon Capture" },
  // 生命科学・医療
  { id: "T10211", label: "Drug Discovery" },
  { id: "T10387", label: "Cancer Research" },
  { id: "T10423", label: "Immunology" },
  { id: "T10166", label: "Genomics" },
  { id: "T10294", label: "Protein Structure" },
  { id: "T10446", label: "Neuroscience" },
  { id: "T10102", label: "Regenerative Medicine" },
  { id: "T10391", label: "Medical Imaging" },
  { id: "T10271", label: "Epidemiology" },
  { id: "T10518", label: "Microbiome" },
  // 農業・環境
  { id: "T10616", label: "Smart Agriculture" },
  { id: "T13711", label: "Environmental Science" },
  { id: "T10498", label: "Food Science" },
  { id: "T10344", label: "Ecology" },
  { id: "T10539", label: "Water Treatment" },
  // 社会科学・経済
  { id: "T10315", label: "Behavioral Economics" },
  { id: "T10591", label: "Public Policy" },
  { id: "T10462", label: "Urban Planning" },
  { id: "T10576", label: "Education Technology" },
  // 建設・交通
  { id: "T13031", label: "Civil Engineering" },
  { id: "T10482", label: "Autonomous Vehicles" },
  { id: "T10360", label: "Structural Engineering" },
  { id: "T10299", label: "Transportation Engineering" },
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

// OpenAI API を fetch で直接呼び出してトピック名を日本語訳する
async function translateTopics(englishNames: string[]): Promise<Record<string, string>> {
  if (!OPENAI_API_KEY) {
    console.warn("⚠ OPENAI_API_KEY未設定のため翻訳をスキップ（英語のまま投入）");
    return {};
  }
  const uniqueNames = [...new Set(englishNames)];
  console.log(`\n🌐 トピック名を日本語訳中 (${uniqueNames.length}件)...`);

  // 100件ずつバッチ処理（プロンプトが長くなりすぎないように）
  const TRANSLATE_BATCH = 100;
  const translationMap: Record<string, string> = {};

  for (let i = 0; i < uniqueNames.length; i += TRANSLATE_BATCH) {
    const batch = uniqueNames.slice(i, i + TRANSLATE_BATCH);
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
            content: JSON.stringify(batch),
          },
        ],
        response_format: { type: "json_object" },
        temperature: 0.2,
      }),
    });

    if (!res.ok) {
      console.warn(`  翻訳APIエラー: ${res.status}`);
      continue;
    }
    const data = (await res.json()) as { choices: Array<{ message: { content: string } }> };
    const parsed = JSON.parse(data.choices[0].message.content ?? "{}") as Record<string, string>;
    Object.assign(translationMap, parsed);
  }

  console.log(`  ✓ ${Object.keys(translationMap).length}件翻訳完了`);
  return translationMap;
}

function toResearcher(author: OpenAlexAuthor, translationMap: Record<string, string>) {
  const topTopics = author.topics.slice(0, 5);
  const field = topTopics[0]?.field.display_name ?? "General Research";
  const institution = author.last_known_institutions[0]?.display_name ?? "Unknown";

  // 英語フィールド
  const topicNames = topTopics.map((t) => t.display_name).join(", ");
  const abstract = `${topicNames} に関する研究を行っている。論文数: ${author.works_count}件、被引用数: ${author.cited_by_count}件。`;
  const keywords = topTopics.map((t) => t.display_name);

  // 日本語フィールド（翻訳マップが空なら英語をそのまま使用）
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

async function fetchByTopic(topicId: string, label: string): Promise<OpenAlexAuthor[]> {
  const results: OpenAlexAuthor[] = [];

  for (let page = 1; page <= MAX_PAGES; page++) {
    const url = new URL("https://api.openalex.org/authors");
    url.searchParams.set(
      "filter",
      `last_known_institutions.country_code:JP,topics.id:${topicId}`
    );
    url.searchParams.set("per-page", String(PER_PAGE));
    url.searchParams.set("page", String(page));
    url.searchParams.set("sort", "cited_by_count:desc");
    url.searchParams.set("mailto", MAILTO);

    const res = await fetch(url.toString());
    if (!res.ok) {
      console.warn(`  ⚠ ${label} p${page}: HTTP ${res.status}`);
      break;
    }
    const data = (await res.json()) as { results: OpenAlexAuthor[]; meta: { count: number } };
    results.push(...data.results);

    if (page === 1) {
      console.log(`  ${label}: ${data.meta.count}件中 ${Math.min(data.meta.count, PER_PAGE * MAX_PAGES)}件取得予定`);
    }

    // 残りページがなければ終了
    if (data.results.length < PER_PAGE) break;
    await new Promise((r) => setTimeout(r, 300));
  }

  return results;
}

// --- main ---
console.log("=== ResearchMatch Bulk Ingest ===");
console.log(`API: ${API_URL}`);
console.log(`分野数: ${TOPICS.length}, 各最大 ${PER_PAGE * MAX_PAGES} 件\n`);

// 1. OpenAlexからデータ取得
const seenIds = new Set<string>();
const allAuthors: OpenAlexAuthor[] = [];

for (const topic of TOPICS) {
  const authors = await fetchByTopic(topic.id, topic.label);
  for (const a of authors) {
    if (!a.last_known_institutions.length || !a.topics.length) continue;
    if (seenIds.has(a.id)) continue;
    seenIds.add(a.id);
    allAuthors.push(a);
  }
  await new Promise((r) => setTimeout(r, 300));
}

console.log(`\n重複除外後: ${allAuthors.length} 件`);

// 2. トピック名を一括日本語訳
const allTopicNames = allAuthors.flatMap((a) => [
  ...a.topics.slice(0, 5).map((t) => t.display_name),
  ...a.topics.slice(0, 1).map((t) => t.field.display_name),
]);
const translationMap = await translateTopics(allTopicNames);

// 3. 研究者データに変換（日本語フィールド付き）
const allResearchers = allAuthors.map((a) => toResearcher(a, translationMap));

console.log("\n投入中...\n");

const BATCH_SIZE = 100;
let totalIngested = 0;

for (let i = 0; i < allResearchers.length; i += BATCH_SIZE) {
  const batch = allResearchers.slice(i, i + BATCH_SIZE);

  const res = await fetch(`${API_URL}/ingest`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(batch),
  });

  if (!res.ok) {
    console.error(`  バッチ ${i + 1}-${i + batch.length}: HTTP ${res.status}`);
    continue;
  }

  const result = (await res.json()) as { ingested: number };
  totalIngested += result.ingested;
  console.log(`  バッチ ${i + 1}-${i + batch.length}: ${result.ingested} 件投入 (累計 ${totalIngested})`);
  await new Promise((r) => setTimeout(r, 500));
}

console.log(`\n✅ 完了: 合計 ${totalIngested} 件を投入`);
