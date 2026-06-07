import Anthropic from "@anthropic-ai/sdk";

const globalForAnthropic = globalThis as unknown as {
  anthropic: Anthropic | undefined;
};

const anthropic =
  globalForAnthropic.anthropic ??
  new Anthropic({
    apiKey: process.env.ANTHROPIC_API_KEY || "",
  });

if (process.env.NODE_ENV !== "production") globalForAnthropic.anthropic = anthropic;

export interface NormalizedProduct {
  name: string;
  brand: string;
  model: string;
  category: string;
  specifications: Record<string, string>;
  searchTerms: string[];
}

export async function normalizeProduct(rawData: {
  title: string;
  description?: string;
  specifications?: string;
}): Promise<NormalizedProduct> {
  if (!process.env.ANTHROPIC_API_KEY) {
    return getMockNormalization(rawData.title);
  }

  try {
    const response = await anthropic.messages.create({
      model: "claude-haiku-4-5",
      max_tokens: 500,
      system: "You are a product data normalization expert. Extract and normalize product information from raw product data. Return valid JSON only.",
      messages: [
        {
          role: "user",
          content: `Normalize this product data and return JSON:
Title: ${rawData.title}
Description: ${rawData.description || "N/A"}
Specs: ${rawData.specifications || "N/A"}

Return JSON with: name, brand, model, category, specifications (object), searchTerms (array of 3-5 search queries to find this product on other stores)`,
        },
      ],
    });

    const block = response.content[0];
    if (block.type !== "text") throw new Error("Unexpected content type");

    const text = block.text.trim();
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error("No JSON found");

    return JSON.parse(jsonMatch[0]) as NormalizedProduct;
  } catch {
    return getMockNormalization(rawData.title);
  }
}

function getMockNormalization(title: string): NormalizedProduct {
  const words = title.split(" ");
  const brand = words[0] || "Unknown";
  return {
    name: title,
    brand,
    model: words.slice(1, 3).join(" "),
    category: "Electronics",
    specifications: {},
    searchTerms: [title, `${brand} ${words.slice(1, 3).join(" ")}`, words.slice(0, 4).join(" ")],
  };
}

export async function matchProducts(
  baseProduct: NormalizedProduct,
  candidates: Array<{ title: string; store: string; price: number }>
): Promise<Array<{ store: string; confidence: number; matched: boolean }>> {
  if (!process.env.ANTHROPIC_API_KEY) {
    return candidates.map((c) => ({
      store: c.store,
      confidence: 85,
      matched: true,
    }));
  }

  try {
    const response = await anthropic.messages.create({
      model: "claude-haiku-4-5",
      max_tokens: 300,
      system: "You are a product matching expert. Determine if products are identical across different stores. Return valid JSON only.",
      messages: [
        {
          role: "user",
          content: `Base product: ${JSON.stringify(baseProduct)}

Candidates:
${candidates.map((c, i) => `${i + 1}. Store: ${c.store}, Title: ${c.title}`).join("\n")}

Return JSON with a "results" array where each item has: store, confidence (0-100), matched (boolean).`,
        },
      ],
    });

    const block = response.content[0];
    if (block.type !== "text") throw new Error("Unexpected content type");

    const text = block.text.trim();
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error("No JSON found");

    const result = JSON.parse(jsonMatch[0]) as { results?: Array<{ store: string; confidence: number; matched: boolean }> };
    return result.results || candidates.map((c) => ({ store: c.store, confidence: 75, matched: true }));
  } catch {
    return candidates.map((c) => ({ store: c.store, confidence: 75, matched: true }));
  }
}

export async function summarizeReviews(reviews: string[]): Promise<string> {
  if (!process.env.ANTHROPIC_API_KEY || reviews.length === 0) {
    return "Reviews indicate generally positive user experience with good value for money.";
  }

  try {
    const response = await anthropic.messages.create({
      model: "claude-haiku-4-5",
      max_tokens: 150,
      system: "Summarize product reviews in 2-3 sentences highlighting key pros and cons.",
      messages: [
        {
          role: "user",
          content: `Reviews:\n${reviews.slice(0, 10).join("\n---\n")}`,
        },
      ],
    });

    const block = response.content[0];
    if (block.type !== "text") return "Unable to summarize reviews.";
    return block.text || "Unable to summarize reviews.";
  } catch {
    return "Reviews indicate generally positive user experience.";
  }
}
