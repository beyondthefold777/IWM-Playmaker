import dotenv from 'dotenv';
dotenv.config();
import { addIndicators } from './lib/indicators.js';
import { scoreSignal } from './strategies/iwmLongShort.js';

const KEY = process.env.TWELVEDATA_KEY!;

async function fetch30Days() {
  const url = `https://api.twelvedata.com/time_series?symbol=IWM&interval=5min&outputsize=5000&apikey=${KEY}`;
  const res = await fetch(url);
  const data: any = await res.json();
  if (!data.values) throw new Error(JSON.stringify(data));
  return data.values.reverse().map((v: any) => ({
    high: parseFloat(v.high),
    low: parseFloat(v.low),
    close: parseFloat(v.close),
    volume: parseFloat(v.volume),
    timestamp: new Date(v.datetime).getTime(),
    datetime: v.datetime
  }));
}

async function backtest() {
  console.log('Fetching 30 days IWM 5m...');
  const raw = await fetch30Days();
  const data = addIndicators(raw);
  console.log(`Got ${data.length} candles`);

  let trades: any[] = [];
  let wins = 0, losses = 0;
  let lastTradeIdx = -100;

  for (let i = 250; i < data.length - 15; i++) {
    const slice = data.slice(0, i+1);
    const signal = scoreSignal(slice);

    // CHANGED: 3+ for 1.5/day (was 4)
    if (Math.abs(signal.score) < 3) continue;

    // 100 min cooldown = 1-2/day
    if (i - lastTradeIdx < 20) continue;

    // Time filters
    const dt = new Date((data[i] as any).datetime);
    const etHour = dt.getUTCHours() - 4 + dt.getUTCMinutes()/60;
    if (etHour < 9.6 || etHour > 15.5) continue;
    if (etHour >= 11.5 && etHour <= 13.3) continue;

    const isLong = signal.bias === 'LONG';
    const entry = data[i+1].close;

    // 1/day scalp: 0.35% TP, 0.20% SL, 75 min max
    let exit = entry, exitReason = 'timeout';
    for (let j = 1; j <= 15; j++) {
      const c = data[i+j];
      if (!c) break;
      const pnl = isLong ? (c.high - entry)/entry : (entry - c.low)/entry;
      const loss = isLong ? (entry - c.low)/entry : (c.high - entry)/entry;
      if (pnl >= 0.0035) { exit = isLong ? entry*1.0035 : entry*0.9965; exitReason='TP'; break; }
      if (loss >= 0.0020) { exit = isLong ? entry*0.998 : entry*1.002; exitReason='SL'; break; }
      if (j===15) exit = c.close;
    }

    const pnlPct = isLong ? (exit-entry)/entry : (entry-exit)/entry;
    const win = pnlPct > 0;
    if (win) wins++; else losses++;
    lastTradeIdx = i;

    trades.push({
      time: (data[i] as any).datetime,
      bias: signal.bias,
      score: signal.score,
      reasons: signal.reasons.join(' | '),
      entry: entry.toFixed(2),
      exit: exit.toFixed(2),
      pnl: (pnlPct*100).toFixed(2)+'%',
      result: exitReason,
      win
    });
  }

  const total = trades.length;
  const winRate = total ? (wins/total*100).toFixed(1) : '0';
  
  console.log(`\n--- 1.5/DAY BACKTEST (score >=3, 100min cooldown) ---`);
  console.log(`Total: ${total} (${(total/21).toFixed(1)}/day) | Wins: ${wins} | Losses: ${losses} | WR: ${winRate}%`);
  
  const avgWin = trades.filter(t=>t.win).reduce((a,t)=>a+parseFloat(t.pnl),0) / (wins||1);
  const avgLoss = trades.filter(t=>!t.win).reduce((a,t)=>a+parseFloat(t.pnl),0) / (losses||1);
  const pf = Math.abs((avgWin*wins) / (avgLoss*losses||1));
  
  console.log(`Avg win: ${avgWin.toFixed(2)}% | Avg loss: ${avgLoss.toFixed(2)}% | PF: ${pf.toFixed(2)} | EV: ${(wins/total*avgWin + losses/total*avgLoss).toFixed(3)}%`);
  console.log('\nLast 25 trades:');
  console.table(trades.slice(-25));

  const fs = await import('fs');
  fs.writeFileSync('backtest-results.json', JSON.stringify(trades, null, 2));
}

backtest();