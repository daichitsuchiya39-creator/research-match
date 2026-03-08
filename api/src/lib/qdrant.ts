import { QdrantClient } from "@qdrant/js-client-rest";

export const COLLECTION_NAME = process.env.QDRANT_COLLECTION ?? "researchers";
const VECTOR_SIZE = 1536; // text-embedding-3-small

export const qdrant = new QdrantClient({
  url: process.env.QDRANT_URL ?? "http://localhost:6333",
  ...(process.env.QDRANT_API_KEY ? { apiKey: process.env.QDRANT_API_KEY } : {}),
});

export async function ensureCollection() {
  const collections = await qdrant.getCollections();
  const exists = collections.collections.some((c) => c.name === COLLECTION_NAME);
  if (!exists) {
    await qdrant.createCollection(COLLECTION_NAME, {
      vectors: { size: VECTOR_SIZE, distance: "Cosine" },
    });
    console.log(`Collection "${COLLECTION_NAME}" created.`);
  }
}
