import OpenAI from "openai";

const globalForOpenAI = globalThis as unknown as {
  openai: OpenAI | undefined;
};

export const openai =
  globalForOpenAI.openai ??
  new OpenAI({
    apiKey: process.env.OPENAI_API_KEY || "sk-placeholder",
  });

if (process.env.NODE_ENV !== "production") globalForOpenAI.openai = openai;

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
  if (!process.env.OPENAI_API_KEY) {
    return getMockNormalization(rawData.title);
  }

  try {
    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content: `You are a product data normalization expert. Extract and normalize product information from raw product data. Return valid JSON only.`,
        },
        {
          role: "user",
          content: `Normalize this product data and return JSON:
Title: ${rawData.title}
Description: ${rawData.description || "N/A"}
Specs: ${rawData.specifications || "N/A"}

Return JSON with: name, brand, model, category, specifications (object), searchTerms (array of 3-5 search queries to find this product on other stores)`,
        },
      ],
      response_format: { type: "json_object" },
      max_tokens: 500,
    });

    const content = response.choices[0]?.message?.content;
    if (!content) throw new Error("Empty response");

    return JSON.parse(content) as NormalizedProduct;
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
  if (!process.env.OPENAI_API_KEY) {
    return candidates.map((c) => ({
      store: c.store,
      confidence: 85,
      matched: true,
    }));
  }

  try {
    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content: "You are a product matching expert. Determine if products are identical across different stores.",
        },
        {
          role: "user",
          content: `Base product: ${JSON.stringify(baseProduct)}

Candidates:
${candidates.map((c, i) => `${i + 1}. Store: ${c.store}, Title: ${c.title}`).join("\n")}

Return JSON array with { store, confidence (0-100), matched (boolean) } for each candidate.`,
        },
      ],
      response_format: { type: "json_object" },
      max_tokens: 300,
    });

    const content = response.choices[0]?.message?.content;
    if (!content) throw new Error("Empty response");

    const result = JSON.parse(content) as { results?: Array<{ store: string; confidence: number; matched: boolean }> };
    return result.results || candidates.map((c) => ({ store: c.store, confidence: 75, matched: true }));
  } catch {
    return candidates.map((c) => ({ store: c.store, confidence: 75, matched: true }));
  }
}

export async function summarizeReviews(reviews: string[]): Promise<string> {
  if (!process.env.OPENAI_API_KEY || reviews.length === 0) {
    return "Reviews indicate generally positive user experience with good value for money.";
  }

  try {
    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content: "Summarize product reviews in 2-3 sentences highlighting key pros and cons.",
        },
        {
          role: "user",
          content: `Reviews:\n${reviews.slice(0, 10).join("\n---\n")}`,
        },
      ],
      max_tokens: 150,
    });

    return response.choices[0]?.message?.content || "Unable to summarize reviews.";
  } catch {
    return "Reviews indicate generally positive user experience.";
  }
}
