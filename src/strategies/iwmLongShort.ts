export type Signal = { score: number; bias: 'LONG'|'SHORT'|'NEUTRAL'; price: number; rsi: number; reasons: string[]; vwap: number };

export function scoreSignal(data: any[]): Signal {
  const last = data[data.length-1];
  const prev = data[data.length-2];
  let score = 0; const reasons: string[] = [];

  if (!isNaN(last.dailySma20)) {
    if (last.close > last.dailySma20 && last.close < last.dailySma20*0.98) {
    }
  }

  const emaUp = last.emaFast > last.emaSlow;
  const emaSpread = Math.abs(last.emaFast - last.emaSlow)/last.close*100;
  if (emaSpread < 0.05) return { score:0, bias:'NEUTRAL', price:last.close, rsi:last.rsi, reasons:['Chop'], vwap:last.vwap };

  if (!isNaN(last.dailySma20)) {
    if (emaUp && last.close < last.dailySma20) return { score:0, bias:'NEUTRAL', price:last.close, rsi:last.rsi, reasons:['Long vs daily down'], vwap:last.vwap };
    if (!emaUp && last.close > last.dailySma20) return { score:0, bias:'NEUTRAL', price:last.close, rsi:last.rsi, reasons:['Short vs daily up'], vwap:last.vwap };
  }

  if (emaUp) { score+=1; reasons.push('EMA up'); } else { score-=1; reasons.push('EMA down'); }

  if (emaUp && last.rsi >= 48 && last.rsi <= 65 && last.rsi > prev.rsi) { score+=1; reasons.push(`RSI ${last.rsi.toFixed(0)}`); }
  else if (!emaUp && last.rsi >= 35 && last.rsi <= 52 && last.rsi < prev.rsi) { score-=1; reasons.push(`RSI ${last.rsi.toFixed(0)}`); }
  else if (emaUp && prev.rsi < 40) { score+=1; reasons.push('RSI rev'); }
  else if (!emaUp && prev.rsi > 60) { score-=1; reasons.push('RSI rej'); }
  else return { score:0, bias:'NEUTRAL', price:last.close, rsi:last.rsi, reasons:['RSI not sweet'], vwap:last.vwap };

  if (emaUp && last.close > last.vwap) { score+=1; reasons.push('>VWAP'); }
  else if (!emaUp && last.close < last.vwap) { score-=1; reasons.push('<VWAP'); }
  else return { score:0, bias:'NEUTRAL', price:last.close, rsi:last.rsi, reasons:['VWAP chop'], vwap:last.vwap };

  if (last.volume < last.volAvg*1.2 && last.relVol < 1.2) return { score:0, bias:'NEUTRAL', price:last.close, rsi:last.rsi, reasons:['No vol'], vwap:last.vwap };
  score+= emaUp?1:-1; reasons.push('Vol');

  if (!last.squeeze && prev.squeeze) { score+= emaUp?1:-1; reasons.push('Squeeze BO'); }

  score = Math.max(-5, Math.min(5, score));
  // CHANGED TO 3 for 1.5/day (was 4)
  if (Math.abs(score) < 3) return { score:0, bias:'NEUTRAL', price:last.close, rsi:last.rsi, reasons, vwap:last.vwap };

  const bias = score>=3?'LONG':'SHORT';
  return { score, bias, price:last.close, rsi:last.rsi, reasons, vwap:last.vwap };
}