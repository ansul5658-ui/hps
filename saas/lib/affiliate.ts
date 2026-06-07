export interface AffiliateConfig {
  store: string;
  affiliateTag?: string;
  baseUrl: string;
  commissionRate: number;
}

const AFFILIATE_CONFIGS: Record<string, AffiliateConfig> = {
  amazon: {
    store: "amazon",
    affiliateTag: process.env.AMAZON_AFFILIATE_TAG || "priceradar-21",
    baseUrl: "https://www.amazon.in",
    commissionRate: 4.0,
  },
  flipkart: {
    store: "flipkart",
    affiliateTag: process.env.FLIPKART_AFFILIATE_ID || "priceradar_fk",
    baseUrl: "https://www.flipkart.com",
    commissionRate: 6.0,
  },
  myntra: {
    store: "myntra",
    baseUrl: "https://www.myntra.com",
    commissionRate: 8.0,
  },
  ajio: {
    store: "ajio",
    baseUrl: "https://www.ajio.com",
    commissionRate: 7.5,
  },
  nykaa: {
    store: "nykaa",
    baseUrl: "https://www.nykaa.com",
    commissionRate: 5.0,
  },
  meesho: {
    store: "meesho",
    baseUrl: "https://www.meesho.com",
    commissionRate: 12.0,
  },
  croma: {
    store: "croma",
    baseUrl: "https://www.croma.com",
    commissionRate: 2.5,
  },
  reliance: {
    store: "reliance",
    baseUrl: "https://www.reliancedigital.in",
    commissionRate: 3.0,
  },
  tatacliq: {
    store: "tatacliq",
    baseUrl: "https://www.tatacliq.com",
    commissionRate: 5.0,
  },
};

export function generateAffiliateUrl(originalUrl: string, store: string): string {
  const config = AFFILIATE_CONFIGS[store];
  if (!config) return originalUrl;

  try {
    const url = new URL(originalUrl);

    if (store === "amazon" && config.affiliateTag) {
      url.searchParams.set("tag", config.affiliateTag);
      url.searchParams.set("linkCode", "ll1");
      url.searchParams.set("linkId", generateTrackingId());
      return url.toString();
    }

    if (store === "flipkart" && config.affiliateTag) {
      url.searchParams.set("affid", config.affiliateTag);
      url.searchParams.set("affExtParam1", generateTrackingId());
      return url.toString();
    }

    // Generic affiliate tracking
    url.searchParams.set("utm_source", "priceradar");
    url.searchParams.set("utm_medium", "affiliate");
    url.searchParams.set("utm_campaign", "comparison");
    return url.toString();
  } catch {
    return originalUrl;
  }
}

export function getStoreConfig(store: string): AffiliateConfig | null {
  return AFFILIATE_CONFIGS[store] || null;
}

export function getAllStoreConfigs(): AffiliateConfig[] {
  return Object.values(AFFILIATE_CONFIGS);
}

function generateTrackingId(): string {
  return Math.random().toString(36).substring(2, 15);
}

export function generateTrackingUrl(trackingCode: string): string {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
  return `${appUrl}/api/track/${trackingCode}`;
}
