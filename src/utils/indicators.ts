import { StockData, PredictionResult } from '../types';

export function calculateSMA(data: StockData[], period: number): (number | null)[] {
  const sma: (number | null)[] = [];
  for (let i = 0; i < data.length; i++) {
    if (i < period - 1) {
      sma.push(null);
    } else {
      const subset = data.slice(i - period + 1, i + 1);
      const validPrices = subset.map(d => d.price).filter(p => !isNaN(p));
      if (validPrices.length < period) {
        sma.push(null);
      } else {
        const sum = validPrices.reduce((acc, curr) => acc + curr, 0);
        sma.push(parseFloat((sum / period).toFixed(2)));
      }
    }
  }
  return sma;
}

export function calculateEMA(data: StockData[], period: number): (number | null)[] {
  const ema: (number | null)[] = [];
  const k = 2 / (period + 1);
  let prevEMA: number | null = null;

  for (let i = 0; i < data.length; i++) {
    const currentPrice = data[i].price;
    if (isNaN(currentPrice)) {
      ema.push(null);
      continue;
    }

    if (i < period - 1) {
      ema.push(null);
    } else if (i === period - 1) {
      const subset = data.slice(0, period);
      const validPrices = subset.map(d => d.price).filter(p => !isNaN(p));
      if (validPrices.length < period) {
        ema.push(null);
      } else {
        const sum = validPrices.reduce((acc, curr) => acc + curr, 0);
        prevEMA = sum / period;
        ema.push(parseFloat(prevEMA.toFixed(2)));
      }
    } else {
      if (prevEMA === null) {
        ema.push(null);
      } else {
        const currentEMA = (currentPrice - prevEMA) * k + prevEMA;
        prevEMA = currentEMA;
        ema.push(parseFloat(currentEMA.toFixed(2)));
      }
    }
  }
  return ema;
}

export function calculateRSI(data: StockData[], period: number = 14): (number | null)[] {
  const rsi: (number | null)[] = [];
  const gains: number[] = [];
  const losses: number[] = [];

  for (let i = 1; i < data.length; i++) {
    const prevPrice = data[i - 1].price;
    const currPrice = data[i].price;
    
    if (isNaN(prevPrice) || isNaN(currPrice)) {
      gains.push(0);
      losses.push(0);
    } else {
      const change = currPrice - prevPrice;
      gains.push(Math.max(0, change));
      losses.push(Math.max(0, -change));
    }
  }

  for (let i = 0; i < data.length; i++) {
    if (i < period) {
      rsi.push(null);
    } else {
      const subsetGains = gains.slice(i - period, i);
      const subsetLosses = losses.slice(i - period, i);
      
      const avgGain = subsetGains.reduce((a, b) => a + b, 0) / period;
      const avgLoss = subsetLosses.reduce((a, b) => a + b, 0) / period;
      
      if (avgLoss === 0) {
        rsi.push(100);
      } else {
        const rs = avgGain / avgLoss;
        rsi.push(parseFloat((100 - 100 / (1 + rs)).toFixed(2)));
      }
    }
  }
  return rsi;
}

export function calculateMACD(data: StockData[]): { macd: (number | null)[], signal: (number | null)[], histogram: (number | null)[] } {
  const ema12 = calculateEMA(data, 12);
  const ema26 = calculateEMA(data, 26);
  const macd: (number | null)[] = [];

  for (let i = 0; i < data.length; i++) {
    if (ema12[i] === null || ema26[i] === null) {
      macd.push(null);
    } else {
      macd.push(parseFloat(((ema12[i] as number) - (ema26[i] as number)).toFixed(2)));
    }
  }

  const macdValues = macd.filter(v => v !== null) as number[];
  if (macdValues.length < 9) {
    return { 
      macd: new Array(data.length).fill(null), 
      signal: new Array(data.length).fill(null), 
      histogram: new Array(data.length).fill(null) 
    };
  }

  const signalValues = calculateEMAFromArray(macdValues, 9);
  const fullSignal: (number | null)[] = new Array(data.length - signalValues.length).fill(null).concat(signalValues);
  
  const histogram: (number | null)[] = [];
  for (let i = 0; i < data.length; i++) {
    if (macd[i] === null || fullSignal[i] === null) {
      histogram.push(null);
    } else {
      histogram.push(parseFloat(((macd[i] as number) - (fullSignal[i] as number)).toFixed(2)));
    }
  }

  return { macd, signal: fullSignal, histogram };
}

function calculateEMAFromArray(data: number[], period: number): number[] {
  const ema: number[] = [];
  const k = 2 / (period + 1);
  
  const initialSMA = data.slice(0, period).reduce((a, b) => a + b, 0) / period;
  let prevEMA = initialSMA;
  ema.push(initialSMA);

  for (let i = period; i < data.length; i++) {
    const currentEMA = (data[i] - prevEMA) * k + prevEMA;
    prevEMA = currentEMA;
    ema.push(parseFloat(currentEMA.toFixed(2)));
  }
  return ema;
}

export function generateSignals(data: StockData[], prediction?: PredictionResult): StockData[] {
  const rsi = calculateRSI(data, 14);
  const { macd, signal: macdSignal } = calculateMACD(data);
  const sma20 = calculateSMA(data, 20);

  const enriched = data.map((item, i) => {
    let signal: 'BUY' | 'SELL' | undefined;
    let rationale: string | undefined;

    const currentRsi = rsi[i];
    const currentMacd = macd[i];
    const currentMacdSignal = macdSignal[i];
    const currentSma = sma20[i];

    if (currentRsi !== null && currentMacd !== null && currentMacdSignal !== null && currentSma !== null) {
      // Buy Signal: RSI Oversold (< 35) AND MACD Bullish Crossover AND Price > SMA20
      if (currentRsi < 35 && currentMacd > currentMacdSignal && item.price > currentSma) {
        signal = 'BUY';
        rationale = `RSI Oversold (${currentRsi.toFixed(0)}) & MACD Bullish Crossover. Price above SMA20.`;
      }
      // Sell Signal: RSI Overbought (> 65) AND MACD Bearish Crossunder AND Price < SMA20
      else if (currentRsi > 65 && currentMacd < currentMacdSignal && item.price < currentSma) {
        signal = 'SELL';
        rationale = `RSI Overbought (${currentRsi.toFixed(0)}) & MACD Bearish Crossunder. Price below SMA20.`;
      }
    }

    return { ...item, signal, signalRationale: rationale };
  });

  // If we have an AI prediction, override or reinforce the LATEST data point's signal
  if (prediction && enriched.length > 0) {
    const lastIdx = enriched.length - 1;
    const lastItem = enriched[lastIdx];
    
    if (prediction.trend === 'Up' && prediction.confidence > 70) {
      lastItem.signal = 'BUY';
      lastItem.signalRationale = `AI STRATEGIC BUY: ${prediction.reasoning.substring(0, 100)}...`;
    } else if (prediction.trend === 'Down' && prediction.confidence > 70) {
      lastItem.signal = 'SELL';
      lastItem.signalRationale = `AI STRATEGIC SELL: ${prediction.reasoning.substring(0, 100)}...`;
    }
  }

  return enriched;
}
