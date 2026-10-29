export type Signal = { score: number; bias: 'LONG'|'SHORT'|'NEUTRAL'; price: number; rsi: number; reasons: string[]; vwap: number };

export function scoreSignal(data: any[]): Signal {
  const last = data[data.length-1];
  const prev = data[data.length-2];
  const prev2 = data[data.length-3];
  let score = 0; const reasons: string[] = [];

  const emaUp = last.emaFast > last.emaSlow;
  const emaSpread = Math.abs(last.emaFast - last.emaSlow)/last.close*100;
  const wasEmaUp = prev.emaFast > prev.emaSlow;
  
  // --- CRASH DETECTION ---
  // Was uptrend, now breaking down with volume = catch the crash
  const isCrashDown = wasEmaUp && !emaUp && prev.rsi > 60 && last.rsi < 55 && last.relVol > 1.3;
  const isPumpUp = !wasEmaUp && emaUp && prev.rsi < 40 && last.rsi > 45 && last.relVol > 1.3;
  
  if (isCrashDown) {
    score -= 3;
    reasons.push(`CRASH ${prev.rsi.toFixed(0)}->${last.rsi.toFixed(0)} Vol${last.relVol.toFixed(1)}x`);
  }
  if (isPumpUp) {
    score += 3;
    reasons.push(`PUMP ${prev.rsi.toFixed(0)}->${last.rsi.toFixed(0)} Vol${last.relVol.toFixed(1)}x`);
  }

  // Chop filter - but allow crashes through
  if (emaSpread < 0.05 && !isCrashDown && !isPumpUp) {
    return { score:0, bias:'NEUTRAL', price:last.close, rsi:last.rsi, reasons:['Chop'], vwap:last.vwap };
  }

  // Daily trend - but allow crash counter-trend if strong volume
  if (!isCrashDown && !isPumpUp && !isNaN(last.dailySma20)) {
    if (emaUp && last.close < last.dailySma20) return { score:0, bias:'NEUTRAL', price:last.close, rsi:last.rsi, reasons:['Daily down'], vwap:last.vwap };
    if (!emaUp && last.close > last.dailySma20) return { score:0, bias:'NEUTRAL', price:last.close, rsi:last.rsi, reasons:['Daily up'], vwap:last.vwap };
  }

  // EMA base
  if (emaUp) { score+=1; reasons.push('EMA up'); } else { score-=1; reasons.push('EMA down'); }

  // RSI - improved for crashes
  if (emaUp && last.rsi >= 48 && last.rsi <= 65 && last.rsi > prev.rsi) { 
    score+=1; reasons.push(`RSI ${last.rsi.toFixed(0)}`); 
  }
  else if (!emaUp && last.rsi >= 32 && last.rsi <= 52 && last.rsi < prev.rsi) { 
    score-=1; reasons.push(`RSI ${last.rsi.toFixed(0)}`); 
  }
  else if (prev.rsi > 62 && last.rsi < 56) { 
    score-=2; reasons.push(`RSI REJ ${prev.rsi.toFixed(0)}->${last.rsi.toFixed(0)}`); // Crash rejection
  }
  else if (prev.rsi < 38 && last.rsi > 44) { 
    score+=2; reasons.push(`RSI REV ${prev.rsi.toFixed(0)}->${last.rsi.toFixed(0)}`); // Pump reversal
  }
  else if (!isCrashDown && !isPumpUp) {
    return { score:0, bias:'NEUTRAL', price:last.close, rsi:last.rsi, reasons:['RSI not sweet'], vwap:last.vwap };
  }

  // VWAP with distance - crashes break VWAP hard
  const vwapDist = Math.abs(last.close - last.vwap)/last.vwap*100;
  if (emaUp && last.close > last.vwap) { score+=1; reasons.push(`>VWAP ${vwapDist.toFixed(2)}%`); }
  else if (!emaUp && last.close < last.vwap) { score-=1; reasons.push(`<VWAP ${vwapDist.toFixed(2)}%`); }
  else if (!isCrashDown && !isPumpUp) {
    return { score:0, bias:'NEUTRAL', price:last.close, rsi:last.rsi, reasons:['VWAP chop'], vwap:last.vwap };
  }

  // Volume - crashes need volume
  if (last.relVol < 1.0 && last.volume < last.volAvg*1.0 && !isCrashDown) {
    return { score:0, bias:'NEUTRAL', price:last.close, rsi:last.rsi, reasons:['No vol'], vwap:last.vwap };
  }
  if (last.relVol > 2.0) { score+= emaUp?2:-2; reasons.push(`Vol ${last.relVol.toFixed(1)}x HUGE`); }
  else if (last.relVol > 1.2) { score+= emaUp?1:-1; reasons.push(`Vol ${last.relVol.toFixed(1)}x`); }

  // Squeeze BO - low vol to high vol = breakout
  if (!last.squeeze && prev.squeeze) { score+= emaUp?1:-1; reasons.push('Squeeze BO'); }

  // ATR expansion = abrupt move
  if (last.atr > prev.atr * 1.2 && last.relVol > 1.5) {
    score+= emaUp?1:-1; reasons.push(`ATR exp ${((last.atr/prev.atr-1)*100).toFixed(0)}%`);
  }

  score = Math.max(-6, Math.min(6, score));
  if (Math.abs(score) < 4) return { score:0, bias:'NEUTRAL', price:last.close, rsi:last.rsi, reasons, vwap:last.vwap };

  const bias = score>=4?'LONG':'SHORT';
  return { score, bias, price:last.close, rsi:last.rsi, reasons, vwap:last.vwap };
}