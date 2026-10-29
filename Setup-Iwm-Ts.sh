#!/bin/bash
# Run this in your empty repo root

mkdir -p src/lib src/strategies

cat > package.json <<'JSON'
{
  "name": "iwm-signals-bot",
  "version": "1.0.0",
  "type": "module",
  "scripts": {
    "dev": "tsx watch src/index.ts",
    "start": "tsx src/index.ts",
    "build": "tsc"
  },
  "dependencies": {
    "yahoo-finance2": "^2.13.3",
    "yaml": "^2.3.4"
  },
  "devDependencies": {
    "tsx": "^4.7.0",
    "typescript": "^5.4.0",
    "@types/node": "^20.11.0"
  }
}
JSON

cat > tsconfig.json <<'JSON'
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "outDir": "dist",
    "rootDir": "src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true
  }
}
JSON

cat > src/config.yaml <<'YAML'
ticker: IWM
timeframes:
  fast: "5m"
  slow: "15m"
  lookbackDays: 10
strategy:
  emaFast: 20
  emaSlow: 50
  rsiPeriod: 14
  rsiLong: 35
  rsiShort: 65
  bbPeriod: 20
  orbMinutes: 30
  volumeMult: 1.5
scoring:
  minScore: 3
alerts:
  console: true
YAML

cat > src/lib/indicators.ts <<'TS'
export type Candle = { high: number; low: number; close: number; volume: number; timestamp: number };

function ema(values: number[], period: number): number[] {
  const k = 2 / (period + 1);
  const out: number[] = [];
  let prev = values.slice(0, period).reduce((a,b)=>a+b,0)/period;
  for (let i=0;i<values.length;i++) {
    const v = i===0 ? prev : values[i]*k + prev*(1-k);
    out.push(v); prev=v;
  }
  return out;
}
function rsi(values: number[], period=14): number[] {
  let gains=0, losses=0;
  const out: number[] = Array(values.length).fill(50);
  for (let i=1;i<values.length;i++) {
    const diff = values[i]-values[i-1];
    if (i<=period){ if(diff>0) gains+=diff; else losses-=diff; }
    if (i>=period){
      const avgG = gains/period, avgL = losses/period;
      const rs = avgL===0?100:avgG/avgL;
      out[i]=100-(100/(1+rs));
      const d = values[i]-values[i-1];
      gains = (gains*(period-1) + (d>0?d:0))/period;
      losses = (losses*(period-1) + (d<0?-d:0))/period;
    }
  }
  return out;
}

export function addIndicators(candles: Candle[]) {
  const closes = candles.map(c=>c.close);
  const emaFast = ema(closes, 20);
  const emaSlow = ema(closes, 50);
  const rsiArr = rsi(closes, 14);
  
  let cumPV=0, cumV=0;
  return candles.map((c,i)=>{
    cumPV += c.close*c.volume; cumV += c.volume;
    const vwap = cumV? cumPV/cumV : c.close;
    const sma20 = closes.slice(Math.max(0,i-19), i+1).reduce((a,b)=>a+b,0)/Math.min(20,i+1);
    const std = Math.sqrt(closes.slice(Math.max(0,i-19), i+1).map(v=> (v-sma20)**2).reduce((a,b)=>a+b,0)/20);
    const bbUpper = sma20 + 2*std, bbLower = sma20 - 2*std;
    // Keltner approx with ATR
    const tr = Math.max(c.high-c.low, Math.abs(c.high-(candles[i-1]?.close||c.close)));
    const atr = candles.slice(Math.max(0,i-19),i+1).map((_,j)=>{
      const idx = Math.max(0,i-19)+j; 
      return Math.max(candles[idx].high-candles[idx].low, Math.abs(candles[idx].high-(candles[idx-1]?.close||candles[idx].close)));
    }).reduce((a,b)=>a+b,0)/20;
    const kcUpper = sma20 + 1.5*atr, kcLower = sma20 - 1.5*atr;
    const squeeze = bbUpper < kcUpper && bbLower > kcLower;
    const volAvg = candles.slice(Math.max(0,i-19), i+1).reduce((a,b)=>a+b.volume,0)/Math.min(20,i+1);
    
    return {
      ...c,
      vwap, emaFast: emaFast[i], emaSlow: emaSlow[i], rsi: rsiArr[i],
      squeeze, volAvg,
      bbUpper, bbLower, kcUpper, kcLower
    }
  });
}
TS

