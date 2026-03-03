import { GoogleGenAI, Type, ThinkingLevel } from "@google/genai";
import { SentimentScore, PredictionResult, StockData, ChartAnalysisResult } from "../types";

// Use a safe way to access process.env in a browser environment
const getApiKey = () => {
  try {
    // API_KEY is the user-selected key from the dialog
    // GEMINI_API_KEY is the platform-provided free key
    return process.env.API_KEY || process.env.GEMINI_API_KEY || "";
  } catch (e) {
    console.warn("API keys are not accessible");
    return "";
  }
};

const getAIClient = () => {
  return new GoogleGenAI({ apiKey: getApiKey() });
};

// Helper for exponential backoff retries
async function withRetry<T>(fn: () => Promise<T>, retries = 7, delay = 3000): Promise<T> {
  try {
    return await fn();
  } catch (error: any) {
    const errorMsg = error.message || (typeof error === 'string' ? error : '');
    const errorStr = (errorMsg + ' ' + JSON.stringify(error)).toLowerCase();
    
    const isRateLimit = errorStr.includes('429') || errorStr.includes('resource_exhausted');
    const isRetryableError = 
      errorStr.includes('500') || 
      errorStr.includes('502') || 
      errorStr.includes('503') || 
      errorStr.includes('504') || 
      errorStr.includes('xhr error') || 
      errorStr.includes('internal error') || 
      errorStr.includes('unknown') ||
      errorStr.includes('failed to fetch') ||
      errorStr.includes('deadline_exceeded');
    
    if (retries > 0 && (isRateLimit || isRetryableError)) {
      const reason = isRateLimit ? 'Rate limit' : 'Transient server error';
      console.warn(`${reason} hit (${errorMsg || 'Unknown error'}). Retrying in ${delay}ms... (${retries} attempts left)`);
      await new Promise(resolve => setTimeout(resolve, delay));
      // Increase delay exponentially but capped at 30 seconds
      return withRetry(fn, retries - 1, Math.min(delay * 2, 30000));
    }
    throw error;
  }
}

export async function analyzeSentiment(symbol: string) {
  return withRetry(async () => {
    const ai = getAIClient();
    const today = new Date().toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', day: 'numeric', month: 'long', year: 'numeric' });
    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: `Perform a deep sentiment analysis for the Indian stock symbol "${symbol}" (NSE/BSE) as of ${today}. 
      
      1. NEWS SOURCES: Provide 5 simulated LIVE news headlines from today (${today}) from these specific reputable Indian sources:
         - The Economic Times (ET)
         - Moneycontrol
         - CNBC-TV18
         - Business Standard
         - Mint / Financial Express
      
      2. SOCIAL MEDIA: Provide 3 simulated high-impact social media posts/discussions from:
         - Twitter/X (Indian Finance community / #StockMarketIndia)
         - Reddit (r/IndiaInvestments or r/IndianStreetBets)
         - StockTwits (India)
      
      For each item, provide:
      - A sentiment score strictly between -1.0 (extremely bearish) and 1.0 (extremely bullish).
      - A label: "Positive", "Neutral", or "Negative".
      - The specific source name.
      - A brief snippet of the text.
      
      Focus on recent corporate actions, quarterly results, SEBI announcements, or sector-specific trends in India.`,
      config: {
        temperature: 0.2, // Lower temperature for more consistent, analytical scoring
        topP: 0.8,
        topK: 40,
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              source: { type: Type.STRING, enum: ["news", "social"] },
              sourceName: { type: Type.STRING },
              score: { type: Type.NUMBER },
              label: { type: Type.STRING, enum: ["Positive", "Neutral", "Negative"] },
              text: { type: Type.STRING },
              timestamp: { type: Type.STRING }
            },
            required: ["source", "sourceName", "score", "label", "text", "timestamp"]
          }
        }
      }
    });

    try {
      return JSON.parse(response.text || "[]") as SentimentScore[];
    } catch (e) {
      console.error("Failed to parse sentiment JSON:", response.text);
      return [];
    }
  });
}

