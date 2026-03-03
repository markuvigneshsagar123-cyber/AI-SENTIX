/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from 'react';
import { 
  TrendingUp, 
  TrendingDown, 
  BarChart3, 
  Newspaper, 
  Twitter, 
  Image as ImageIcon, 
  Camera,
  Search,
  AlertCircle,
  Loader2,
  ArrowUpRight,
  ArrowDownRight,
  Minus,
  Copy,
  ChevronRight,
  Bell,
  Plus,
  Trash2,
  CheckCircle2,
  Zap,
  Sun,
  Moon,
  Monitor,
  Heart,
  ExternalLink,
  Info,
  HelpCircle,
  Download,
  MessageSquare
} from 'lucide-react';
import { 
  LineChart, 
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Tooltip, 
  ResponsiveContainer,
  AreaChart,
  Area,
  ComposedChart,
  Bar,
  Line,
  Cell,
  Brush,
  Scatter,
  ReferenceLine,
  ReferenceArea
} from 'recharts';
import { motion, AnimatePresence, animate } from 'motion/react';
import html2canvas from 'html2canvas';
import { analyzeSentiment, getPrediction, analyzeChartImage, identifyStockFromImage, getLivePrice, getHistoricalData } from './services/gemini';
import { SentimentScore, PredictionResult, StockData, PriceAlert, ChartAnalysisResult } from './types';
import { calculateSMA, calculateEMA, calculateRSI, calculateMACD, generateSignals } from './utils/indicators';
import { INDIAN_INDICES, POPULAR_INDIAN_STOCKS } from './constants/stocks';
import ReactMarkdown from 'react-markdown';

declare global {
  interface Window {
    aistudio?: {
      hasSelectedApiKey: () => Promise<boolean>;
      openSelectKey: () => Promise<void>;
    };
  }
}

// Mock data generator
const generateMockData = (symbol: string): StockData[] => {
  const data: StockData[] = [];
  let price = 150 + Math.random() * 50;
  const now = new Date();
  // Generate 5 years of data (approx 1825 days)
  const totalDays = 365 * 5;
  for (let i = totalDays; i >= 0; i--) {
    const date = new Date(now);
    date.setDate(now.getDate() - i);
    // Add some volatility but keep it realistic for a 5-year span
    price += (Math.random() - 0.48) * 4; // Slight upward bias
    if (price < 10) price = 10; // Floor price
    
    data.push({
      date: date.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' }),
      price: parseFloat(price.toFixed(2)),
      volume: Math.floor(Math.random() * 1000000) + 500000
    });
  }
  return data;
};

// Market status check for Indian exchanges (NSE/BSE)
const isIndianMarketOpen = () => {
  const now = new Date();
  // Indian Standard Time is UTC +5:30
  const istOffset = 5.5 * 60 * 60 * 1000;
  const istTime = new Date(now.getTime() + (now.getTimezoneOffset() * 60000) + istOffset);
  
  const day = istTime.getDay(); // 0 = Sunday, 6 = Saturday
  const hours = istTime.getHours();
  const minutes = istTime.getMinutes();
  const timeInMinutes = hours * 60 + minutes;

  // Market is closed on weekends
  if (day === 0 || day === 6) return false;

  // Normal trading hours: 9:15 AM (555 mins) to 3:30 PM (930 mins)
  return timeInMinutes >= 555 && timeInMinutes <= 930;
};

const CursorFollower = () => {
  const [mousePos, setMousePos] = useState({ x: 0, y: 0 });
  const [trailPos, setTrailPos] = useState({ x: 0, y: 0 });

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      setMousePos({ x: e.clientX, y: e.clientY });
    };
    window.addEventListener('mousemove', handleMouseMove);
    return () => window.removeEventListener('mousemove', handleMouseMove);
  }, []);

  useEffect(() => {
    const timeout = setTimeout(() => {
      setTrailPos(mousePos);
    }, 50);
    return () => clearTimeout(timeout);
  }, [mousePos]);

  return (
    <>
      <div 
        className="cursor-glow" 
        style={{ 
          transform: `translate(${mousePos.x - 200}px, ${mousePos.y - 200}px)`,
          background: `radial-gradient(circle, hsla(${(mousePos.x + mousePos.y) % 360}, 70%, 50%, 0.1) 0%, transparent 70%)`
        }} 
      />
      <div 
        className="cursor-dot" 
        style={{ 
          transform: `translate(${mousePos.x - 4}px, ${mousePos.y - 4}px)`,
          background: `hsl(${(mousePos.x + mousePos.y) % 360}, 70%, 50%)`,
          boxShadow: `0 0 15px hsl(${(mousePos.x + mousePos.y) % 360}, 70%, 50%), 0 0 30px hsl(${(mousePos.x + mousePos.y) % 360}, 70%, 50%)`
        }} 
      />
      <div 
        className="cursor-trail" 
        style={{ 
          transform: `translate(${trailPos.x - 10}px, ${trailPos.y - 10}px)`,
          borderColor: `hsla(${(trailPos.x + trailPos.y) % 360}, 70%, 50%, 0.3)`
        }} 
      />
    </>
  );
};

