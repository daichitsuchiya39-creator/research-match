# ResearchMatch — 研究者×企業マッチング MVP

企業の課題・ニーズをテキスト入力すると、セマンティック検索でマッチする研究者を返すシステム。

## Tech Stack

- **API**: Hono (TypeScript) + @hono/node-server
- **Vector DB**: Qdrant (Docker)
- **Embedding**: OpenAI text-embedding-3-small
- **Frontend**: Vanilla HTML/CSS/JS

## セットアップ

### 1. 環境変数
```bash
cp .env.example api/.env
# api/.env の OPENAI_API_KEY を設定
```

### 2. Qdrant 起動
```bash
docker-compose up -d
```

### 3. API サーバー起動
```bash
cd api
npm install
npm run dev
```

### 4. サンプルデータ投入
```bash
cd scripts
node --experimental-strip-types ingest.ts
```

### 5. フロントエンド
```bash
# frontend/index.html をブラウザで開く
open frontend/index.html
```

## API エンドポイント

| Method | Path | 説明 |
|--------|------|------|
| GET | / | ヘルスチェック |
| POST | /ingest | 研究者データ投入 |
| POST | /search | セマンティック検索 |

### 検索リクエスト例
```json
POST /search
{ "query": "AI・機械学習を活用した製造業の品質管理システムを開発したい", "limit": 5 }
```