export async function getPrediction(symbol: string, sentiments: SentimentScore[], historicalData: any[], imageAnalysis?: ChartAnalysisResult) {
  return withRetry(async () => {
    const ai = getAIClient();
    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: `Act as a senior Indian market strategist. Provide a short-term (1-5 days) price prediction for "${symbol}".
      
      CONTEXTUAL DATA:
      - SENTIMENT DATA: ${JSON.stringify(sentiments)}
      - RECENT PRICE ACTION (Last 5 periods): ${JSON.stringify(historicalData.slice(-5))}
      ${imageAnalysis ? `- TECHNICAL CHART ANALYSIS: ${JSON.stringify(imageAnalysis)}` : ''}
      
      STRATEGIC REQUIREMENTS:
      1. Consider FII/DII flow trends and Global Market Cues (Gift Nifty, US Markets) if applicable.
      2. Analyze the synergy between the Sentiment (News/Social) and the Technicals (Price/Chart).
      3. Provide a specific Target Price based on current support/resistance.
      4. Confidence level should reflect the alignment of data points.
      
      Return a trend (Up/Down/Sideways), confidence (0-100), and a detailed reasoning focusing on Indian market catalysts.`,
      config: {
        temperature: 0.4, // Balanced temperature for reasoning and consistency
        topP: 0.9,
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            trend: { type: Type.STRING, enum: ["Up", "Down", "Sideways"] },
            confidence: { type: Type.NUMBER },
            reasoning: { type: Type.STRING },
            targetPrice: { type: Type.NUMBER }
          },
          required: ["trend", "confidence", "reasoning"]
        }
      }
    });

    try {
      return JSON.parse(response.text || "{}") as PredictionResult;
    } catch (e) {
      console.error("Failed to parse prediction JSON:", response.text);
      const fallback: PredictionResult = { trend: 'Sideways', confidence: 0, reasoning: 'Failed to generate prediction.' };
      return fallback;
    }
  });
}

export async function getLivePrice(symbol: string) {
  try {
    const response = await fetch(`/api/stock/${symbol}`);
    if (response.status === 404) {
      console.warn(`Stock ${symbol} not found via proxy`);
      // If it's a 404, we still try Gemini as it might have more up-to-date info or different symbol knowledge
    } else if (!response.ok) {
      throw new Error(`Proxy error: ${response.status}`);
    } else {
      const data = await response.json();
      return {
        price: data.price,
        currency: data.currency,
        change: data.change,
        changePercent: data.changePercent
      };
    }
  } catch (proxyErr) {
    console.warn("Proxy fetch failed, falling back to Gemini:", proxyErr);
  }

  // Fallback to Gemini
  return withRetry(async () => {
    const ai = getAIClient();
    const currentTime = new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' });
    try {
      // Use a more descriptive prompt to help Gemini find the right data
      const response = await ai.models.generateContent({
        model: "gemini-3-flash-preview",
        contents: `Search for the current live stock price of the Indian stock "${symbol}" on NSE or BSE as of ${currentTime}. 
        Provide the latest price, currency (default INR), and today's change percentage.
        If the stock symbol is not found or invalid, indicate this clearly.`,
        config: {
          tools: [{ googleSearch: {} }],
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              isValid: { type: Type.BOOLEAN, description: "Whether the stock was found" },
              price: { type: Type.NUMBER, description: "Current market price" },
              changePercent: { type: Type.NUMBER, description: "Percentage change today" },
              currency: { type: Type.STRING, description: "Currency code" }
            },
            required: ["isValid"]
          }
        }
      });

      const text = response.text;
      if (!text) throw new Error("Empty response from Gemini");
      
      const data = JSON.parse(text);
      
      if (!data.isValid || !data.price) {
        return { price: -1, currency: "INR", change: 0, changePercent: 0 };
      }

      return { 
        price: data.price, 
        currency: data.currency || "INR", 
        change: 0, 
        changePercent: data.changePercent || 0 
      };
    } catch (e: any) {
      console.error("Gemini live price fetch failed:", e.message);
      // If even Gemini fails, return null to let the UI handle it
      return null;
    }
  });
}