export default function App() {
  const [theme, setTheme] = useState<'light' | 'dark' | 'auto'>('dark');
  const [symbol, setSymbol] = useState<string | null>(null);
  const [inputSymbol, setInputSymbol] = useState('');
  const [loading, setLoading] = useState(false);
  const [stockData, setStockData] = useState<StockData[]>([]);
  const [sentiments, setSentiments] = useState<SentimentScore[]>([]);
  const [prediction, setPrediction] = useState<PredictionResult | null>(null);
  const [livePrice, setLivePrice] = useState<{ price: number; change?: number; changePercent?: number } | null>(null);
  const [imageAnalysis, setImageAnalysis] = useState<ChartAnalysisResult | null>(null);
  const [analyzingImage, setAnalyzingImage] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasProfessionalKey, setHasProfessionalKey] = useState(false);
  const [displayPrice, setDisplayPrice] = useState<number | null>(null);
  const [lastSync, setLastSync] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [isRealData, setIsRealData] = useState(false);
  const [showAIInsights, setShowAIInsights] = useState(false);
  const [animatedPoint, setAnimatedPoint] = useState<any | null>(null);
  const animationRef = React.useRef<any>(null);
  const stockDataRef = React.useRef<StockData[]>([]);
  
  useEffect(() => {
    const root = document.documentElement;
    if (theme === 'auto') {
      const isDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
      root.setAttribute('data-theme', isDark ? 'dark' : 'light');
    } else {
      root.setAttribute('data-theme', theme);
    }
  }, [theme]);

  useEffect(() => {
    stockDataRef.current = stockData;
  }, [stockData]);

  const [activeIndicators, setActiveIndicators] = useState({
    sma: false,
    ema: false,
    rsi: false,
    macd: false
  });
  const [timeRange, setTimeRange] = useState<'1D' | '1W' | '1M' | '1Y' | '5Y' | 'ALL'>('ALL');
  const [recommendations, setRecommendations] = useState<{ symbol: string; name: string }[]>([]);
  const [showRecommendations, setShowRecommendations] = useState(false);
  const [headerInputValue, setHeaderInputValue] = useState("");
  const [showHeaderRecommendations, setShowHeaderRecommendations] = useState(false);
  const [headerRecommendations, setHeaderRecommendations] = useState<{ symbol: string; name: string }[]>([]);
  const [alerts, setAlerts] = useState<PriceAlert[]>([]);
  const [isAlertModalOpen, setIsAlertModalOpen] = useState(false);
  const [newAlertThreshold, setNewAlertThreshold] = useState("");
  const [newAlertType, setNewAlertType] = useState<'above' | 'below'>('above');
  const [chartAnalysis, setChartAnalysis] = useState<ChartAnalysisResult | null>(null);
  const [analyzingChart, setAnalyzingChart] = useState(false);
  const chartRef = React.useRef<HTMLDivElement>(null);
  const [notifications, setNotifications] = useState<{ id: string; message: string; type: 'info' | 'success' | 'warning' }[]>([]);
  const [tickerData, setTickerData] = useState<any[]>([]);
  const [isIdentifyingStock, setIsIdentifyingStock] = useState(false);
  const imageInputRef = React.useRef<HTMLInputElement>(null);

  useEffect(() => {
    const fetchTickerData = async (retryCount = 0) => {
      try {
        const symbols = INDIAN_INDICES.slice(0, 10).map(s => s.symbol).join(',');
        const url = `/api/stocks/batch?symbols=${encodeURIComponent(symbols)}`;
        
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 15000); // 15s timeout

        const response = await fetch(url, {
          signal: controller.signal,
          headers: {
            'Accept': 'application/json',
            'Cache-Control': 'no-cache',
            'Pragma': 'no-cache'
          }
        });

        clearTimeout(timeoutId);

        if (response.ok) {
          const contentType = response.headers.get('content-type');
          if (contentType && contentType.includes('application/json')) {
            const data = await response.json();
            if (Array.isArray(data) && data.length > 0) {
              setTickerData(data);
            }
          } else {
            const text = await response.text();
            console.warn(`[Ticker] Expected JSON but received ${contentType}: ${text.substring(0, 100)}...`);
            throw new Error('Invalid response format');
          }
        } else {
          const errorText = await response.text();
          console.warn(`[Ticker] Fetch failed with status: ${response.status} - ${errorText}`);
          throw new Error(`Server error: ${response.status}`);
        }
      } catch (error: any) {
        if (error.name === 'AbortError') {
          console.error("[Ticker] Fetch timed out");
        } else {
          console.error("[Ticker] Failed to fetch ticker data:", error);
        }
        
        if (retryCount < 3) {
          setTimeout(() => fetchTickerData(retryCount + 1), 3000 * (retryCount + 1));
        }
      }
    };

    fetchTickerData();
    const interval = setInterval(() => fetchTickerData(), 60000);
    return () => clearInterval(interval);
  }, []);

  const enrichedData = React.useMemo(() => {
    if (stockData.length === 0) return [];
    
    // Calculate indicators on FULL history for accuracy
    const sma = calculateSMA(stockData, 14);
    const ema = calculateEMA(stockData, 14);
    const rsi = calculateRSI(stockData, 14);
    const { macd, signal, histogram } = calculateMACD(stockData);

    return stockData.map((d, i) => ({
      ...d,
      sma: sma[i],
      ema: ema[i],
      rsi: rsi[i],
      macd: macd[i],
      macdSignal: signal[i],
      macdHist: histogram[i]
    }));
  }, [stockData]);

  const displayData = React.useMemo(() => {
    const fullEnriched = enrichedData;
    let filtered = [];

    // Now filter for display based on timeRange
    switch (timeRange) {
      case '1D': filtered = fullEnriched.slice(-2); break;
      case '1W': filtered = fullEnriched.slice(-7); break;
      case '1M': filtered = fullEnriched.slice(-30); break;
      case '1Y': filtered = fullEnriched.slice(-365); break;
      case '5Y': filtered = fullEnriched.slice(-1825); break;
      case 'ALL':
      default: filtered = [...fullEnriched]; break;
    }

    // Ensure all data points have valid numbers for Recharts
    filtered = filtered.map(d => ({
      ...d,
      price: typeof d.price === 'number' && !isNaN(d.price) ? d.price : 0,
      sma: typeof d.sma === 'number' && !isNaN(d.sma) ? d.sma : null,
      ema: typeof d.ema === 'number' && !isNaN(d.ema) ? d.ema : null,
      rsi: typeof d.rsi === 'number' && !isNaN(d.rsi) ? d.rsi : null,
      macd: typeof d.macd === 'number' && !isNaN(d.macd) ? d.macd : null,
      macdSignal: typeof d.macdSignal === 'number' && !isNaN(d.macdSignal) ? d.macdSignal : null,
      macdHist: typeof d.macdHist === 'number' && !isNaN(d.macdHist) ? d.macdHist : null,
    }));

    // SMOOTH ANIMATION OVERRIDE: If we are currently animating a new price, override the last point
    if (animatedPoint !== null && filtered.length > 0) {
      filtered[filtered.length - 1] = {
        ...filtered[filtered.length - 1],
        ...animatedPoint
      };
    }

    return filtered;
  }, [enrichedData, timeRange, animatedPoint]);

  const sentimentBreakdown = React.useMemo(() => {
    const breakdown = {
      news: { positive: 0, neutral: 0, negative: 0, total: 0 },
      social: { positive: 0, neutral: 0, negative: 0, total: 0 }
    };

    sentiments.forEach(s => {
      const type = s.source === 'news' ? 'news' : 'social';
      breakdown[type].total++;
      if (s.label === 'Positive') breakdown[type].positive++;
      else if (s.label === 'Neutral') breakdown[type].neutral++;
      else if (s.label === 'Negative') breakdown[type].negative++;
    });

    const getPercent = (count: number, total: number) => total > 0 ? Math.round((count / total) * 100) : 0;

    return {
      news: {
        positive: getPercent(breakdown.news.positive, breakdown.news.total),
        neutral: getPercent(breakdown.news.neutral, breakdown.news.total),
        negative: getPercent(breakdown.news.negative, breakdown.news.total)
      },
      social: {
        positive: getPercent(breakdown.social.positive, breakdown.social.total),
        neutral: getPercent(breakdown.social.neutral, breakdown.social.total),
        negative: getPercent(breakdown.social.negative, breakdown.social.total)
      },
      combined: {
        positive: Math.round((getPercent(breakdown.news.positive, breakdown.news.total) + getPercent(breakdown.social.positive, breakdown.social.total)) / 2),
        negative: Math.round((getPercent(breakdown.news.negative, breakdown.news.total) + getPercent(breakdown.social.negative, breakdown.social.total)) / 2)
      }
    };
  }, [sentiments]);

  useEffect(() => {
    const checkKey = async () => {
      if (window.aistudio?.hasSelectedApiKey) {
        const hasKey = await window.aistudio.hasSelectedApiKey();
        setHasProfessionalKey(hasKey);
        if (!hasKey && window.aistudio?.openSelectKey) {
          // Prompt for key on mount if not selected
          await window.aistudio.openSelectKey();
          const nowHasKey = await window.aistudio.hasSelectedApiKey();
          setHasProfessionalKey(nowHasKey);
        }
      }
    };
    checkKey();
  }, []);

  // High-frequency visual ticker (0.5s)
  useEffect(() => {
    if (livePrice?.price && isIndianMarketOpen()) {
      // Smoothly transition the display price to the new live price instead of jumping
      animate(displayPrice || livePrice.price, livePrice.price, {
        duration: 1,
        ease: "easeOut",
        onUpdate: (v) => setDisplayPrice(v)
      });
      
      const ticker = setInterval(() => {
        if (!isIndianMarketOpen()) return;
        setDisplayPrice(prev => {
          if (!prev) return livePrice.price;
          // Simulate minor institutional-grade fluctuations (0.01% to 0.05%)
          const fluctuation = prev * (0.0001 + Math.random() * 0.0004);
          const direction = Math.random() > 0.48 ? 1 : -1; // Slight upward bias
          const nextPrice = parseFloat((prev + (fluctuation * direction)).toFixed(2));
          
          // NOTE: We no longer update stockData here to prevent expensive chart re-renders
          // The chart is updated smoothly via the 60s periodic sync
          
          return nextPrice;
        });
      }, 500);

      return () => clearInterval(ticker);
    } else if (livePrice?.price) {
      setDisplayPrice(livePrice.price);
    }
  }, [livePrice?.price]);

  const handleOpenKeySelector = async () => {
    if (window.aistudio?.openSelectKey) {
      await window.aistudio.openSelectKey();
      setHasProfessionalKey(true);
      setError(null);
    }
  };

  const addNotification = (message: string, type: 'info' | 'success' | 'warning' = 'info') => {
    const id = Math.random().toString(36).substr(2, 9);
    setNotifications(prev => [...prev, { id, message, type }]);
    setTimeout(() => {
      setNotifications(prev => prev.filter(n => n.id !== id));
    }, 5000);
  };

  const checkAlerts = (currentPrice: number, currentSymbol: string) => {
    setAlerts(prev => {
      let changed = false;
      const next = prev.map(alert => {
        if (alert.active && alert.symbol === currentSymbol) {
          const triggered = alert.type === 'above' ? currentPrice >= alert.threshold : currentPrice <= alert.threshold;
          if (triggered) {
            addNotification(`ALERT: ${currentSymbol} reached ${currentPrice} (Threshold: ${alert.threshold})`, 'warning');
            changed = true;
            return { ...alert, active: false, triggeredAt: new Date().toISOString() };
          }
        }
        return alert;
      });
      return changed ? next : prev;
    });
  };

  const handleAddAlert = () => {
    if (!symbol || !newAlertThreshold) return;
    const threshold = parseFloat(newAlertThreshold);
    if (isNaN(threshold)) return;

    const newAlert: PriceAlert = {
      id: Math.random().toString(36).substr(2, 9),
      symbol,
      threshold,
      type: newAlertType,
      active: true
    };

    setAlerts(prev => [...prev, newAlert]);
    setNewAlertThreshold("");
    setIsAlertModalOpen(false);
    addNotification(`Alert set for ${symbol} at ${threshold}`, 'success');
  };

  const handleRemoveAlert = (id: string) => {
    setAlerts(prev => prev.filter(a => a.id !== id));
  };

  const handleAnalyzeChart = async () => {
    if (!chartRef.current || !symbol) return;
    
    setAnalyzingChart(true);
    setChartAnalysis(null);
    try {
      // Capture the chart as an image
      const canvas = await html2canvas(chartRef.current, {
        backgroundColor: '#050505',
        scale: 2,
        logging: false
      });
      const base64Image = canvas.toDataURL('image/png');
      
      const result = await analyzeChartImage(base64Image);
      if (result) {
        setChartAnalysis(result);
        const refinedPrediction = await getPrediction(symbol, sentiments, stockData, result);
        setPrediction(refinedPrediction);
      } else {
        addNotification("No analysis generated.", "warning");
      }
    } catch (err) {
      console.error("Chart analysis failed:", err);
      addNotification("Failed to analyze chart image.", "warning");
    } finally {
      setAnalyzingChart(false);
    }
  };

  const handleSearchImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsIdentifyingStock(true);
    setError(null);
    try {
      const reader = new FileReader();
      reader.onload = async (event) => {
        const base64 = event.target?.result as string;
        const identifiedSymbol = await identifyStockFromImage(base64);
        
        if (identifiedSymbol && identifiedSymbol !== 'UNKNOWN') {
          setInputSymbol(identifiedSymbol);
          fetchData(identifiedSymbol);
          addNotification(`Identified stock: ${identifiedSymbol}`, 'success');
        } else {
          setError("COULD NOT IDENTIFY: We couldn't find a stock symbol in that image.");
        }
        setIsIdentifyingStock(false);
      };
      reader.readAsDataURL(file);
    } catch (err) {
      console.error("Image identification failed:", err);
      setError("ANALYSIS FAILED: Something went wrong while identifying the stock.");
      setIsIdentifyingStock(false);
    }
  };

  const fetchData = async (targetSymbol: string) => {
    if (loading) return;
    setLoading(true);
    setPrediction(null);
    setSentiments([]);
    setImageAnalysis(null);
    setError(null);
    
    try {
      // 1. Get Live Price immediately for fast UI feedback
      const liveData = await getLivePrice(targetSymbol);
      
      if (!liveData || liveData.price === -1) {
        throw new Error("INVALID_STOCK");
      }

      setLivePrice({
        price: liveData.price,
        change: liveData.change,
        changePercent: liveData.changePercent
      });
      setLastSync(new Date().toLocaleTimeString());

      // 2. Fetch realistic historical data via Gemini Search
      // We fetch 'ALL' by default to have the full history for indicators
      const historicalData = await getHistoricalData(targetSymbol, 'ALL');
      let initialData: StockData[] = [];
      
      if (historicalData && historicalData.length > 0) {
        // Validate historical data
        const validHist = historicalData.filter(d => d && typeof d.price === 'number' && !isNaN(d.price));
        if (validHist.length > 0) {
          initialData = generateSignals(validHist);
          setStockData(initialData);
          setIsRealData(true);
        } else {
          const mockData = generateMockData(targetSymbol);
          initialData = generateSignals(mockData);
          setStockData(initialData);
          setIsRealData(false);
        }
      } else {
        // Fallback to mock if search fails
        const mockData = generateMockData(targetSymbol);
        initialData = generateSignals(mockData);
        setStockData(initialData);
        setIsRealData(false);
      }

      // FAST LOAD: Set loading to false as soon as chart data is ready
      setLoading(false);

      // 3. Start background analysis (Sentiment & Prediction) - NON-BLOCKING
      (async () => {
        try {
          const sentimentData = await analyzeSentiment(targetSymbol);
          setSentiments(sentimentData);

          const predictionData = await getPrediction(
            targetSymbol, 
            sentimentData, 
            historicalData && historicalData.length > 0 ? historicalData : generateMockData(targetSymbol)
          );
          setPrediction(predictionData);

          // 4. Re-generate signals incorporating AI prediction for the latest data point
          const finalData = historicalData && historicalData.length > 0 ? historicalData : generateMockData(targetSymbol);
          const dataWithAiSignals = generateSignals(finalData, predictionData);
          setStockData(dataWithAiSignals);
        } catch (bgErr) {
          console.error("Background analysis failed:", bgErr);
        }
      })();
      
    } catch (err: any) {
      setLoading(false);
      console.error("Error fetching data:", err);
      const errMessage = err instanceof Error ? err.message : String(err);
      const errStr = JSON.stringify(err);
      
      if (errMessage === "INVALID_STOCK" || errMessage.includes("INVALID_STOCK")) {
        setError("WRONG STOCK: This asset was not found on NSE or BSE.");
        setSymbol(null); // Reset symbol so they stay on search screen
        setInputSymbol(""); // Clear input on error
      } else if (errStr.includes('429') || errStr.includes('RESOURCE_EXHAUSTED') || errMessage.includes('quota')) {
        setError("Institutional data quota reached. Try connecting a Pro Key for uninterrupted analysis.");
      } else {
        setError("Strategic analysis interrupted. Please re-execute.");
      }
    }
  };

  useEffect(() => {
    if (symbol) {
      fetchData(symbol);
      
      // Set up periodic live price updates every 60 seconds for better responsiveness
      const interval = setInterval(async () => {
        if (!isIndianMarketOpen()) return;
        try {
          setSyncing(true);
          const liveData = await getLivePrice(symbol);
          if (liveData && liveData.price > 0) {
            setLivePrice({
              price: liveData.price,
              change: liveData.change,
              changePercent: liveData.changePercent
            });
            setLastSync(new Date().toLocaleTimeString());
            
            // CHECK ALERTS
            checkAlerts(liveData.price, symbol);
            
            // SMOOTH ANIMATION: Interpolate the price change over 2 seconds
            const currentData = stockDataRef.current;
            if (currentData.length > 0 && typeof liveData.price === 'number' && !isNaN(liveData.price)) {
              const lastPointIdx = currentData.length - 1;
              const lastPoint = currentData[lastPointIdx];
              const startPrice = lastPoint.price;
              const endPrice = liveData.price;

              if (isNaN(startPrice)) {
                setStockData(prev => {
                  if (prev.length === 0) return prev;
                  const next = [...prev];
                  next[next.length - 1] = { ...next[next.length - 1], price: endPrice };
                  return next;
                });
                return;
              }

              // Calculate target indicators for the end price
              const targetData = [...currentData];
              targetData[lastPointIdx] = { ...targetData[lastPointIdx], price: endPrice };
              const targetEnriched = generateSignals(targetData) as any[];
              const targetPoint = targetEnriched[lastPointIdx];
              
              // Get current enriched point for starting values
              const currentEnriched = (enrichedData[enrichedData.length - 1] || lastPoint) as any;

              if (animationRef.current) animationRef.current.stop();
              
              animationRef.current = animate(0, 1, {
                duration: 2.5,
                ease: [0.16, 1, 0.3, 1], // Custom Quartic Out for a "luxury" smooth feel
                onUpdate: (progress) => {
                  const lerp = (start: number | null, end: number | null) => {
                    if (start === null || end === null || isNaN(start) || isNaN(end)) return end;
                    // Use a more precise interpolation
                    return parseFloat((start + (end - start) * progress).toFixed(4));
                  };

                  setAnimatedPoint({
                    price: lerp(startPrice, endPrice),
                    sma: lerp(currentEnriched.sma, targetPoint.sma),
                    ema: lerp(currentEnriched.ema, targetPoint.ema),
                    rsi: lerp(currentEnriched.rsi, targetPoint.rsi),
                    macd: lerp(currentEnriched.macd, targetPoint.macd),
                    macdSignal: lerp(currentEnriched.macdSignal, targetPoint.macdSignal),
                    macdHist: lerp(currentEnriched.macdHist, targetPoint.macdHist)
                  });
                },
                onComplete: () => {
                  setStockData(prev => {
                    if (prev.length === 0) return prev;
                    const next = [...prev];
                    next[next.length - 1] = {
                      ...next[next.length - 1],
                      price: endPrice
                    };
                    return next;
                  });
                  setAnimatedPoint(null);
                }
              });
            }
          }
        } catch (e: any) {
          console.warn("Periodic update failed:", e);
          const errStr = JSON.stringify(e);
          if (errStr.includes('429') || errStr.includes('RESOURCE_EXHAUSTED')) {
            setError("Quota exhausted. Try connecting a Pro Key for uninterrupted analysis.");
          }
        } finally {
          setSyncing(false);
        }
      }, 60000);

      return () => clearInterval(interval);
    }
  }, [symbol]);

  const formatDateForChart = (dateStr: string) => {
    try {
      const d = new Date(dateStr);
      if (isNaN(d.getTime())) return dateStr;
      return d.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
    } catch (e) {
      return dateStr;
    }
  };

  const formatCurrency = (value: number) => {
    return new Intl.NumberFormat('en-IN', {
      style: 'currency',
      currency: 'INR',
      maximumFractionDigits: 0
    }).format(value);
  };

  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    const query = inputSymbol.trim().toUpperCase();
    if (query) {
      setLoading(true);
      setError(null);
      setShowRecommendations(false);
      try {
        // Try to find by name first (e.g., "NIFTY 50")
        const found = POPULAR_INDIAN_STOCKS.find(s => 
          s.name.toUpperCase().includes(query) || 
          s.symbol.toUpperCase() === query ||
          s.symbol.split('.')[0].toUpperCase() === query
        );
        
        const target = found ? found.symbol : query;
        
        const liveData = await getLivePrice(target);
        if (!liveData || liveData.price === -1) {
          throw new Error("INVALID_STOCK");
        }
        setSymbol(target);
      } catch (err) {
        setError("WRONG STOCK: This asset was not found on NSE or BSE.");
        setInputSymbol("");
      } finally {
        setLoading(false);
      }
    }
  };

  const handleRecommendationClick = async (s: string) => {
    setInputSymbol(s);
    setShowRecommendations(false);
    setLoading(true);
    setError(null);
    try {
      const liveData = await getLivePrice(s);
      if (liveData && liveData.price !== -1) {
        setSymbol(s);
      } else {
        setError("WRONG STOCK: This asset was not found on NSE or BSE.");
      }
    } catch (e) {
      setError("Strategic analysis interrupted.");
    } finally {
      setLoading(false);
    }
  };

  const handleHeaderRecommendationClick = async (s: string) => {
    setHeaderInputValue("");
    setShowHeaderRecommendations(false);
    setLoading(true);
    setError(null);
    try {
      const liveData = await getLivePrice(s);
      if (liveData && liveData.price !== -1) {
        setSymbol(s);
      } else {
        setError("WRONG STOCK: This asset was not found on NSE or BSE.");
      }
    } catch (e) {
      setError("Strategic analysis interrupted.");
    } finally {
      setLoading(false);
    }
  };

  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setAnalyzingImage(true);
    const reader = new FileReader();
    reader.onloadend = async () => {
      const base64 = reader.result as string;
      try {
        const result = await analyzeChartImage(base64);
        if (result) {
          setImageAnalysis(result);
          if (symbol) {
            const refinedPrediction = await getPrediction(symbol, sentiments, stockData, result);
            setPrediction(refinedPrediction);
          }
        } else {
          addNotification("No analysis generated.", "warning");
        }
      } catch (error) {
        console.error("Image analysis error:", error);
        setImageAnalysis(null);
        addNotification("Error analyzing image.", "warning");
      } finally {
        setAnalyzingImage(false);
      }
    };
    reader.readAsDataURL(file);
  };

  return (
    <div className="min-h-screen bg-luxury-bg text-white font-sans selection:bg-white selection:text-black premium-bg relative overflow-hidden">
      <CursorFollower />
      {/* Background Grid Pattern for Intensity */}
      <div className="absolute inset-0 pointer-events-none opacity-[0.03] z-0" style={{ backgroundImage: 'radial-gradient(circle at 2px 2px, white 1px, transparent 0)', backgroundSize: '40px 40px' }}></div>
      <div className="absolute inset-0 pointer-events-none opacity-[0.02] z-0" style={{ backgroundImage: 'linear-gradient(to right, white 1px, transparent 1px), linear-gradient(to bottom, white 1px, transparent 1px)', backgroundSize: '160px 160px' }}></div>

      {/* Top Market Ticker - High Intensity */}
      <div className="w-full bg-black/80 border-b border-white/5 backdrop-blur-xl py-1.5 overflow-hidden z-50 relative">
        <div className="flex whitespace-nowrap animate-marquee">
          {(tickerData.length > 0 ? [...tickerData, ...tickerData] : [...INDIAN_INDICES, ...INDIAN_INDICES]).map((s, i) => (
            <button 
              key={`${s.symbol}-${i}`} 
              onClick={() => handleRecommendationClick(s.symbol)}
              className="flex items-center gap-4 px-6 border-r border-white/5 hover:bg-white/5 transition-colors cursor-pointer group"
            >
              <span className="text-[11px] font-mono font-bold text-white/40 group-hover:text-luxury-accent transition-colors">{s.symbol.startsWith('^') ? s.symbol : s.symbol.split('.')[0]}</span>
              <span className={`text-[11px] font-mono ${s.changePercent >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                {s.changePercent >= 0 ? '+' : ''}{(s.changePercent || 0).toFixed(2)}%
              </span>
              <span className="text-[11px] font-mono text-white/20">{(s.price || 0).toFixed(2)}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Navigation Rail / Header */}
      <motion.header 
        initial={{ opacity: 0, y: -20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 1, ease: [0.22, 1, 0.36, 1] }}
        className="border-b border-luxury-border px-8 py-6 flex items-center justify-between"
      >
        <div className="flex items-center gap-12">
          <motion.h1 
            onClick={() => setSymbol(null)}
            className="text-3xl font-serif italic tracking-tighter cursor-pointer glow-text"
          >
            Sentix
          </motion.h1>
          
          {symbol && (
            <div className="hidden xl:flex items-center gap-4 pl-8 border-l border-white/10">
              <div className="flex flex-col">
                <div className="flex items-center gap-2">
                  <span className="text-lg font-bold tracking-tight">{symbol.split('.')[0]}</span>
                  <span className="text-[10px] font-mono text-white/40 uppercase truncate max-w-[150px]">
                    {POPULAR_INDIAN_STOCKS.find(s => s.symbol === symbol)?.name || symbol}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <div className={`w-1.5 h-1.5 rounded-full ${isIndianMarketOpen() ? 'bg-emerald-500 animate-pulse' : 'bg-rose-500'}`}></div>
                  <span className={`text-[9px] font-mono uppercase tracking-widest ${isIndianMarketOpen() ? 'text-emerald-400' : 'text-rose-400'}`}>
                    {isIndianMarketOpen() ? 'Live Market' : 'Market Closed'}
                  </span>
                </div>
              </div>
            </div>
          )}

          <nav className="hidden md:flex items-center gap-8">
            <button onClick={() => setSymbol(null)} className="text-xs tracking-[0.2em] opacity-40 hover:opacity-100 transition-opacity uppercase font-medium">
              HOME
            </button>
            {symbol && prediction && (
              <div className={`flex items-center gap-2 px-3 py-1 rounded-full border ${
                prediction.trend === 'Up' ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-400' : 
                prediction.trend === 'Down' ? 'bg-rose-500/10 border-rose-500/20 text-rose-400' : 
                'bg-white/5 border-white/10 text-white/40'
              }`}>
                <div className={`w-1.5 h-1.5 rounded-full animate-pulse ${
                  prediction.trend === 'Up' ? 'bg-emerald-400' : 
                  prediction.trend === 'Down' ? 'bg-rose-400' : 'bg-white/40'
                }`}></div>
                <span className="text-[11px] font-mono font-bold tracking-widest uppercase">
                  AI: {prediction.trend === 'Up' ? 'BUY' : prediction.trend === 'Down' ? 'SELL' : 'HOLD'}
                </span>
              </div>
            )}
            {symbol && (
              <div className="relative group flex items-center gap-2">
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3 h-3 text-white/20 group-focus-within:text-luxury-accent transition-colors" />
                  <input 
                    type="text"
                    placeholder="SWITCH ASSET..."
                    value={headerInputValue}
                    onChange={(e) => {
                      const val = e.target.value;
                      setHeaderInputValue(val);
                      if (val.length >= 2) {
                        const filtered = POPULAR_INDIAN_STOCKS.filter(s => 
                          s.symbol.toLowerCase().includes(val.toLowerCase()) || 
                          s.name.toLowerCase().includes(val.toLowerCase())
                        ).slice(0, 5);
                        setHeaderRecommendations(filtered);
                        setShowHeaderRecommendations(true);
                      } else {
                        setShowHeaderRecommendations(false);
                      }
                    }}
                    onBlur={() => setTimeout(() => setShowHeaderRecommendations(false), 200)}
                    className="bg-white/5 border border-white/10 rounded-full py-2 pl-9 pr-4 text-xs tracking-[0.1em] focus:outline-none focus:border-luxury-accent/50 focus:bg-white/10 transition-all w-64 uppercase font-bold"
                    onKeyDown={async (e) => {
                      if (e.key === 'Enter') {
                        const val = headerInputValue.trim().toUpperCase();
                        if (val) {
                          setLoading(true);
                          setError(null);
                          setShowHeaderRecommendations(false);
                          try {
                            const liveData = await getLivePrice(val);
                            if (!liveData || liveData.price === -1) {
                              throw new Error("INVALID_STOCK");
                            }
                            setSymbol(val);
                            setHeaderInputValue('');
                          } catch (err) {
                            setError("WRONG STOCK: This asset was not found on NSE or BSE.");
                          } finally {
                            setLoading(false);
                          }
                        }
                      }
                    }}
                  />
                  <AnimatePresence>
                    {showHeaderRecommendations && headerRecommendations.length > 0 && (
                      <motion.div
                        initial={{ opacity: 0, y: 10 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: 10 }}
                        className="absolute top-full left-0 w-full mt-2 bg-black/90 border border-white/10 rounded-xl overflow-hidden z-50 shadow-2xl backdrop-blur-xl"
                      >
                        {headerRecommendations.map((s) => (
                          <button
                            key={s.symbol}
                            onClick={() => handleHeaderRecommendationClick(s.symbol)}
                            className="w-full px-4 py-2 text-left hover:bg-white/5 flex items-center justify-between group transition-colors"
                          >
                            <div className="flex flex-col">
                              <span className="text-xs font-bold text-white group-hover:text-luxury-accent">{s.symbol.startsWith('^') ? s.symbol : s.symbol.split('.')[0]}</span>
                              <span className="text-[10px] text-white/40 truncate w-40">{s.name}</span>
                            </div>
                            <ChevronRight className="w-3 h-3 text-white/20 group-hover:text-luxury-accent transition-colors" />
                          </button>
                        ))}
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
                <div className="h-4 w-px bg-white/10 mx-2"></div>
              </div>
            )}
          </nav>
        </div>
        
        <div className="flex items-center gap-6">
          <div className="hidden lg:flex items-center gap-8 mr-4">
            <div className="flex flex-col items-end">
              <span className="text-[8px] font-mono text-white/20 uppercase tracking-widest">Global Status</span>
              <span className="text-[9px] font-mono text-emerald-400 uppercase">Operational</span>
            </div>
            <div className="flex flex-col items-end">
              <span className="text-[8px] font-mono text-white/20 uppercase tracking-widest">Neural Load</span>
              <span className="text-[9px] font-mono text-luxury-accent uppercase">Minimal</span>
            </div>
          </div>
          <div className="flex flex-col items-center gap-1">
            <button 
              onClick={handleOpenKeySelector}
              className={`flex items-center gap-2 px-3 py-1 rounded-full border transition-all duration-500 ${
                hasProfessionalKey 
                  ? 'border-emerald-500/30 bg-emerald-500/5 text-emerald-400' 
                  : 'border-luxury-accent/30 bg-luxury-accent/5 text-luxury-accent hover:bg-luxury-accent/10'
              }`}
            >
              <div className={`w-1.5 h-1.5 rounded-full ${hasProfessionalKey ? 'bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.5)]' : 'bg-luxury-accent animate-pulse'}`}></div>
              <span className="text-[9px] uppercase tracking-[0.2em] font-medium">
                {hasProfessionalKey ? 'Professional Access' : 'Connect Pro Key'}
              </span>
            </button>
          </div>
        </div>
      </motion.header>

      <main className="p-4 md:p-6 lg:p-8">
        {!symbol ? (
          <motion.div 
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="flex flex-col items-center justify-center py-32 space-y-12 max-w-4xl mx-auto"
          >
            <div className="text-center space-y-6">
              <div className="flex items-center justify-center gap-3 mb-2">
                <h1 className="text-8xl font-serif italic tracking-tighter glow-text">Sentix</h1>
                <div className="flex items-end gap-1.5 h-16 mb-2">
                  <div className="w-2.5 bg-emerald-500/20 h-1/3 rounded-t-sm"></div>
                  <div className="w-2.5 bg-emerald-500/40 h-2/3 rounded-t-sm"></div>
                  <div className="w-2.5 bg-emerald-500 h-full rounded-t-sm shadow-[0_0_20px_rgba(16,185,129,0.4)]"></div>
                </div>
              </div>
              <p className="text-xl font-light tracking-wide text-white/40">
                Institutional analysis and sentiment tool for investors in India.
              </p>
            </div>

            <div className="w-full max-w-2xl space-y-8">
              <form onSubmit={handleSearch} className="relative group">
                <div className="absolute inset-y-0 left-6 flex items-center pointer-events-none">
                  {loading ? (
                    <Loader2 className="w-6 h-6 text-luxury-accent animate-spin" />
                  ) : (
                    <Search className="w-6 h-6 text-white/20 group-focus-within:text-luxury-accent transition-colors" />
                  )}
                </div>
                <input 
                  type="text" 
                  value={inputSymbol}
                  onChange={(e) => {
                    const val = e.target.value;
                    setInputSymbol(val);
                    if (error) setError(null);
                    
                    if (val.length >= 2) {
                      const filtered = POPULAR_INDIAN_STOCKS.filter(s => 
                        s.symbol.toLowerCase().includes(val.toLowerCase()) || 
                        s.name.toLowerCase().includes(val.toLowerCase())
                      ).slice(0, 5);
                      setRecommendations(filtered);
                      setShowRecommendations(true);
                    } else {
                      setShowRecommendations(false);
                    }
                  }}
                  onBlur={() => setTimeout(() => setShowRecommendations(false), 200)}
                  placeholder="Search for a company (e.g. RELIANCE, TCS, HDFCBANK)"
                  className={`w-full bg-white/5 border rounded-xl py-6 pl-16 pr-24 text-xl focus:outline-none transition-all shadow-2xl placeholder:text-white/10 uppercase tracking-widest ${
                    error?.includes("WRONG STOCK") || error?.includes("COULD NOT IDENTIFY")
                      ? 'border-rose-500/50 bg-rose-500/5 animate-shake' 
                      : 'border-white/10 focus:border-luxury-accent/50 focus:bg-white/[0.07]'
                  }`}
                />
                <div className="absolute inset-y-0 right-6 flex items-center gap-4">
                  <input 
                    type="file" 
                    ref={imageInputRef}
                    onChange={handleSearchImageUpload}
                    accept="image/*"
                    className="hidden"
                  />
                  <button
                    type="button"
                    onClick={() => imageInputRef.current?.click()}
                    disabled={isIdentifyingStock || loading}
                    className="p-2 hover:bg-white/10 rounded-full transition-colors group/cam"
                    title="Search by chart image"
                  >
                    {isIdentifyingStock ? (
                      <Loader2 className="w-6 h-6 text-luxury-accent animate-spin" />
                    ) : (
                      <Camera className="w-6 h-6 text-white/20 group-hover/cam:text-luxury-accent transition-colors" />
                    )}
                  </button>
                </div>
                <AnimatePresence>
                  {showRecommendations && recommendations.length > 0 && (
                    <motion.div
                      initial={{ opacity: 0, y: 20 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: 20 }}
                      className="absolute top-full left-0 w-full mt-4 bg-black/90 border border-white/10 rounded-2xl overflow-hidden z-50 shadow-2xl backdrop-blur-2xl"
                    >
                      {recommendations.map((s) => (
                        <button
                          key={s.symbol}
                          onClick={() => handleRecommendationClick(s.symbol)}
                          className="w-full px-8 py-4 text-left hover:bg-white/5 flex items-center justify-between group transition-colors"
                        >
                          <div className="flex flex-col">
                            <span className="text-lg font-bold text-white group-hover:text-luxury-accent">{s.symbol.startsWith('^') ? s.symbol : s.symbol.split('.')[0]}</span>
                            <span className="text-sm text-white/40">{s.name}</span>
                          </div>
                          <ChevronRight className="w-6 h-6 text-white/20 group-hover:text-luxury-accent transition-colors" />
                        </button>
                      ))}
                    </motion.div>
                  )}
                </AnimatePresence>
                {error && (
                  <div className="absolute -bottom-8 left-0 flex items-center gap-4">
                    <span className="text-xs text-rose-400 font-mono tracking-widest uppercase">
                      {error}
                    </span>
                    {error.includes("quota") && (
                      <button 
                        onClick={() => symbol ? fetchData(symbol) : handleSearch({ preventDefault: () => {} } as any)}
                        className="text-xs text-luxury-accent hover:underline font-mono tracking-widest uppercase"
                      >
                        [Retry Analysis]
                      </button>
                    )}
                  </div>
                )}
              </form>

              <div className="flex flex-wrap items-center justify-center gap-3 pt-4">
                <span className="text-sm font-light text-white/20 mr-2">Or analyse:</span>
                {['RELIANCE', 'TCS', 'HDFCBANK', 'INFY', 'ICICIBANK', 'SBIN', 'BHARTIARTL', 'LICI'].map((s) => (
                  <button
                    key={s}
                    disabled={loading}
                    onClick={async () => {
                      setInputSymbol(s);
                      setLoading(true);
                      setError(null);
                      try {
                        const liveData = await getLivePrice(s);
                        if (liveData && liveData.price !== -1) {
                          setSymbol(s);
                        } else {
                          setError("WRONG STOCK: This asset was not found on NSE or BSE.");
                        }
                      } catch (e) {
                        setError("Strategic analysis interrupted.");
                      } finally {
                        setLoading(false);
                      }
                    }}
                    className="px-4 py-1.5 rounded-lg border border-white/5 bg-white/[0.02] text-xs font-medium text-white/40 hover:border-luxury-accent/30 hover:text-luxury-accent hover:bg-luxury-accent/5 transition-all disabled:opacity-50"
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>
          </motion.div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 lg:gap-8">
            {/* Performance Visualization */}
            <motion.div 
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.4, duration: 0.8 }}
              className="lg:col-span-8 space-y-6"
            >
              {/* AI Signal Center - Separate from Chart */}
              <motion.div 
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                className="grid grid-cols-2 md:grid-cols-4 gap-2"
              >
                <div className="luxury-card p-2.5 flex flex-col justify-center items-center text-center space-y-0.5 relative overflow-hidden group">
                  <div className="absolute top-0 left-0 w-full h-0.5 bg-white/5 group-hover:bg-white/20 transition-colors"></div>
                  <div className="luxury-label opacity-40 text-[7px]">Technical Signal</div>
                  {stockData.length > 0 && stockData[stockData.length - 1].signal ? (
                    <div className={`text-3xl font-bold tracking-tighter ${
                      stockData[stockData.length - 1].signal === 'BUY' ? 'text-emerald-400' : 'text-rose-400'
                    }`}>
                      {stockData[stockData.length - 1].signal}
                    </div>
                  ) : (
                    <div className="text-3xl font-bold tracking-tighter text-white/20">NEUTRAL</div>
                  )}
                  <div className="text-[7px] font-mono opacity-30 uppercase">Indicator Based</div>
                </div>

                <div className="luxury-card p-2.5 flex flex-col justify-center items-center text-center space-y-0.5 border-luxury-accent/20 bg-luxury-accent/[0.02] relative overflow-hidden group">
                  <div className="absolute top-0 left-0 w-full h-0.5 bg-luxury-accent/20 group-hover:bg-luxury-accent/40 transition-colors"></div>
                  <div className="luxury-label text-luxury-accent text-[7px]">AI Strategic Signal</div>
                  {prediction ? (
                    <div className={`text-3xl font-bold tracking-tighter ${
                      prediction.trend === 'Up' ? 'text-emerald-400' : 
                      prediction.trend === 'Down' ? 'text-rose-400' : 'text-white/40'
                    }`}>
                      {prediction.trend === 'Up' ? 'BUY' : prediction.trend === 'Down' ? 'SELL' : 'HOLD'}
                    </div>
                  ) : (
                    <div className="flex items-center gap-2">
                      <Loader2 className="w-3 h-3 animate-spin text-luxury-accent" />
                      <span className="text-[11px] font-mono text-luxury-accent animate-pulse uppercase tracking-widest">Analyzing...</span>
                    </div>
                  )}
                  <div className="text-[7px] font-mono text-luxury-accent/50 uppercase">Neural Projection</div>
                </div>

                <div className="luxury-card p-2.5 flex flex-col justify-center items-center text-center space-y-0.5 relative overflow-hidden group">
                  <div className="absolute top-0 left-0 w-full h-0.5 bg-white/5 group-hover:bg-white/20 transition-colors"></div>
                  <div className="luxury-label opacity-40 text-[7px]">Market Sentiment</div>
                  <div className={`text-3xl font-bold tracking-tighter ${
                    sentimentBreakdown.combined.positive > 50 ? 'text-emerald-400' : 
                    sentimentBreakdown.combined.negative > 50 ? 'text-rose-400' : 'text-white/60'
                  }`}>
                    {sentimentBreakdown.combined.positive > 60 ? 'BULLISH' : 
                     sentimentBreakdown.combined.negative > 60 ? 'BEARISH' : 'STABLE'}
                  </div>
                  <div className="text-[7px] font-mono opacity-30 uppercase">Social & News</div>
                </div>

                <div className="luxury-card p-2.5 flex flex-col justify-center items-center text-center space-y-0.5 relative overflow-hidden group">
                  <div className="absolute top-0 left-0 w-full h-0.5 bg-white/5 group-hover:bg-white/20 transition-colors"></div>
                  <div className="luxury-label opacity-40 text-[7px]">Confidence Index</div>
                  <div className="text-3xl font-bold tracking-tighter text-white">
                    {prediction ? `${prediction.confidence}%` : '--'}
                  </div>
                  <div className="text-[7px] font-mono opacity-30 uppercase">Reliability Score</div>
                </div>
              </motion.div>

              <motion.section 
                ref={chartRef}
                whileHover={{ borderColor: 'rgba(255,255,255,0.15)' }}
                className="space-y-4 p-4 luxury-card overflow-hidden relative"
              >
                <div className="flex items-end justify-between border-b border-luxury-border pb-3">
                  <div>
                    <div className="flex items-center gap-3">
                      <h2 className="text-4xl font-serif italic mb-1">{symbol.startsWith('^') ? symbol : symbol.split('.')[0]}</h2>
                      {isRealData && (
                        <span className="text-[8px] bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 px-2 py-0.5 rounded-full font-mono tracking-widest uppercase">
                          Real Historical Data
                        </span>
                      )}
                      <div className="flex items-center gap-2 ml-4">
                        <button 
                          onClick={() => setIsAlertModalOpen(true)}
                          className="p-2 rounded-full bg-white/5 border border-white/10 hover:border-luxury-accent/50 hover:bg-luxury-accent/5 transition-all group"
                          title="Set Price Alert"
                        >
                          <Bell className="w-3.5 h-3.5 text-white/40 group-hover:text-luxury-accent transition-colors" />
                        </button>
                        <button 
                          onClick={handleAnalyzeChart}
                          disabled={analyzingChart}
                          className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-luxury-accent/10 border border-luxury-accent/20 hover:bg-luxury-accent/20 transition-all group disabled:opacity-50"
                          title="AI Chart Analysis"
                        >
                          {analyzingChart ? (
                            <Loader2 className="w-3.5 h-3.5 text-luxury-accent animate-spin" />
                          ) : (
                            <Zap className="w-3.5 h-3.5 text-luxury-accent" />
                          )}
                          <span className="text-[11px] font-mono font-bold tracking-widest uppercase text-luxury-accent">AI Analyze</span>
                        </button>
                        
                        {(prediction || imageAnalysis) && (
                          <button 
                            onClick={() => setShowAIInsights(!showAIInsights)}
                            className={`flex items-center gap-2 px-3 py-1.5 rounded-full border transition-all group ${
                              showAIInsights 
                                ? 'bg-luxury-accent text-black border-luxury-accent' 
                                : 'bg-white/5 border-white/10 text-white/60 hover:border-white/30'
                            }`}
                          >
                            <Info className="w-3.5 h-3.5" />
                            <span className="text-[9px] font-mono font-bold tracking-widest uppercase">
                              {showAIInsights ? 'Hide Insights' : 'AI Insights'}
                            </span>
                          </button>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className="luxury-label">Market Performance</span>
                      <span className="text-xs font-mono opacity-30 uppercase">{timeRange} WINDOW</span>
                    </div>
                    <div className="flex flex-wrap items-center gap-4 mt-2">
                      <div className="flex items-center bg-white/5 rounded-full p-1 border border-white/10 mr-2">
                        {(['1D', '1W', '1M', '1Y', '5Y', 'ALL'] as const).map((range) => (
                          <button
                            key={range}
                            onClick={() => setTimeRange(range)}
                            className={`text-[9px] font-mono px-3 py-1 rounded-full transition-all ${
                              timeRange === range 
                                ? 'bg-luxury-accent text-black font-bold' 
                                : 'text-white/40 hover:text-white'
                            }`}
                          >
                            {range === 'ALL' ? 'ALL TIME' : range}
                          </button>
                        ))}
                      </div>
                      <div className="h-4 w-[1px] bg-white/10 mx-1"></div>
                      {[
                        { id: 'sma', label: 'SMA (14)' },
                        { id: 'ema', label: 'EMA (14)' },
                        { id: 'rsi', label: 'RSI' },
                        { id: 'macd', label: 'MACD' }
                      ].map((indicator) => (
                        <button
                          key={indicator.id}
                          onClick={() => setActiveIndicators(prev => ({ ...prev, [indicator.id]: !prev[indicator.id as keyof typeof prev] }))}
                          className={`text-[9px] font-mono tracking-widest uppercase px-3 py-1 rounded-full border transition-all ${
                            activeIndicators[indicator.id as keyof typeof activeIndicators]
                              ? 'bg-luxury-accent/20 border-luxury-accent text-luxury-accent'
                              : 'bg-white/5 border-white/10 text-white/30 hover:border-white/20'
                          }`}
                        >
                          {indicator.label}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="flex items-center justify-end gap-2 mb-2">
                      <button 
                        onClick={() => fetchData(symbol!)}
                        disabled={loading}
                        className="p-1.5 rounded-full hover:bg-white/5 transition-colors group mr-1"
                        title="Force Refresh"
                      >
                        <Loader2 className={`w-3 h-3 text-luxury-accent ${loading ? 'animate-spin' : 'opacity-30 group-hover:opacity-100'}`} />
                      </button>
                      <span className="relative flex h-2 w-2">
                        <span className={`animate-ping absolute inline-flex h-full w-full rounded-full ${syncing ? 'bg-amber-400' : (isIndianMarketOpen() ? 'bg-emerald-400' : 'bg-rose-400')} opacity-75`}></span>
                        <span className={`relative inline-flex rounded-full h-2 w-2 ${syncing ? 'bg-amber-500' : (isIndianMarketOpen() ? 'bg-emerald-500' : 'bg-rose-500')}`}></span>
                      </span>
                      <span className={`luxury-label ${syncing ? '!text-amber-500' : (isIndianMarketOpen() ? '!text-emerald-500' : '!text-rose-500')} font-bold`}>
                        {syncing ? 'Syncing...' : (isIndianMarketOpen() ? 'Live Market' : 'Market Closed')}
                      </span>
                    </div>
                    {lastSync && (
                      <div className="text-[10px] opacity-30 font-mono mb-2 uppercase tracking-widest text-right">
                        Last Sync: {lastSync}
                      </div>
                    )}
                    {error && (
                      <div className="flex flex-col items-end gap-1 mb-2">
                        <div className="text-xs text-rose-400 font-mono uppercase tracking-widest text-right">
                          {error}
                        </div>
                        {error.includes("quota") && (
                          <button 
                            onClick={() => fetchData(symbol!)}
                            className="text-xs text-luxury-accent hover:underline font-mono uppercase tracking-widest"
                          >
                            [Retry Sync]
                          </button>
                        )}
                      </div>
                    )}
                    <motion.div 
                      key={displayPrice}
                      initial={{ opacity: 0.8 }}
                      animate={{ opacity: 1 }}
                      className="text-6xl font-light tracking-tighter mb-1 glow-text"
                    >
                      ₹{(displayPrice || livePrice?.price || stockData[stockData.length - 1]?.price)?.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                    </motion.div>
                    <div className={`text-xs font-mono tracking-widest ${
                      (livePrice?.changePercent || 0) >= 0 ? 'text-emerald-400' : 'text-rose-400'
                    }`}>
                      {(livePrice?.changePercent || 0) >= 0 ? '+' : ''}
                      {livePrice?.changePercent ? `${livePrice.changePercent}%` : '1.20%'}
                    </div>
                  </div>
                </div>
                
                <div className="h-[450px] w-full relative">
                  {/* Pattern Legend */}
                  <div className="absolute bottom-4 left-4 z-10 flex flex-wrap gap-3 pointer-events-none">
                    <div className="flex items-center gap-1.5 bg-black/60 backdrop-blur-md px-2 py-1 rounded border border-white/5">
                      <div className="w-2 h-2 rounded-full bg-emerald-500"></div>
                      <span className="text-[8px] font-mono text-white/60 uppercase tracking-widest">Bullish Pattern</span>
                    </div>
                    <div className="flex items-center gap-1.5 bg-black/60 backdrop-blur-md px-2 py-1 rounded border border-white/5">
                      <div className="w-2 h-2 rounded-full bg-rose-500"></div>
                      <span className="text-[8px] font-mono text-white/60 uppercase tracking-widest">Bearish Pattern</span>
                    </div>
                    <div className="flex items-center gap-1.5 bg-black/60 backdrop-blur-md px-2 py-1 rounded border border-white/5">
                      <div className="w-2 h-0.5 bg-emerald-500/40 border-t border-dashed border-emerald-500/60"></div>
                      <span className="text-[8px] font-mono text-white/60 uppercase tracking-widest">Support Level</span>
                    </div>
                    <div className="flex items-center gap-1.5 bg-black/60 backdrop-blur-md px-2 py-1 rounded border border-white/5">
                      <div className="w-2 h-0.5 bg-rose-500/40 border-t border-dashed border-rose-500/60"></div>
                      <span className="text-[8px] font-mono text-white/60 uppercase tracking-widest">Resistance Level</span>
                    </div>
                  </div>

                  <AnimatePresence>
                    {showAIInsights && (prediction || imageAnalysis) && (
                      <motion.div
                        initial={{ opacity: 0, x: 20, scale: 0.95 }}
                        animate={{ opacity: 1, x: 0, scale: 1 }}
                        exit={{ opacity: 0, x: 20, scale: 0.95 }}
                        className="absolute top-4 right-4 w-80 z-20 luxury-card bg-black/90 backdrop-blur-2xl border-luxury-accent/40 p-6 shadow-[0_20px_50px_rgba(0,0,0,0.5)] space-y-5 max-h-[410px] overflow-y-auto custom-scrollbar"
                      >
                        <div className="flex items-center justify-between border-b border-white/10 pb-3">
                          <div className="flex items-center gap-2">
                            <Zap className="w-4 h-4 text-luxury-accent" />
                            <span className="luxury-label text-luxury-accent font-bold tracking-[0.2em]">Neural Insights</span>
                          </div>
                          <button onClick={() => setShowAIInsights(false)} className="text-white/20 hover:text-white transition-colors">
                            <Plus className="w-4 h-4 rotate-45" />
                          </button>
                        </div>
                        
                        {prediction && (
                          <div className="space-y-4">
                            <div className="flex items-center justify-between">
                              <span className="text-xs font-mono text-white/40 uppercase tracking-widest">Strategic Outlook</span>
                              <div className={`px-3 py-1 rounded-full text-xs font-bold tracking-widest ${
                                prediction.trend === 'Up' ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30' : 
                                prediction.trend === 'Down' ? 'bg-rose-500/20 text-rose-400 border border-rose-500/30' : 'bg-white/10 text-white/60 border border-white/20'
                              }`}>
                                {prediction.trend.toUpperCase()}
                              </div>
                            </div>
                            
                            <div className="relative">
                              <div className="absolute -left-3 top-0 bottom-0 w-0.5 bg-luxury-accent/30"></div>
                              <p className="text-[11px] leading-relaxed text-white/80 italic pl-2">
                                "{prediction.reasoning}"
                              </p>
                            </div>

                            <div className="grid grid-cols-2 gap-4 pt-2 border-t border-white/5">
                              <div className="space-y-1">
                                <span className="text-[11px] font-mono text-white/30 uppercase">Confidence</span>
                                <div className="text-sm font-bold text-white">{prediction.confidence}%</div>
                              </div>
                              {prediction.targetPrice && (
                                <div className="space-y-1 text-right">
                                  <span className="text-[11px] font-mono text-white/30 uppercase">Target</span>
                                  <div className="text-sm font-bold text-luxury-accent">₹{prediction.targetPrice.toLocaleString('en-IN')}</div>
                                </div>
                              )}
                            </div>
                          </div>
                        )}

                        {imageAnalysis && (
                          <div className="space-y-4 pt-4 border-t border-white/10">
                            <div className="flex items-center justify-between">
                              <div className="flex items-center gap-2">
                                <BarChart3 className="w-3 h-3 text-white/40" />
                                <span className="text-xs font-mono text-white/40 uppercase tracking-widest">Visual Patterns</span>
                              </div>
                              <div className="group relative">
                                <Info className="w-3 h-3 text-white/20 cursor-help" />
                                <div className="absolute right-0 bottom-full mb-2 w-48 p-3 bg-black border border-white/10 rounded-lg shadow-2xl opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none z-50">
                                  <div className="text-[11px] font-bold text-luxury-accent mb-2 uppercase tracking-widest">Pattern Guide</div>
                                  <div className="space-y-2">
                                    <div>
                                      <div className="text-[8px] text-white font-bold">Head & Shoulders</div>
                                      <div className="text-[7px] text-white/40">Bearish reversal pattern signaling a peak.</div>
                                    </div>
                                    <div>
                                      <div className="text-[8px] text-white font-bold">Double Bottom</div>
                                      <div className="text-[7px] text-white/40">Bullish reversal pattern signaling a floor.</div>
                                    </div>
                                    <div>
                                      <div className="text-[8px] text-white font-bold">RSI Divergence</div>
                                      <div className="text-[7px] text-white/40">Price/momentum mismatch signaling reversal.</div>
                                    </div>
                                  </div>
                                </div>
                              </div>
                            </div>
                            <div className="space-y-3">
                              {imageAnalysis.patterns.map((p, i) => (
                                <div key={i} className="luxury-card p-3 bg-white/[0.02] border-white/5 hover:border-white/10 transition-colors">
                                  <div className="flex items-center justify-between mb-1">
                                    <div className="text-[10px] font-bold text-white/90">{p.name}</div>
                                    <div className={`text-[8px] font-mono px-1.5 py-0.5 rounded ${
                                      p.type === 'bullish' ? 'text-emerald-400 bg-emerald-400/10' : 'text-rose-400 bg-rose-400/10'
                                    }`}>
                                      {p.type.toUpperCase()}
                                    </div>
                                  </div>
                                  <div className="text-[9px] text-white/40 leading-tight">{p.description}</div>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}
                      </motion.div>
                    )}
                  </AnimatePresence>

                  {displayData.length > 0 ? (
                    <ResponsiveContainer width="100%" height="100%">
                      <ComposedChart data={displayData} margin={{ top: 20, right: 0, left: 0, bottom: 0 }}>
                        <defs>
                          <linearGradient id="luxuryGradient" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="5%" stopColor="#D4AF37" stopOpacity={0.15}/>
                            <stop offset="95%" stopColor="#D4AF37" stopOpacity={0}/>
                          </linearGradient>
                        </defs>
                        <CartesianGrid strokeDasharray="4 4" vertical={false} stroke="rgba(255,255,255,0.02)" />
                        <XAxis 
                          dataKey="date" 
                          axisLine={false} 
                          tickLine={false} 
                          tick={{ fontSize: 9, fill: 'rgba(255,255,255,0.2)', letterSpacing: '0.1em' }}
                          dy={15}
                          minTickGap={100}
                        />
                        <YAxis yAxisId="price" hide domain={['auto', 'auto']} />
                        <YAxis yAxisId="rsi" hide domain={[0, 100]} />
                        <YAxis yAxisId="macd" hide domain={['auto', 'auto']} />
                        
                        {/* AI Analysis Highlights */}
                        {(chartAnalysis || imageAnalysis) && (
                          <>
                            {(chartAnalysis?.supportLevels || imageAnalysis?.supportLevels || []).map((level, idx) => (
                              <ReferenceLine 
                                key={`support-${idx}`} 
                                yAxisId="price" 
                                y={level} 
                                stroke="rgba(16, 185, 129, 0.4)" 
                                strokeDasharray="3 3"
                                label={{ value: 'SUP', position: 'left', fill: 'rgba(16, 185, 129, 0.4)', fontSize: 8 }}
                              />
                            ))}
                            {(chartAnalysis?.resistanceLevels || imageAnalysis?.resistanceLevels || []).map((level, idx) => (
                              <ReferenceLine 
                                key={`res-${idx}`} 
                                yAxisId="price" 
                                y={level} 
                                stroke="rgba(244, 63, 94, 0.4)" 
                                strokeDasharray="3 3"
                                label={{ value: 'RES', position: 'left', fill: 'rgba(244, 63, 94, 0.4)', fontSize: 8 }}
                              />
                            ))}
                            {(chartAnalysis?.patterns || imageAnalysis?.patterns || []).map((pattern, idx) => {
                              if (pattern.startDate && pattern.endDate) {
                                const start = formatDateForChart(pattern.startDate);
                                const end = formatDateForChart(pattern.endDate);
                                return (
                                  <ReferenceArea
                                    key={`pattern-${idx}`}
                                    yAxisId="price"
                                    x1={start}
                                    x2={end}
                                    fill={pattern.type === 'bullish' ? 'rgba(16, 185, 129, 0.05)' : pattern.type === 'bearish' ? 'rgba(244, 63, 94, 0.05)' : 'rgba(255, 255, 255, 0.05)'}
                                    stroke={pattern.type === 'bullish' ? 'rgba(16, 185, 129, 0.2)' : pattern.type === 'bearish' ? 'rgba(244, 63, 94, 0.2)' : 'rgba(255, 255, 255, 0.2)'}
                                    strokeDasharray="3 3"
                                  />
                                );
                              }
                              if (pattern.priceLevel) {
                                return (
                                  <ReferenceLine
                                    key={`pattern-lvl-${idx}`}
                                    yAxisId="price"
                                    y={pattern.priceLevel}
                                    stroke={pattern.type === 'bullish' ? 'rgba(16, 185, 129, 0.3)' : 'rgba(244, 63, 94, 0.3)'}
                                    label={{ value: pattern.name, position: 'right', fill: 'rgba(255,255,255,0.3)', fontSize: 7 }}
                                  />
                                );
                              }
                              return null;
                            })}
                          </>
                        )}

                        <ReferenceLine yAxisId="rsi" y={70} stroke="rgba(255,255,255,0.05)" strokeDasharray="3 3" />
                        <ReferenceLine yAxisId="rsi" y={30} stroke="rgba(255,255,255,0.05)" strokeDasharray="3 3" />
                        <Tooltip 
                          cursor={{ stroke: 'rgba(212, 175, 55, 0.2)', strokeWidth: 1 }}
                          content={({ active, payload }) => {
                            if (active && payload && payload.length) {
                              const data = payload[0].payload;
                              if (!data || typeof data.price !== 'number' || isNaN(data.price)) return null;
                              return (
                                <div className="luxury-card p-4 bg-black/90 border-luxury-accent/30 shadow-2xl space-y-2">
                                  <div className="luxury-label opacity-40">{data.date}</div>
                                  <div className="text-lg font-mono text-white tracking-tighter">
                                    {formatCurrency(data.price)}
                                  </div>
                                  <div className="grid grid-cols-2 gap-x-4 gap-y-1">
                                    {activeIndicators.sma && typeof data.sma === 'number' && !isNaN(data.sma) && (
                                      <div className="flex justify-between gap-2">
                                        <span className="text-[8px] text-blue-400 uppercase">SMA:</span>
                                        <span className="text-[8px] text-white font-mono">{data.sma}</span>
                                      </div>
                                    )}
                                    {activeIndicators.ema && typeof data.ema === 'number' && !isNaN(data.ema) && (
                                      <div className="flex justify-between gap-2">
                                        <span className="text-[8px] text-pink-400 uppercase">EMA:</span>
                                        <span className="text-[8px] text-white font-mono">{data.ema}</span>
                                      </div>
                                    )}
                                    {activeIndicators.rsi && typeof data.rsi === 'number' && !isNaN(data.rsi) && (
                                      <div className="flex justify-between gap-2">
                                        <span className="text-[8px] text-emerald-400 uppercase">RSI:</span>
                                        <span className="text-[8px] text-white font-mono">{data.rsi}</span>
                                      </div>
                                    )}
                                    {activeIndicators.macd && typeof data.macd === 'number' && !isNaN(data.macd) && (
                                      <div className="flex justify-between gap-2">
                                        <span className="text-[8px] text-amber-400 uppercase">MACD:</span>
                                        <span className="text-[8px] text-white font-mono">{data.macd}</span>
                                      </div>
                                    )}
                                    {data.signal && (
                                      <div className={`mt-2 p-2 border-t border-white/10 ${data.signal === 'BUY' ? 'bg-emerald-500/10' : 'bg-rose-500/10'}`}>
                                        <div className={`text-[9px] font-bold uppercase tracking-widest mb-1 ${data.signal === 'BUY' ? 'text-emerald-400' : 'text-rose-400'}`}>
                                          {data.signal} SIGNAL
                                        </div>
                                        <div className="text-[8px] text-white/60 leading-tight">
                                          {data.signalRationale}
                                        </div>
                                      </div>
                                    )}
                                  </div>
                                  <div className="text-[8px] font-mono opacity-20 pt-1 border-t border-white/5 uppercase tracking-widest">
                                    Volume: {(data.volume || 0).toLocaleString()}
                                  </div>
                                </div>
                              );
                            }
                            return null;
                          }}
                        />
                        <Area 
                          type="monotone" 
                          dataKey="price" 
                          stroke="#D4AF37" 
                          strokeWidth={1.5}
                          fillOpacity={1} 
                          fill="url(#luxuryGradient)" 
                          isAnimationActive={false}
                          activeDot={{ r: 4, fill: '#D4AF37', stroke: '#000', strokeWidth: 2 }}
                          yAxisId="price"
                        />
                        {activeIndicators.sma && (
                          <Line 
                            type="monotone" 
                            dataKey="sma" 
                            stroke="#3b82f6" 
                            strokeWidth={1} 
                            dot={false} 
                            yAxisId="price"
                            isAnimationActive={false}
                          />
                        )}
                        {activeIndicators.ema && (
                          <Line 
                            type="monotone" 
                            dataKey="ema" 
                            stroke="#ec4899" 
                            strokeWidth={1} 
                            dot={false} 
                            yAxisId="price"
                            isAnimationActive={false}
                          />
                        )}
                        {activeIndicators.rsi && (
                          <>
                            <Line 
                              type="monotone" 
                              dataKey="rsi" 
                              stroke="#10b981" 
                              strokeWidth={1} 
                              dot={false} 
                              yAxisId="rsi"
                              isAnimationActive={false}
                            />
                          </>
                        )}
                        {activeIndicators.macd && (
                          <>
                            <Bar 
                              dataKey="macdHist" 
                              yAxisId="macd"
                            >
                              {displayData.map((entry, index) => (
                                <Cell 
                                  key={`cell-${index}`} 
                                  fill={(entry.macdHist || 0) >= 0 ? 'rgba(16, 185, 129, 0.4)' : 'rgba(244, 63, 94, 0.4)'} 
                                />
                              ))}
                            </Bar>
                            <Line 
                              type="monotone" 
                              dataKey="macd" 
                              stroke="#f59e0b" 
                              strokeWidth={1} 
                              dot={false} 
                              yAxisId="macd"
                              isAnimationActive={false}
                            />
                            <Line 
                              type="monotone" 
                              dataKey="macdSignal" 
                              stroke="#ef4444" 
                              strokeWidth={1} 
                              dot={false} 
                              yAxisId="macd"
                              isAnimationActive={false}
                            />
                          </>
                        )}
                        {enrichedData.length > 0 && (
                          <Brush 
                            dataKey="date" 
                            height={30} 
                            stroke="#D4AF37" 
                            fill="rgba(0,0,0,0.5)"
                            travellerWidth={10}
                            gap={1}
                            startIndex={enrichedData.length > 100 ? enrichedData.length - 100 : 0}
                          >
                            <AreaChart data={enrichedData}>
                              <Area dataKey="price" fill="#D4AF37" stroke="none" fillOpacity={0.2} />
                            </AreaChart>
                          </Brush>
                        )}
                      </ComposedChart>
                    </ResponsiveContainer>
                  ) : (
                    <div className="h-full w-full flex items-center justify-center border border-white/5 rounded-xl bg-black/20">
                      <div className="flex flex-col items-center gap-3">
                        <Loader2 className="w-8 h-8 text-luxury-accent animate-spin opacity-20" />
                        <span className="text-xs font-mono text-white/20 uppercase tracking-widest">Initializing Data Stream...</span>
                      </div>
                    </div>
                  )}
                </div>
                
                <div className="flex items-center justify-between mt-4 px-2">
                  <div className="flex items-center gap-4">
                    <div className="flex items-center gap-2">
                      <div className="w-2 h-2 rounded-full bg-luxury-accent"></div>
                      <span className="text-xs font-mono text-white/40 uppercase tracking-widest">Price Action</span>
                    </div>
                    <div className="text-[10px] font-mono text-white/20 uppercase tracking-widest italic">
                      Drag the navigator below to zoom & pan
                    </div>
                  </div>
                  <div className="text-[10px] font-mono text-white/40 uppercase tracking-widest">
                    {enrichedData.length} Data Points
                  </div>
                </div>
              </motion.section>

              {/* Intelligence Feeds */}
              <div className="space-y-8">
                {/* Sentiment Breakdown */}
                <section className="luxury-card p-3 space-y-3">
                  <div className="flex items-center justify-between border-b border-luxury-border pb-2">
                    <div className="flex items-center gap-2">
                      <span className="luxury-label">Sentiment Intelligence Hub</span>
                      <div className="px-1.5 py-0.5 rounded-sm bg-luxury-accent/10 border border-luxury-accent/20 text-[7px] font-mono text-luxury-accent uppercase">Live Analysis</div>
                    </div>
                    <BarChart3 className="w-3 h-3 opacity-30" />
                  </div>
                  
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                    {/* Overall Sentiment Gauge */}
                    <div className="flex flex-col items-center justify-center border-r border-white/5 pr-6">
                      <div className="relative w-20 h-20">
                        <svg className="w-full h-full transform -rotate-90">
                          <circle cx="40" cy="40" r="36" stroke="currentColor" strokeWidth="4" fill="transparent" className="text-white/5" />
                          <circle cx="40" cy="40" r="36" stroke="currentColor" strokeWidth="4" fill="transparent" 
                            strokeDasharray={226}
                            strokeDashoffset={226 - (226 * sentimentBreakdown.combined.positive) / 100}
                            className="text-emerald-500 transition-all duration-1000" 
                          />
                        </svg>
                        <div className="absolute inset-0 flex flex-col items-center justify-center">
                          <span className="text-lg font-bold text-white">{sentimentBreakdown.combined.positive}%</span>
                          <span className="text-[10px] text-white/40 uppercase">Bullish</span>
                        </div>
                      </div>
                      <span className="text-[10px] font-mono text-white/30 uppercase mt-2">Aggregated Score</span>
                    </div>

                    {/* News Sentiment */}
                    <div className="space-y-3">
                      <div className="flex items-center justify-between">
                        <h4 className="text-[11px] font-mono uppercase tracking-[0.1em] text-white/40">Financial Media</h4>
                        <span className="text-[11px] font-mono text-emerald-400">{sentimentBreakdown.news.positive}%</span>
                      </div>
                      <div className="h-1.5 w-full bg-white/5 rounded-full overflow-hidden flex">
                        <div style={{ width: `${sentimentBreakdown.news.positive}%` }} className="h-full bg-emerald-500"></div>
                        <div style={{ width: `${sentimentBreakdown.news.neutral}%` }} className="h-full bg-white/10"></div>
                        <div style={{ width: `${sentimentBreakdown.news.negative}%` }} className="h-full bg-rose-500"></div>
                      </div>
                      <div className="flex justify-between text-[10px] font-mono uppercase opacity-20">
                        <span>POS: {sentimentBreakdown.news.positive}%</span>
                        <span>NEG: {sentimentBreakdown.news.negative}%</span>
                      </div>
                    </div>

                    {/* Social Sentiment */}
                    <div className="space-y-3">
                      <div className="flex items-center justify-between">
                        <h4 className="text-[11px] font-mono uppercase tracking-[0.1em] text-white/40">Social Intelligence</h4>
                        <span className="text-[11px] font-mono text-emerald-400">{sentimentBreakdown.social.positive}%</span>
                      </div>
                      <div className="h-1.5 w-full bg-white/5 rounded-full overflow-hidden flex">
                        <div style={{ width: `${sentimentBreakdown.social.positive}%` }} className="h-full bg-emerald-500"></div>
                        <div style={{ width: `${sentimentBreakdown.social.neutral}%` }} className="h-full bg-white/10"></div>
                        <div style={{ width: `${sentimentBreakdown.social.negative}%` }} className="h-full bg-rose-500"></div>
                      </div>
                      <div className="flex justify-between text-[10px] font-mono uppercase opacity-20">
                        <span>POS: {sentimentBreakdown.social.positive}%</span>
                        <span>NEG: {sentimentBreakdown.social.negative}%</span>
                      </div>
                    </div>
                  </div>
                </section>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-8 lg:gap-12">
                {chartAnalysis && (
                  <section className="col-span-1 md:col-span-2 space-y-4 luxury-card p-6 bg-luxury-accent/5 border-luxury-accent/20">
                    <div className="flex items-center justify-between border-b border-luxury-accent/20 pb-3">
                      <div className="flex items-center gap-3">
                        <Zap className="w-4 h-4 text-luxury-accent" />
                        <span className="luxury-label !text-luxury-accent">AI Technical Chart Intelligence</span>
                      </div>
                      <span className="text-[8px] font-mono text-luxury-accent/50 uppercase tracking-widest">Neural Pattern Recognition Active</span>
                    </div>
                    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                      <div className="lg:col-span-2 space-y-4">
                        <div className="prose prose-invert prose-sm max-w-none">
                          <div className="text-sm font-light leading-relaxed text-white/80 bg-black/20 p-4 rounded-xl border border-white/5">
                            <ReactMarkdown>{chartAnalysis.summary}</ReactMarkdown>
                          </div>
                        </div>
                      </div>
                      <div className="space-y-4">
                        <div className="luxury-label opacity-40 text-[9px]">Detected Patterns</div>
                        <div className="space-y-2">
                          {chartAnalysis.patterns.map((pattern, idx) => (
                            <div key={idx} className="p-3 bg-white/5 border border-white/10 rounded-lg space-y-1">
                              <div className="flex items-center justify-between">
                                <span className="text-[10px] font-bold text-white uppercase tracking-wider">{pattern.name}</span>
                                <span className={`text-[8px] font-mono px-1.5 py-0.5 rounded ${
                                  pattern.type === 'bullish' ? 'bg-emerald-500/20 text-emerald-400' : 
                                  pattern.type === 'bearish' ? 'bg-rose-500/20 text-rose-400' : 'bg-white/10 text-white/40'
                                }`}>
                                  {pattern.type}
                                </span>
                              </div>
                              <p className="text-[9px] text-white/60 leading-tight">{pattern.description}</p>
                              <div className="flex items-center gap-2 pt-1">
                                <div className="h-1 flex-1 bg-white/5 rounded-full overflow-hidden">
                                  <div className="h-full bg-luxury-accent" style={{ width: `${pattern.confidence}%` }}></div>
                                </div>
                                <span className="text-[8px] font-mono text-white/30">{pattern.confidence}%</span>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>
                  </section>
                )}
                <section className="space-y-4">
                  <div className="flex items-center justify-between border-b border-luxury-border pb-3">
                    <div className="flex items-center gap-2">
                      <span className="luxury-label">Financial Media Sentiment</span>
                      <div className="w-1 h-1 rounded-full bg-emerald-500 animate-pulse"></div>
                    </div>
                    <Newspaper className="w-3 h-3 opacity-30" />
                  </div>
                  <div className="space-y-6">
                    {sentiments.filter(s => s.source === 'news').map((item, idx) => (
                      <motion.div 
                        key={idx} 
                        initial={{ opacity: 0, x: -10 }}
                        animate={{ opacity: 1, x: 0 }}
                        transition={{ delay: 0.6 + idx * 0.1 }}
                        className="group border-l border-transparent hover:border-luxury-accent pl-4 transition-all duration-300"
                      >
                        <div className="flex justify-between items-center mb-1">
                          <div className="flex items-center gap-2">
                            <span className={`text-[11px] tracking-[0.15em] uppercase font-medium ${
                              item.label === 'Positive' ? 'text-emerald-400' : 
                              item.label === 'Negative' ? 'text-rose-400' : 'text-white/40'
                            }`}>
                              {item.label}
                            </span>
                            {item.sourceName && (
                              <span className="text-[10px] font-mono text-luxury-accent/50 uppercase tracking-widest">
                                • {item.sourceName}
                              </span>
                            )}
                          </div>
                          <span className="text-[11px] font-mono opacity-20 uppercase">{item.timestamp}</span>
                        </div>
                        <p className="text-base font-light leading-relaxed text-white/70 group-hover:text-white transition-colors">
                          {item.text}
                        </p>
                      </motion.div>
                    ))}
                  </div>
                </section>

                <section className="space-y-4">
                  <div className="flex items-center justify-between border-b border-luxury-border pb-3">
                    <div className="flex items-center gap-2">
                      <span className="luxury-label">Social Intelligence Pulse</span>
                      <div className="w-1 h-1 rounded-full bg-blue-400 animate-pulse"></div>
                    </div>
                    <Twitter className="w-3 h-3 opacity-30" />
                  </div>
                  <div className="space-y-6">
                    {sentiments.filter(s => s.source === 'social').map((item, idx) => (
                      <motion.div 
                        key={idx} 
                        initial={{ opacity: 0, x: 10 }}
                        animate={{ opacity: 1, x: 0 }}
                        transition={{ delay: 0.6 + idx * 0.1 }}
                        className="group border-r border-transparent hover:border-luxury-accent pr-4 text-right transition-all duration-300"
                      >
                        <div className="flex justify-between items-center mb-1 flex-row-reverse">
                          <div className="flex items-center gap-2 flex-row-reverse">
                            <span className={`text-[9px] tracking-[0.15em] uppercase font-medium ${
                              item.label === 'Positive' ? 'text-emerald-400' : 
                              item.label === 'Negative' ? 'text-rose-400' : 'text-white/40'
                            }`}>
                              {item.label}
                            </span>
                            {item.sourceName && (
                              <span className="text-[8px] font-mono text-luxury-accent/50 uppercase tracking-widest">
                                {item.sourceName} •
                              </span>
                            )}
                          </div>
                          <span className="text-[9px] font-mono opacity-20 uppercase">{item.timestamp}</span>
                        </div>
                        <p className="text-sm font-serif italic leading-relaxed text-white/50 group-hover:text-white/80 transition-colors">
                          {item.text}
                        </p>
                      </motion.div>
                    ))}
                  </div>
                </section>
              </div>
            </div>
          </motion.div>

            {/* Strategic Sidebar */}
            <motion.div 
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: 0.6, duration: 0.8 }}
              className="lg:col-span-4 space-y-12"
            >
              {/* AI Projection */}
              <motion.section 
                whileHover={{ y: -2 }}
                className="luxury-card p-3 relative overflow-hidden group shadow-2xl"
              >
                {imageAnalysis && !analyzingImage && (
                  <motion.div 
                    initial={{ opacity: 0, scale: 0.9 }}
                    animate={{ opacity: 1, scale: 1 }}
                    className="absolute top-0 right-0 bg-white text-black text-[7px] font-bold px-2 py-0.5 uppercase tracking-widest"
                  >
                    Visual Context
                  </motion.div>
                )}
                
                <div className="luxury-label mb-3">Strategic Forecast</div>
                
                {prediction ? (
                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <motion.div
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        transition={{ duration: 1 }}
                      >
                        <div className="text-5xl font-serif italic tracking-tighter mb-0.5 glow-text">
                          {prediction.trend}
                        </div>
                        <div className="luxury-label opacity-30 text-[7px]">Projected Vector</div>
                      </motion.div>
                      <div className="text-right">
                        <div className="text-5xl font-light tracking-tighter mb-0.5">
                          {prediction.confidence}%
                        </div>
                        <div className="luxury-label opacity-30 text-[7px]">Probability</div>
                      </div>
                    </div>

                    {/* AI Signal Badge */}
                    <div className="flex items-center gap-3 p-2 bg-white/[0.03] border border-white/5 rounded-lg">
                      <div className={`w-8 h-8 rounded-full flex items-center justify-center font-bold text-[8px] ${
                        prediction.trend === 'Up' ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30' : 
                        prediction.trend === 'Down' ? 'bg-rose-500/20 text-rose-400 border border-rose-500/30' : 
                        'bg-white/10 text-white/40 border border-white/20'
                      }`}>
                        {prediction.trend === 'Up' ? 'BUY' : prediction.trend === 'Down' ? 'SELL' : 'HOLD'}
                      </div>
                      <div>
                        <div className="text-[7px] font-mono uppercase tracking-widest text-white/40 mb-0">AI STRATEGIC SIGNAL</div>
                        <div className={`text-[9px] font-bold ${
                          prediction.trend === 'Up' ? 'text-emerald-400' : 
                          prediction.trend === 'Down' ? 'text-rose-400' : 'text-white/60'
                        }`}>
                          {prediction.trend === 'Up' ? 'BULLISH ACCUMULATION' : 
                           prediction.trend === 'Down' ? 'BEARISH DISTRIBUTION' : 
                           'NEUTRAL CONSOLIDATION'}
                        </div>
                      </div>
                    </div>

                    {/* Confidence Progress Bar */}
                    <div className="space-y-3">
                      <div className="flex justify-between items-center">
                        <span className="text-[9px] font-mono uppercase tracking-widest text-white/30">AI Confidence Level</span>
                        <span className="text-[9px] font-mono text-luxury-accent">{prediction.confidence}%</span>
                      </div>
                      <div className="h-1 w-full bg-white/5 rounded-full overflow-hidden">
                        <motion.div 
                          initial={{ width: 0 }}
                          animate={{ width: `${prediction.confidence}%` }}
                          transition={{ duration: 1.5, ease: "easeOut" }}
                          className={`h-full shadow-[0_0_10px_rgba(212,175,55,0.3)] ${
                            prediction.confidence > 70 ? 'bg-luxury-accent' : 
                            prediction.confidence > 40 ? 'bg-amber-500/60' : 'bg-rose-500/40'
                          }`}
                        />
                      </div>
                    </div>

                    <div className="space-y-4">
                      <div className="luxury-label opacity-30 flex justify-between items-center">
                        <span>Analytical Reasoning</span>
                        <button 
                          onClick={() => navigator.clipboard.writeText(prediction.reasoning)}
                          className="opacity-20 hover:opacity-100 transition-opacity"
                          title="Copy Reasoning"
                        >
                          <Copy className="w-3 h-3" />
                        </button>
                      </div>
                      <div className="prose custom-scrollbar max-h-[150px] overflow-y-auto pr-2">
                        <ReactMarkdown>{prediction.reasoning}</ReactMarkdown>
                      </div>
                    </div>

                    {prediction.targetPrice && (
                      <motion.div 
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        className="border-t border-luxury-border pt-4 flex justify-between items-center"
                      >
                        <span className="luxury-label">Target Valuation</span>
                        <span className="text-3xl font-light tracking-tighter text-luxury-accent">₹{prediction.targetPrice}</span>
                      </motion.div>
                    )}

                    {/* Active Alerts Summary */}
                    <div className="pt-4 border-t border-white/5 space-y-3">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <span className="luxury-label opacity-40">Active Price Alerts</span>
                          <div className="w-1 h-1 rounded-full bg-rose-500 animate-pulse"></div>
                        </div>
                        <button 
                          onClick={() => setIsAlertModalOpen(true)}
                          className="text-[8px] font-mono text-luxury-accent hover:underline uppercase tracking-widest"
                        >
                          Manage
                        </button>
                      </div>
                      <div className="space-y-1.5">
                        {alerts.filter(a => a.symbol === symbol).length > 0 ? (
                          <>
                            {alerts.filter(a => a.symbol === symbol).slice(0, 2).map(alert => (
                              <div key={alert.id} className="flex items-center justify-between text-[9px] font-mono text-white/40 bg-white/[0.02] p-2 rounded-lg border border-white/5">
                                <span className="flex items-center gap-2">
                                  <div className={`w-1 h-1 rounded-full ${alert.type === 'above' ? 'bg-emerald-400' : 'bg-rose-400'}`}></div>
                                  {alert.type === 'above' ? 'Above' : 'Below'} ₹{alert.threshold}
                                </span>
                                <span className="opacity-20">Active</span>
                              </div>
                            ))}
                            {alerts.filter(a => a.symbol === symbol).length > 2 && (
                              <button 
                                onClick={() => setIsAlertModalOpen(true)}
                                className="w-full text-center text-[8px] font-mono text-white/20 hover:text-white/40 uppercase tracking-widest pt-1"
                              >
                                + {alerts.filter(a => a.symbol === symbol).length - 2} more alerts
                              </button>
                            )}
                          </>
                        ) : (
                          <div className="text-[9px] font-mono text-white/10 italic py-2">No active alerts for {symbol}</div>
                        )}
                      </div>
                    </div>

                    {/* Social Sentiment Breakdown */}
                    <div className="pt-8 border-t border-white/5 space-y-6">
                      <div className="flex items-center justify-between">
                        <span className="luxury-label opacity-40">Social Sentiment Breakdown</span>
                        <div className="flex items-center gap-2">
                          <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse"></div>
                          <span className="text-[8px] font-mono text-white/20 tracking-widest uppercase">Live Scan</span>
                        </div>
                      </div>
                      
                      <div className="space-y-4">
                        {/* Sentiment Bar */}
                        <div className="h-3 w-full bg-white/5 rounded-full overflow-hidden flex">
                          <motion.div 
                            initial={{ width: 0 }}
                            animate={{ width: '65%' }}
                            transition={{ duration: 1, ease: "easeOut" }}
                            className="h-full bg-emerald-500/60 relative group"
                          >
                            <div className="absolute inset-0 bg-emerald-400/20 animate-pulse"></div>
                          </motion.div>
                          <motion.div 
                            initial={{ width: 0 }}
                            animate={{ width: '20%' }}
                            transition={{ duration: 1, delay: 0.2, ease: "easeOut" }}
                            className="h-full bg-white/20"
                          ></motion.div>
                          <motion.div 
                            initial={{ width: 0 }}
                            animate={{ width: '15%' }}
                            transition={{ duration: 1, delay: 0.4, ease: "easeOut" }}
                            className="h-full bg-rose-500/60"
                          ></motion.div>
                        </div>

                        {/* Legend & Sources */}
                        <div className="grid grid-cols-3 gap-2">
                          <div className="flex flex-col gap-1">
                            <div className="flex items-center gap-1.5">
                              <div className="w-1.5 h-1.5 rounded-full bg-emerald-500"></div>
                              <span className="text-[9px] font-mono text-white/60 uppercase">Positive</span>
                            </div>
                            <span className="text-xs font-mono font-bold pl-3">65%</span>
                          </div>
                          <div className="flex flex-col gap-1 items-center">
                            <div className="flex items-center gap-1.5">
                              <div className="w-1.5 h-1.5 rounded-full bg-white/40"></div>
                              <span className="text-[9px] font-mono text-white/60 uppercase">Neutral</span>
                            </div>
                            <span className="text-xs font-mono font-bold">20%</span>
                          </div>
                          <div className="flex flex-col gap-1 items-end">
                            <div className="flex items-center gap-1.5">
                              <div className="w-1.5 h-1.5 rounded-full bg-rose-500"></div>
                              <span className="text-[9px] font-mono text-white/60 uppercase">Negative</span>
                            </div>
                            <span className="text-xs font-mono font-bold pr-3">15%</span>
                          </div>
                        </div>

                        {/* Source Breakdown */}
                        <div className="pt-2 flex items-center justify-between border-t border-white/5">
                          <div className="flex items-center gap-4">
                            <div className="flex items-center gap-1.5 opacity-40">
                              <Twitter className="w-3 h-3" />
                              <span className="text-[8px] font-mono">1.2k</span>
                            </div>
                            <div className="flex items-center gap-1.5 opacity-40">
                              <MessageSquare className="w-3 h-3" />
                              <span className="text-[8px] font-mono">840</span>
                            </div>
                          </div>
                          <span className="text-[8px] font-mono text-white/20 uppercase tracking-tighter">Mentions / 24h</span>
                        </div>
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="flex flex-col items-center justify-center py-20">
                    <Loader2 className="w-6 h-6 animate-spin opacity-20 mb-4" />
                    <span className="luxury-label opacity-20">Synthesizing Alpha</span>
                  </div>
                )}
              </motion.section>

              {/* Visual Analysis */}
              <section className="space-y-6">
                <div className="luxury-label border-b border-luxury-border pb-3 flex justify-between items-center">
                  <span>Technical Vision</span>
                  <ImageIcon className="w-3 h-3 opacity-30" />
                </div>
                
                <div className="relative group">
                  <input 
                    type="file" 
                    accept="image/*" 
                    onChange={handleImageUpload}
                    className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10"
                  />
                  <motion.div 
                    whileHover={{ backgroundColor: 'rgba(255,255,255,0.02)' }}
                    className="border border-luxury-border border-dashed p-10 flex flex-col items-center justify-center gap-4 transition-all duration-500"
                  >
                    <ImageIcon className="w-6 h-6 opacity-10 group-hover:opacity-40 transition-opacity" />
                    <span className="luxury-label opacity-30 group-hover:opacity-60">Upload Technical Chart</span>
                  </motion.div>
                </div>

                <AnimatePresence mode="wait">
                  {(analyzingImage || imageAnalysis) && (
                    <motion.div 
                      key={analyzingImage ? 'loading' : 'result'}
                      initial={{ opacity: 0, scale: 0.98 }}
                      animate={{ opacity: 1, scale: 1 }}
                      exit={{ opacity: 0, scale: 0.98 }}
                      transition={{ duration: 0.4 }}
                      className="luxury-card p-6"
                    >
                      {analyzingImage ? (
                        <div className="flex items-center gap-3 luxury-label">
                          <Loader2 className="w-3 h-3 animate-spin" />
                          Deconstructing Visual Patterns
                        </div>
                      ) : (
                        <div className="space-y-4">
                          <div className="prose prose-sm max-h-[300px] overflow-y-auto pr-4 custom-scrollbar">
                            <ReactMarkdown>{imageAnalysis?.summary || ""}</ReactMarkdown>
                          </div>
                          {imageAnalysis?.patterns && imageAnalysis.patterns.length > 0 && (
                            <div className="pt-4 border-t border-white/5 space-y-2">
                              <div className="luxury-label opacity-40 text-[8px]">Patterns Identified</div>
                              <div className="grid grid-cols-1 gap-2">
                                {imageAnalysis.patterns.map((p, i) => (
                                  <div key={i} className="flex items-center justify-between p-2 bg-white/[0.02] border border-white/5 rounded-lg">
                                    <span className="text-[9px] font-bold text-white/80">{p.name}</span>
                                    <span className={`text-[8px] font-mono ${p.type === 'bullish' ? 'text-emerald-400' : 'text-rose-400'}`}>
                                      {p.type.toUpperCase()}
                                    </span>
                                  </div>
                                ))}
                              </div>
                            </div>
                          )}
                        </div>
                      )}
                    </motion.div>
                  )}
                </AnimatePresence>
              </section>
            </motion.div>
          </div>
        )}
      </main>

      {/* Notifications */}
      <div className="fixed bottom-8 right-8 z-[100] flex flex-col gap-3 pointer-events-none">
        <AnimatePresence>
          {notifications.map((n) => (
            <motion.div
              key={n.id}
              initial={{ opacity: 0, x: 20, scale: 0.9 }}
              animate={{ opacity: 1, x: 0, scale: 1 }}
              exit={{ opacity: 0, x: 20, scale: 0.9 }}
              className={`pointer-events-auto flex items-center gap-3 px-6 py-4 rounded-xl border shadow-2xl backdrop-blur-xl min-w-[300px] ${
                n.type === 'warning' ? 'bg-rose-500/10 border-rose-500/30 text-rose-400' :
                n.type === 'success' ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400' :
                'bg-white/5 border-white/10 text-white/70'
              }`}
            >
              {n.type === 'warning' ? <AlertCircle className="w-5 h-5" /> : 
               n.type === 'success' ? <CheckCircle2 className="w-5 h-5" /> : 
               <Bell className="w-5 h-5" />}
              <span className="text-xs font-mono tracking-wider uppercase font-bold">{n.message}</span>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>

      {/* Alert Modal */}
      <AnimatePresence>
        {isAlertModalOpen && (
          <div className="fixed inset-0 z-[110] flex items-center justify-center p-6">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setIsAlertModalOpen(false)}
              className="absolute inset-0 bg-black/80 backdrop-blur-sm"
            />
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              className="relative w-full max-w-md bg-luxury-bg border border-white/10 rounded-3xl p-8 shadow-2xl overflow-hidden"
            >
              <div className="absolute top-0 left-0 w-full h-1 bg-luxury-accent/30"></div>
              <div className="flex items-center justify-between mb-8">
                <div className="flex items-center gap-3">
                  <Bell className="w-5 h-5 text-luxury-accent" />
                  <h3 className="text-xl font-serif italic">Set Price Alert</h3>
                </div>
                <button onClick={() => setIsAlertModalOpen(false)} className="text-white/20 hover:text-white transition-colors">
                  <Minus className="w-5 h-5" />
                </button>
              </div>

              <div className="space-y-6">
                <div className="space-y-2">
                  <label className="text-[10px] font-mono text-white/40 uppercase tracking-widest">Target Asset</label>
                  <div className="text-2xl font-serif italic text-white/90">{symbol}</div>
                </div>

                <div className="space-y-2">
                  <label className="text-[10px] font-mono text-white/40 uppercase tracking-widest">Trigger Condition</label>
                  <div className="flex gap-2">
                    <button 
                      onClick={() => setNewAlertType('above')}
                      className={`flex-1 py-3 rounded-xl border transition-all text-[10px] font-mono uppercase tracking-widest ${
                        newAlertType === 'above' ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400' : 'bg-white/5 border-white/10 text-white/30'
                      }`}
                    >
                      Price Above
                    </button>
                    <button 
                      onClick={() => setNewAlertType('below')}
                      className={`flex-1 py-3 rounded-xl border transition-all text-[10px] font-mono uppercase tracking-widest ${
                        newAlertType === 'below' ? 'bg-rose-500/10 border-rose-500/30 text-rose-400' : 'bg-white/5 border-white/10 text-white/30'
                      }`}
                    >
                      Price Below
                    </button>
                  </div>
                </div>

                <div className="space-y-2">
                  <label className="text-[10px] font-mono text-white/40 uppercase tracking-widest">Threshold Price (INR)</label>
                  <input 
                    type="number"
                    value={newAlertThreshold}
                    onChange={(e) => setNewAlertThreshold(e.target.value)}
                    placeholder="e.g. 2500.50"
                    className="w-full bg-white/5 border border-white/10 rounded-xl py-4 px-6 text-xl focus:outline-none focus:border-luxury-accent/50 transition-all placeholder:text-white/5"
                  />
                </div>

                <button 
                  onClick={handleAddAlert}
                  className="w-full py-4 bg-luxury-accent text-black font-bold rounded-xl hover:bg-white transition-all shadow-xl shadow-luxury-accent/20 uppercase tracking-[0.2em] text-xs mt-4"
                >
                  Confirm Alert
                </button>
              </div>

              {/* Active Alerts List */}
              {alerts.filter(a => a.symbol === symbol).length > 0 && (
                <div className="mt-10 pt-8 border-t border-white/5 space-y-4">
                  <div className="flex items-center justify-between mb-4">
                    <label className="text-[10px] font-mono text-white/40 uppercase tracking-widest block">Active Alerts for {symbol}</label>
                    <button 
                      onClick={() => setAlerts(prev => prev.filter(a => a.symbol !== symbol))}
                      className="text-[8px] font-mono text-rose-400/50 hover:text-rose-400 uppercase tracking-widest transition-colors"
                    >
                      Clear All
                    </button>
                  </div>
                  <div className="space-y-3 max-h-40 overflow-y-auto pr-2 custom-scrollbar">
                    {alerts.filter(a => a.symbol === symbol).map((alert) => (
                      <div key={alert.id} className="flex items-center justify-between p-3 rounded-xl bg-white/5 border border-white/5 group">
                        <div className="flex items-center gap-3">
                          <div className={`w-1.5 h-1.5 rounded-full ${alert.type === 'above' ? 'bg-emerald-400' : 'bg-rose-400'}`}></div>
                          <span className="text-[10px] font-mono text-white/70">
                            {alert.type === 'above' ? 'Above' : 'Below'} {alert.threshold}
                          </span>
                        </div>
                        <button onClick={() => handleRemoveAlert(alert.id)} className="opacity-0 group-hover:opacity-100 transition-opacity p-1 hover:text-rose-400">
                          <Trash2 className="w-3 h-3" />
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Footer Section */}
      <footer className="mt-20 border-t border-luxury-border bg-luxury-card/30 backdrop-blur-xl pt-16 pb-12 px-6 md:px-12 lg:px-24">
        <div className="max-w-7xl mx-auto grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-12">
          {/* Brand Column */}
          <div className="space-y-6">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 bg-luxury-accent rounded-lg flex items-center justify-center">
                <BarChart3 className="w-5 h-5 text-black" />
              </div>
              <span className="text-xl font-serif italic tracking-tight">Sentix</span>
            </div>
            <p className="text-sm font-light text-white/50 leading-relaxed max-w-xs">
              Advanced stock analysis and strategic screening tool for the modern investor.
            </p>
            <div className="space-y-2">
              <p className="text-xs font-mono text-white/30 uppercase tracking-widest">
                Sentix Analytics Private Ltd © 2026
              </p>
              <p className="text-xs font-mono text-white/30 flex items-center gap-1.5">
                Made with <Heart className="w-3 h-3 text-rose-500 fill-rose-500" /> in India.
              </p>
            </div>
            <p className="text-xs font-mono text-white/20">
              Data provided by Global Market Intelligence Systems
            </p>
          </div>

          {/* Team Column */}
          <div className="space-y-6">
            <h4 className="text-sm font-mono text-white/80 uppercase tracking-[0.2em]">Team</h4>
            <div className="space-y-6">
              <div className="space-y-2">
                <span className="text-base font-medium text-white/90">About us</span>
                <p className="text-sm font-light text-white/40 leading-relaxed">
                  Sentix is a next-generation market intelligence platform leveraging neural networks to synthesize technical data with global sentiment.
                </p>
              </div>
              <div className="space-y-2">
                <span className="text-base font-medium text-white/90">Support</span>
                <p className="text-sm font-light text-white/40 leading-relaxed">
                  Our institutional-grade support team is available 24/7 for technical integration and strategic data inquiries.
                </p>
              </div>
            </div>
          </div>

          {/* Theme Column */}
          <div className="space-y-6">
            <h4 className="text-sm font-mono text-white/80 uppercase tracking-[0.2em]">Theme</h4>
            <div className="space-y-3">
              <button 
                onClick={() => setTheme('light')}
                className={`w-full flex items-center justify-between px-4 py-3 rounded-xl border transition-all ${theme === 'light' ? 'bg-white text-black border-white' : 'bg-white/5 border-white/10 text-white/50 hover:border-white/30'}`}
              >
                <div className="flex items-center gap-3">
                  <Sun className="w-4 h-4" />
                  <span className="text-sm font-light">Light</span>
                </div>
                {theme === 'light' && <CheckCircle2 className="w-3 h-3" />}
              </button>
              <button 
                onClick={() => setTheme('dark')}
                className={`w-full flex items-center justify-between px-4 py-3 rounded-xl border transition-all ${theme === 'dark' ? 'bg-white text-black border-white' : 'bg-white/5 border-white/10 text-white/50 hover:border-white/30'}`}
              >
                <div className="flex items-center gap-3">
                  <Moon className="w-4 h-4" />
                  <span className="text-sm font-light">Dark</span>
                </div>
                {theme === 'dark' && <CheckCircle2 className="w-3 h-3" />}
              </button>
              <button 
                onClick={() => setTheme('auto')}
                className={`w-full flex items-center justify-between px-4 py-3 rounded-xl border transition-all ${theme === 'auto' ? 'bg-white text-black border-white' : 'bg-white/5 border-white/10 text-white/50 hover:border-white/30'}`}
              >
                <div className="flex items-center gap-3">
                  <Monitor className="w-4 h-4" />
                  <span className="text-sm font-light">Auto</span>
                </div>
                {theme === 'auto' && <CheckCircle2 className="w-3 h-3" />}
              </button>
            </div>
          </div>
        </div>
        
        <div className="max-w-7xl mx-auto mt-20 pt-8 border-t border-white/5 flex flex-col md:flex-row justify-between items-center gap-4">
          <p className="text-xs font-mono text-white/20 uppercase tracking-widest">
            Strategic Market Analysis Platform v2.4.0
          </p>
        </div>
      </footer>
    </div>
  );
};
