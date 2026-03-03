export interface StockData {
  date: string;
  price: number;
  volume: number;
  signal?: 'BUY' | 'SELL';
  signalRationale?: string;
}

export interface SentimentScore {
  source: 'news' | 'social';
  sourceName?: string;
  score: number; // -1 to 1
  label: 'Positive' | 'Neutral' | 'Negative';
  text: string;
  timestamp: string;
}

export interface PredictionResult {
  trend: 'Up' | 'Down' | 'Sideways';
  confidence: number;
  reasoning: string;
  targetPrice?: number;
}

export interface PriceAlert {
  id: string;
  symbol: string;
  threshold: number;
  type: 'above' | 'below';
  active: boolean;
  triggeredAt?: string;
}

export interface ChartPattern {
  name: string;
  type: 'bullish' | 'bearish' | 'neutral';
  confidence: number;
  description: string;
  startDate?: string; // YYYY-MM-DD
  endDate?: string;   // YYYY-MM-DD
  priceLevel?: number;
}

export interface ChartAnalysisResult {
  summary: string;
  patterns: ChartPattern[];
  supportLevels: number[];
  resistanceLevels: number[];
}

export interface AnalysisResult {
  sentiment: SentimentScore[];
  prediction: PredictionResult;
}
