/**
 * NRID (NII研究者情報) API から日本人研究者を取得してResearchMatchに投入
 *
 * NRIDのOpenSearch APIは研究者名・所属機関名で検索できる（研究分野検索は非対応）。
 * 主要な日本の研究機関名でスキャンして研究者を網羅的に取得する。
 *
 * 事前準備:
 *   CINII_APPID: https://api.ci.nii.ac.jp/ で取得したAppID
 *
 * Usage:
 *   API_URL=https://research-match-production.up.railway.app \
 *   CINII_APPID=your_appid \
 *   node --experimental-strip-types scripts/fetch-cinii.ts
 *
 * 動作確認（最初の1件のみ表示して終了）:
 *   CINII_APPID=your_appid \
 *   node --experimental-strip-types scripts/fetch-cinii.ts --dry-run
 */
export {};

const API_URL = process.env.API_URL ?? "http://localhost:3001";
const CINII_APPID = process.env.CINII_APPID ?? "";
const DRY_RUN = process.argv.includes("--dry-run");
const BASE_URL = "https://nrid.nii.ac.jp/opensearch/";

if (!CINII_APPID) {
  console.error("❌ CINII_APPID が未設定です。https://api.ci.nii.ac.jp/ で取得してください。");
  process.exit(1);
}

// NRIDの q= パラメーターは「研究者名・所属機関名」のみ検索するため
// 主要な研究機関名でスキャンして網羅的に研究者を取得する
const INSTITUTIONS = [
  // 旧帝国大学・総合大学
  "東京大学", "京都大学", "大阪大学", "東北大学", "名古屋大学",
  "北海道大学", "九州大学", "筑波大学", "一橋大学",
  // 工学系
  "東京工業大学", "東京科学大学", "早稲田大学", "慶應義塾大学",
  "東京理科大学", "芝浦工業大学",
  // 医学系
  "東京医科歯科大学", "順天堂大学", "慶應義塾大学病院",
  // 地方国立大学
  "神戸大学", "広島大学", "岡山大学", "千葉大学", "金沢大学",
  "新潟大学", "熊本大学", "長崎大学", "鹿児島大学", "琉球大学",
  "埼玉大学", "静岡大学", "信州大学", "山形大学", "福島大学",
  // 研究機関
  "理化学研究所", "産業技術総合研究所", "物質材料研究機構",
  "国立情報学研究所", "宇宙航空研究開発機構", "海洋研究開発機構",
  "国立環境研究所", "医薬基盤健康栄養研究所",
];

interface Researcher {
  id: string;
  name: string;
  affiliation: string;
  field: string;
  abstract: string;
  keywords: string[];
  source: "kakenhi";
}

// --- NRID APIレスポンス型 ---
interface NRIDResearcher {
  id?: string;
  "@id"?: string;
  url?: string;
  name?: string | Array<{ lang?: string; value?: string }>;
  affiliation?: string | Array<{ name?: string }>;
  field?: string | string[];
  keywords?: string | string[];
  description?: string;
  researcherNumber?: string;
}

interface NRIDResponse {
  totalResults?: string | number;
  researchers?: NRIDResearcher[];
  [key: string]: unknown;
}

// --- API呼び出し ---

async function searchResearchers(
  query: string,
  start: number,
  count: number
): Promise<{ total: number; researchers: NRIDResearcher[]; data: NRIDResponse }> {
  const url = new URL(BASE_URL);
  url.searchParams.set("q", query);
  url.searchParams.set("appid", CINII_APPID);
  url.searchParams.set("format", "json");
  url.searchParams.set("count", String(count));
  url.searchParams.set("start", String(start));

  const res = await fetch(url.toString(), {
    headers: { Accept: "application/json" },
  });

  if (!res.ok) throw new Error(`HTTP ${res.status}`);

  const text = await res.text();

  // HTMLが返ってきた場合（appid未登録など）
  if (text.trimStart().startsWith("<")) {
    throw new Error("JSONではなくHTMLが返されました。AppIDが有効か確認してください。");
  }

  const data = JSON.parse(text) as NRIDResponse;
  const total = Number(data.totalResults ?? 0);
  const researchers = Array.isArray(data.researchers) ? data.researchers : [];

  return { total, researchers, data };
}

// --- 変換 ---

function toStr(v: unknown): string {
  if (!v) return "";
  if (typeof v === "string") return v.trim();
  if (Array.isArray(v)) {
    // 言語タグ付き配列の場合は日本語優先
    const ja = (v as Array<{ lang?: string; value?: string }>).find(x => x.lang === "ja");
    const first = (v as Array<{ lang?: string; value?: string }>)[0];
    return (ja ?? first)?.value ?? v.map(toStr).join("、");
  }
  if (typeof v === "object") {
    const o = v as Record<string, unknown>;
    return toStr(o.value ?? o.name ?? o["#text"] ?? "");
  }
  return String(v);
}

function extractId(r: NRIDResearcher): string {
  const raw = r.researcherNumber ?? r["@id"] ?? r.id ?? r.url ?? "";
  const m = String(raw).match(/(\d{8,})/);
  return m ? `N${m[1]}` : `NRID_${String(raw).slice(-10).replace(/\W/g, "_")}`;
}

