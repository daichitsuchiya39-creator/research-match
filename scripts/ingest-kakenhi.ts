/**
 * NRID（国立情報学研究所）研究者一括ダウンロードCSVをResearchMatchに投入
 *
 * 事前準備:
 *   1. https://nrid.nii.ac.jp/ja/download/ から研究者情報CSVをダウンロード（UTF-8指定）
 *   2. APIサーバーを起動済みであること
 *
 * Usage:
 *   API_URL=https://research-match-production.up.railway.app \
 *   OPENAI_API_KEY=sk-... \
 *   node --experimental-strip-types scripts/ingest-kakenhi.ts ./kakenhi.csv
 *
 * ローカルテスト:
 *   API_URL=http://localhost:3001 node --experimental-strip-types scripts/ingest-kakenhi.ts ./kakenhi.csv
 */
export {};

import { readFileSync } from "fs";
import { parse } from "csv-parse/sync";

const API_URL = process.env.API_URL ?? "http://localhost:3001";
const CSV_PATH = process.argv[2];

if (!CSV_PATH) {
  console.error("Usage: node --experimental-strip-types scripts/ingest-kakenhi.ts <path/to/kakenhi.csv>");
  process.exit(1);
}

// --- 型定義 ---

interface KakenhiRow {
  researcher_number: string;  // 研究者番号
  name: string;               // 氏名
  affiliation: string;        // 所属機関名
  field: string;              // 研究分野
  keywords: string;           // キーワード（区切り文字はCSVによる）
  abstract: string;           // 研究概要
  year: number;               // 年度（dedup用）
}

interface Researcher {
  id: string;
  name: string;
  affiliation: string;
  field: string;
  abstract: string;
  keywords: string[];
  source: "kakenhi";
}

// --- CSVカラム検出 ---
// NRIDのCSVはダウンロード種別によってヘッダー名が多少異なるため、
// 候補リストから動的にマッチングする

type ColMap = {
  researcher_number: string | null;
  name: string | null;
  affiliation: string | null;
  field: string | null;
  keywords: string | null;
  abstract: string | null;
  year: string | null;
};

const COL_CANDIDATES: Record<keyof ColMap, string[]> = {
  researcher_number: ["研究者番号", "researcher_number", "nrid"],
  name:              ["氏名", "name", "研究代表者", "研究者名"],
  affiliation:       ["所属機関名", "affiliation", "所属", "機関名", "所属機関・部局"],
  field:             ["研究分野", "field", "分科", "研究領域", "細目"],
  keywords:          ["キーワード", "keywords", "研究キーワード"],
  abstract:          ["研究概要", "abstract", "研究内容", "研究の概要"],
  year:              ["年度", "year", "開始年度", "採択年度"],
};

function detectColumns(headers: string[]): ColMap {
  const normalized = headers.map((h) => h.trim());
  const result = {} as ColMap;
  for (const [key, candidates] of Object.entries(COL_CANDIDATES)) {
    result[key as keyof ColMap] = candidates.find((c) => normalized.includes(c)) ?? null;
  }
  return result;
}

// --- CSVパース ---