cat > src/strategies/iwmLongShort.ts <<'TS'
export type Signal = { score: number; bias: 'LONG'|'SHORT'|'NEUTRAL'; price: number; rsi: number; reasons: string[]; vwap: number };

export function scoreSignal(data: any[]): Signal {
  const last = data[data.length-1];
  const prev = data[data.length-2];
  let score = 0; const reasons: string[] = [];
  
  // 1. EMA trend - both directions
  if (last.emaFast > last.emaSlow){ score+=1; reasons.push('EMA bullish'); }
  else { score-=1; reasons.push('EMA bearish'); }
  
  // 2. VWAP
  if (last.close > last.vwap){ score+=1; reasons.push('Above VWAP'); }
  else { score-=1; reasons.push('Below VWAP'); }

  // 3. RSI reversal - KEY long/short
  if (prev.rsi < 35 && last.rsi > prev.rsi && last.rsi < 50){ score+=2; reasons.push(`RSI reversal up ${last.rsi.toFixed(1)}`); }
  if (prev.rsi > 65 && last.rsi < prev.rsi && last.rsi > 50){ score-=2; reasons.push(`RSI rejection down ${last.rsi.toFixed(1)}`); }

  // 4. Squeeze break + volume
  if (!last.squeeze && prev.squeeze && last.volume > last.volAvg*1.5){
    if (last.close > prev.close){ score+=2; reasons.push('Squeeze BREAK UP + vol'); }
    else { score-=2; reasons.push('Squeeze BREAK DOWN + vol'); }
  }

  // 5. ORB approx (first 6x 5m bars)
  const orbHigh = Math.max(...data.slice(-30,-24).map((d:any)=>d.high));
  const orbLow = Math.min(...data.slice(-30,-24).map((d:any)=>d.low));
  if (last.close > orbHigh){ score+=1; reasons.push('ORB high break'); }
  if (last.close < orbLow){ score-=1; reasons.push('ORB low break'); }

  score = Math.max(-5, Math.min(5, score));
  const bias = score>0?'LONG': score<0?'SHORT':'NEUTRAL';
  return { score, bias, price: last.close, rsi: last.rsi, reasons, vwap: last.vwap };
}
TS

cat > src/lib/data.ts <<'TS'
import YahooFinance from 'yahoo-finance2';
const yf = new YahooFinance();
export async function fetchIWM(period='10d', interval:'5m'|'15m'='5m'){
  const res = await yf.chart('IWM', { period1: new Date(Date.now()-10*24*3600*1000), interval: interval as any });
  const quotes = res.quotes.map((q:any)=>({ high:q.high, low:q.low, close:q.close, volume:q.volume, timestamp:q.date.getTime() }));
  return quotes.filter(q=>q.close);
}
TS

cat > src/lib/alerts.ts <<'TS'
import { Signal } from '../strategies/iwmLongShort.js';
export function sendAlert(s: Signal, minScore=3){
  if (Math.abs(s.score) < minScore){ console.log(`[SKIP] ${s.score} | ${s.reasons.join(', ')}`); return; }
  const idea = s.score>0 ? 'Calls, 0-3 DTE, 1-2 OTM' : 'Puts, 0-3 DTE, 1-2 OTM';
  console.log(`
🚨 IWM SIGNAL: ${s.bias} ${s.score}/5
Price: $${s.price.toFixed(2)} | VWAP: $${s.vwap.toFixed(2)} | RSI: ${s.rsi.toFixed(1)}
Reasons: ${s.reasons.join(' | ')}
Options Idea: ${idea}
`);
}
TS

cat > src/index.ts <<'TS'
import { fetchIWM } from './lib/data.js';
import { addIndicators } from './lib/indicators.js';
import { scoreSignal } from './strategies/iwmLongShort.js';
import { sendAlert } from './lib/alerts.js';

async function run(){
  console.log('IWM Signals Bot - TS - Longs & Shorts');
  while(true){
    try{
      const candles = await fetchIWM('10d','5m');
      const withInd = addIndicators(candles);
      const signal = scoreSignal(withInd);
      sendAlert(signal, 3);
    } catch(e){ console.error('fetch error', e); }
    await new Promise(r=>setTimeout(r, 5*60*1000));
  }
}
run();
TS

echo "✅ TS scaffolding done. Run: npm install && npm run dev"
