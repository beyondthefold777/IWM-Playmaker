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