function parseKakenhiCsv(csvPath: string): KakenhiRow[] {
  const content = readFileSync(csvPath, "utf-8");

  const records = parse(content, {
    columns: true,       // 1行目をヘッダーとして使用
    skip_empty_lines: true,
    trim: true,
    relax_quotes: true,
    relax_column_count: true,
  }) as Record<string, string>[];

  if (records.length === 0) {
    console.error("CSVにレコードが見つかりません");
    process.exit(1);
  }

  const headers = Object.keys(records[0]);
  const cols = detectColumns(headers);

  console.log("検出したカラムマッピング:");
  for (const [key, col] of Object.entries(cols)) {
    console.log(`  ${key}: ${col ?? "（未検出）"}`);
  }

  if (!cols.researcher_number || !cols.name) {
    console.error("\n研究者番号または氏名のカラムが検出できませんでした。");
    console.log("利用可能なカラム:", headers.join(", "));
    process.exit(1);
  }

  return records
    .map((row): KakenhiRow | null => {
      const num = cols.researcher_number ? row[cols.researcher_number]?.trim() : "";
      const name = cols.name ? row[cols.name]?.trim() : "";
      if (!num || !name) return null;

      return {
        researcher_number: num,
        name,
        affiliation: cols.affiliation ? row[cols.affiliation]?.trim() ?? "" : "",
        field:       cols.field      ? row[cols.field]?.trim()      ?? "" : "",
        keywords:    cols.keywords   ? row[cols.keywords]?.trim()   ?? "" : "",
        abstract:    cols.abstract   ? row[cols.abstract]?.trim()   ?? "" : "",
        year:        cols.year       ? parseInt(row[cols.year] ?? "0", 10) : 0,
      };
    })
    .filter((r): r is KakenhiRow => r !== null);
}

// --- 研究者番号でdedup（最新年度を優先）---

function dedupByResearcher(rows: KakenhiRow[]): KakenhiRow[] {
  const map = new Map<string, KakenhiRow>();
  for (const row of rows) {
    const existing = map.get(row.researcher_number);
    if (!existing || row.year > existing.year) {
      map.set(row.researcher_number, row);
    }
  }
  return [...map.values()];
}

// --- Researcherオブジェクトに変換 ---

function toResearcher(row: KakenhiRow): Researcher {
  const keywords = row.keywords
    .split(/[,、，;；\s]+/)
    .map((k) => k.trim())
    .filter(Boolean)
    .slice(0, 10);

  // abstractが空の場合はフィールドとキーワードから生成
  const abstract =
    row.abstract ||
    [row.field, keywords.join("、")].filter(Boolean).join(" / ") ||
    "研究概要なし";

  return {
    id: `K${row.researcher_number}`,
    name: row.name,
    affiliation: row.affiliation || "所属不明",
    field: row.field || "研究分野不明",
    abstract,
    keywords,
    source: "kakenhi",
  };
}

// --- バッチ投入（bulk-ingest.tsと同パターン）---

const BATCH_SIZE = 50;

async function ingestBatch(batch: Researcher[], label: string): Promise<number> {
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

      const result = (await res.json()) as { ingested: number };
      return result.ingested;
    } catch (e) {
      console.warn(`  ${label} 失敗 (試行${attempt}): ${(e as Error).message}`);
      if (attempt < 3) await new Promise((r) => setTimeout(r, 5000 * attempt));
    }
  }
  console.error(`  ${label} をスキップ（3回失敗）`);
  return 0;
}

// --- main ---

console.log("=== ResearchMatch Kakenhi Ingest ===");
console.log(`API: ${API_URL}`);
console.log(`CSV: ${CSV_PATH}\n`);

// 1. CSVパース
const rawRows = parseKakenhiCsv(CSV_PATH);
console.log(`\n読み込み: ${rawRows.length} 件`);

// 2. dedup
const dedupedRows = dedupByResearcher(rawRows);
console.log(`dedup後:  ${dedupedRows.length} 件（研究者番号でユニーク）`);

// 3. Researcherオブジェクトに変換
const researchers = dedupedRows.map(toResearcher);

// 4. バッチ投入
console.log("\n投入中...\n");
let totalIngested = 0;

for (let i = 0; i < researchers.length; i += BATCH_SIZE) {
  const batch = researchers.slice(i, i + BATCH_SIZE);
  const label = `バッチ ${i + 1}-${i + batch.length}`;
  const ingested = await ingestBatch(batch, label);
  totalIngested += ingested;
  console.log(`  ${label}: ${ingested} 件投入 (累計 ${totalIngested})`);
  await new Promise((r) => setTimeout(r, 1000));
}

console.log(`\n✅ 完了: 合計 ${totalIngested} 件を投入 (source: kakenhi)`);
