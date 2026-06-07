import axios from "axios";
import * as cheerio from "cheerio";

export interface ScrapedProduct {
  title: string;
  price: number;
  originalPrice?: number;
  currency: string;
  imageUrl?: string;
  description?: string;
  specifications?: string;
  rating?: number;
  reviewCount?: number;
  brand?: string;
  inStock: boolean;
  storeUrl: string;
}

const USER_AGENTS = [
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
];

function getRandomUA(): string {
  return USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
}

export function detectStore(url: string): string {
  const urlLower = url.toLowerCase();
  if (urlLower.includes("amazon.in") || urlLower.includes("amazon.com")) return "amazon";
  if (urlLower.includes("flipkart.com")) return "flipkart";
  if (urlLower.includes("myntra.com")) return "myntra";
  if (urlLower.includes("ajio.com")) return "ajio";
  if (urlLower.includes("nykaa.com")) return "nykaa";
  if (urlLower.includes("meesho.com")) return "meesho";
  if (urlLower.includes("croma.com")) return "croma";
  if (urlLower.includes("reliancedigital.in")) return "reliance";
  if (urlLower.includes("tatacliq.com")) return "tatacliq";
  return "unknown";
}

export async function scrapeProduct(url: string): Promise<ScrapedProduct> {
  const store = detectStore(url);

  // Return mock data for demo purposes (real scraping requires proxies/APIs)
  return getMockProductData(url, store);
}

function getMockProductData(url: string, store: string): ScrapedProduct {
  const mockProducts: Record<string, ScrapedProduct> = {
    amazon: {
      title: "Apple iPhone 15 (128 GB) - Black",
      price: 69900,
      originalPrice: 79900,
      currency: "INR",
      imageUrl: "https://images.unsplash.com/photo-1695048133142-1a20484d2569?w=400",
      description: "The latest iPhone 15 with Dynamic Island, 48MP camera, and USB-C charging.",
      specifications: "Display: 6.1-inch Super Retina XDR | Chip: A16 Bionic | Camera: 48MP Main | Battery: Up to 20 hours | Storage: 128GB",
      rating: 4.5,
      reviewCount: 12847,
      brand: "Apple",
      inStock: true,
      storeUrl: url,
    },
    flipkart: {
      title: "Apple iPhone 15 128GB Black",
      price: 67999,
      originalPrice: 79900,
      currency: "INR",
      imageUrl: "https://images.unsplash.com/photo-1695048133142-1a20484d2569?w=400",
      description: "iPhone 15 with A16 Bionic chip and 48MP camera system.",
      rating: 4.4,
      reviewCount: 8923,
      brand: "Apple",
      inStock: true,
      storeUrl: url,
    },
    croma: {
      title: "Apple iPhone 15 128GB - Black",
      price: 71990,
      originalPrice: 79900,
      currency: "INR",
      imageUrl: "https://images.unsplash.com/photo-1695048133142-1a20484d2569?w=400",
      rating: 4.3,
      brand: "Apple",
      inStock: true,
      storeUrl: url,
    },
    myntra: {
      title: "iPhone 15 128GB Black Smartphone",
      price: 68900,
      currency: "INR",
      rating: 4.2,
      brand: "Apple",
      inStock: false,
      storeUrl: url,
    },
  };

  return (
    mockProducts[store] || {
      title: "Product from " + store,
      price: 49999,
      currency: "INR",
      brand: "Unknown",
      inStock: true,
      storeUrl: url,
    }
  );
}

export async function fetchProductFromHtml(url: string): Promise<ScrapedProduct | null> {
  try {
    const response = await axios.get(url, {
      headers: {
        "User-Agent": getRandomUA(),
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.5",
        "Accept-Encoding": "gzip, deflate, br",
        Connection: "keep-alive",
      },
      timeout: 10000,
    });

    const $ = cheerio.load(response.data as string);
    const store = detectStore(url);

    if (store === "amazon") return scrapeAmazon($, url);
    if (store === "flipkart") return scrapeFlipkart($, url);

    return null;
  } catch {
    return null;
  }
}

function scrapeAmazon($: ReturnType<typeof cheerio.load>, url: string): ScrapedProduct {
  const title = $("#productTitle").text().trim();
  const priceStr = $(".a-price-whole").first().text().replace(/[^0-9]/g, "");
  const price = parseInt(priceStr) || 0;
  const imageUrl = $("#landingImage").attr("src") || "";
  const rating = parseFloat($(".a-icon-alt").first().text()) || 0;
  const reviewCountStr = $("#acrCustomerReviewText").text().replace(/[^0-9]/g, "");
  const reviewCount = parseInt(reviewCountStr) || 0;
  const brand = $("#bylineInfo").text().replace("Brand:", "").trim();
  const inStock = !$("#outOfStock").length;

  return {
    title: title || "Amazon Product",
    price,
    currency: "INR",
    imageUrl,
    rating,
    reviewCount,
    brand,
    inStock,
    storeUrl: url,
  };
}

function scrapeFlipkart($: ReturnType<typeof cheerio.load>, url: string): ScrapedProduct {
  const title = $("h1.yhB1nd, .B_NuCI").text().trim();
  const priceStr = $("._30jeq3").first().text().replace(/[^0-9]/g, "");
  const price = parseInt(priceStr) || 0;
  const imageUrl = $("._396cs4._2amPTt").attr("src") || $("img._396cs4").attr("src") || "";
  const ratingStr = $("._3LWZlK").first().text();
  const rating = parseFloat(ratingStr) || 0;

  return {
    title: title || "Flipkart Product",
    price,
    currency: "INR",
    imageUrl,
    rating,
    inStock: true,
    storeUrl: url,
  };
}