function toResearcher(r: NRIDResearcher, institution: string): Researcher | null {
  const name = toStr(r.name);
  if (!name) return null;

  const id = extractId(r);

  const affRaw = r.affiliation;
  const affiliation = Array.isArray(affRaw)
    ? toStr((affRaw as Array<{ name?: string }>)[0]?.name ?? affRaw[0])
    : toStr(affRaw) || institution;

  const field = toStr(r.field) || "研究分野不明";

  const rawKw = r.keywords;
  const keywords: string[] = Array.isArray(rawKw)
    ? rawKw.map(toStr).filter(Boolean)
    : toStr(rawKw).split(/[,、，;；]/).map(s => s.trim()).filter(Boolean);
  if (keywords.length === 0) keywords.push(field);

  const abstract = toStr(r.description)
    || [field, keywords.slice(0, 3).join("・")].filter(Boolean).join("の研究者。キーワード: ")
    || `${affiliation}の研究者`;

  return {
    id,
    name,
    affiliation,
    field,
    abstract: abstract.slice(0, 500),
    keywords: keywords.slice(0, 10),
    source: "kakenhi",
  };
}

// --- バッチ投入 ---

async function ingestBatch(batch: Researcher[], label: string): Promise<number> {
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await fetch(`${API_URL}/ingest`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(batch),
      });
      if (!res.ok) {
        await new Promise(r => setTimeout(r, 3000 * attempt));
        continue;
      }
      return ((await res.json()) as { ingested: number }).ingested;
    } catch {
      if (attempt < 3) await new Promise(r => setTimeout(r, 5000 * attempt));
    }
  }
  console.error(`  ${label} をスキップ（3回失敗）`);
  return 0;
}

// --- main ---

console.log("=== ResearchMatch NRID (CiNii) Fetch & Ingest ===");
console.log(`API: ${API_URL}`);
console.log(`NRID: ${BASE_URL}`);
console.log(`機関数: ${INSTITUTIONS.length}`);
if (DRY_RUN) console.log("⚠ --dry-run: 最初の機関のレスポンスを表示して終了\n");
else console.log();

// dry-run: 1機関だけ取得して構造確認
if (DRY_RUN) {
  try {
    const { total, researchers, data } = await searchResearchers(INSTITUTIONS[0], 1, 3);
    console.log(`機関: ${INSTITUTIONS[0]}`);
    console.log(`totalResults: ${total}`);
    console.log(`取得件数: ${researchers.length}`);
    console.log("\n生レスポンス(先頭500文字):", JSON.stringify(data).slice(0, 500));
    if (researchers.length > 0) {
      console.log("\n最初のresearcherキー:", Object.keys(researchers[0]));
      console.log("最初のresearcher:", JSON.stringify(researchers[0], null, 2));
      const converted = toResearcher(researchers[0], INSTITUTIONS[0]);
      console.log("\n変換後Researcher:", JSON.stringify(converted, null, 2));
    }
  } catch (e) {
    console.error("エラー:", (e as Error).message);
  }
  process.exit(0);
}

// 本番実行
const seenIds = new Set<string>();
const allResearchers: Researcher[] = [];

for (const institution of INSTITUTIONS) {
  process.stdout.write(`[${institution}] `);

  try {
    const { total, researchers: first } = await searchResearchers(institution, 1, 200);
    process.stdout.write(`${total}件`);

    const all = [...first];

    // 最大1000件まで取得
    for (let start = 201; start <= Math.min(total, 1000); start += 200) {
      await new Promise(r => setTimeout(r, 500));
      const { researchers } = await searchResearchers(institution, start, 200);
      all.push(...researchers);
    }

    let added = 0;
    for (const r of all) {
      const researcher = toResearcher(r, institution);
      if (!researcher || seenIds.has(researcher.id)) continue;
      seenIds.add(researcher.id);
      allResearchers.push(researcher);
      added++;
    }
    console.log(` → ${added}件追加`);
  } catch (e) {
    console.log(` ⚠ ${(e as Error).message}`);
  }

  await new Promise(r => setTimeout(r, 500));
}

console.log(`\n重複除外後 合計: ${allResearchers.length} 件`);
if (allResearchers.length === 0) {
  console.error("データがありません。--dry-run で動作確認してください。");
  process.exit(1);
}

console.log("\n投入中...\n");
let totalIngested = 0;
const BATCH_SIZE = 50;

for (let i = 0; i < allResearchers.length; i += BATCH_SIZE) {
  const batch = allResearchers.slice(i, i + BATCH_SIZE);
  const label = `バッチ ${i + 1}-${i + batch.length}`;
  const ingested = await ingestBatch(batch, label);
  totalIngested += ingested;
  console.log(`  ${label}: ${ingested}件投入 (累計 ${totalIngested})`);
  await new Promise(r => setTimeout(r, 1000));
}

console.log(`\n✅ 完了: ${totalIngested}件投入 (source: kakenhi)`);