export async function getHistoricalData(symbol: string, range: string = '5Y') {
  try {
    // Map range to Yahoo Finance format
    const rangeMap: Record<string, string> = {
      '1D': '1d',
      '1W': '5d',
      '1M': '1mo',
      '1Y': '1y',
      '5Y': '5y',
      'ALL': 'max'
    };
    
    const yfRange = rangeMap[range] || '5y';
    const interval = yfRange === '1d' ? '1m' : '1d';

    const response = await fetch(`/api/stock/${symbol}?range=${yfRange}&interval=${interval}`);
    if (!response.ok) throw new Error("Failed to fetch from proxy");
    const data = await response.json();
    
    return data.history.map((d: any) => ({
      date: new Date(d.date).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' }),
      price: d.price,
      volume: d.volume
    })) as StockData[];
  } catch (proxyErr) {
    console.warn("Proxy historical fetch failed, falling back to Gemini:", proxyErr);
    return withRetry(async () => {
      const ai = getAIClient();
      const response = await ai.models.generateContent({
        model: "gemini-3-flash-preview",
        contents: `Fetch realistic historical daily closing prices for the Indian stock ${symbol} for the period: ${range}. 
        If ${range} is 'ALL', provide data since its IPO or the very beginning of its listing on NSE/BSE. This is CRITICAL: fetch from the earliest available date.
        If ${range} is '5Y', provide data for the last 5 years.
        Return a JSON array of objects with "date" (YYYY-MM-DD) and "price" (number).
        Provide approximately 100-150 data points distributed across the entire history to represent the long-term trend accurately.
        Ensure the prices are realistic based on actual historical performance of ${symbol}.`,
        config: {
          tools: [{ googleSearch: {} }],
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                date: { type: Type.STRING },
                price: { type: Type.NUMBER }
              },
              required: ["date", "price"]
            }
          }
        }
      });

      try {
        const data = JSON.parse(response.text || "[]");
        return data.map((d: any) => ({
          date: new Date(d.date).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' }),
          price: d.price,
          volume: Math.floor(Math.random() * 1000000) + 500000 // Mock volume as it's less critical
        })) as StockData[];
      } catch (e) {
        console.error("Failed to parse historical data:", e);
        return [];
      }
    });
  }
}

export async function identifyStockFromImage(base64Image: string) {
  return withRetry(async () => {
    const ai = getAIClient();
    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: {
        parts: [
          {
            inlineData: {
              mimeType: "image/png",
              data: base64Image.split(",")[1] || base64Image
            }
          },
          {
            text: "Identify the Indian stock symbol (NSE/BSE) from this chart image. Return ONLY the symbol (e.g., RELIANCE, TCS, HDFCBANK). If multiple are present, return the most prominent one. If none found, return 'UNKNOWN'."
          }
        ]
      },
      config: {
        temperature: 0.1,
        responseMimeType: "text/plain"
      }
    });

    return response.text?.trim() || "UNKNOWN";
  });
}

export async function analyzeChartImage(base64Image: string) {
  return withRetry(async () => {
    const ai = getAIClient();
    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: {
        parts: [
          {
            inlineData: {
              mimeType: "image/png",
              data: base64Image.split(",")[1] || base64Image
            }
          },
          {
            text: `Analyze this stock chart. Identify key support/resistance levels, current trend, and any visible patterns (e.g., Head and Shoulders, RSI divergence). 
            
            Return the analysis in JSON format with the following structure:
            - summary: A detailed markdown summary of the analysis.
            - patterns: An array of identified patterns, each with name, type (bullish/bearish/neutral), confidence (0-100), description, and optionally startDate/endDate (YYYY-MM-DD) if identifiable from the chart's x-axis.
            - supportLevels: An array of key support price levels.
            - resistanceLevels: An array of key resistance price levels.`
          }
        ]
      },
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            summary: { type: Type.STRING },
            patterns: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  name: { type: Type.STRING },
                  type: { type: Type.STRING, enum: ["bullish", "bearish", "neutral"] },
                  confidence: { type: Type.NUMBER },
                  description: { type: Type.STRING },
                  startDate: { type: Type.STRING },
                  endDate: { type: Type.STRING },
                  priceLevel: { type: Type.NUMBER }
                },
                required: ["name", "type", "confidence", "description"]
              }
            },
            supportLevels: {
              type: Type.ARRAY,
              items: { type: Type.NUMBER }
            },
            resistanceLevels: {
              type: Type.ARRAY,
              items: { type: Type.NUMBER }
            }
          },
          required: ["summary", "patterns", "supportLevels", "resistanceLevels"]
        }
      }
    });

    try {
      return JSON.parse(response.text || "{}") as ChartAnalysisResult;
    } catch (e) {
      console.error("Failed to parse chart analysis JSON:", response.text);
      return null;
    }
  });
}
