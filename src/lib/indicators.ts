// IWM indicators for 5-minute regular-session candles (09:30–16:00 ET).
//
// Returns a NEW array where every input candle keeps ALL of its original fields
// (open, datetime, ...) plus the indicator fields below. Same length, same order.
//
// Intraday:   vwap (resets daily), emaFast/emaSlow, rsi, atr, bbUpper/bbLower, kcUpper/kcLower,
//             squeeze, volAvg (last 20 bars), slotVolAvg + relVol (vs the same 5-min slot on prior days)
// Daily:      dayOpen, prevDayClose, dailySma20 (of prior daily closes), dailyAtr14 (prior days)
// Values are NaN until there is enough history; strategies must treat NaN as "no signal".

export type Candle = {
  open?: number; high: number; low: number; close: number; volume: number;
  timestamp: number; datetime?: string; [k: string]: any;
};

export type IndicatorBar = Candle & {
  date: string; mins: number;
  vwap: number; emaFast: number; emaSlow: number; rsi: number; atr: number;
  bbUpper: number; bbLower: number; kcUpper: number; kcLower: number; squeeze: boolean;
  volAvg: number; slotVolAvg: number; relVol: number;
  dayOpen: number; prevDayClose: number; dailySma20: number; dailyAtr14: number;
};

export const SETTINGS = {
  emaFast: 9, emaSlow: 21, rsi: 14, atr: 14,
  bb: 20, bbMult: 2, kcMult: 1.5,
  volAvg: 20, slotDays: 20, dailySma: 20, dailyAtr: 14,
};

const etFmt = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', hour12: false,
});

/** ET calendar date + minutes since midnight. Prefers the exchange-local "YYYY-MM-DD HH:mm:ss" string. */
export function etClock(c: Candle): { date: string; mins: number } {
  if (typeof c.datetime === 'string' && c.datetime.length >= 16) {
    const [date, time] = c.datetime.split(' ');
    const [h, m] = time.split(':').map(Number);
    return { date, mins: h * 60 + m };
  }
  const p = etFmt.formatToParts(new Date(c.timestamp));
  const g = (t: string) => p.find(x => x.type === t)!.value;
  return { date: `${g('year')}-${g('month')}-${g('day')}`, mins: (Number(g('hour')) % 24) * 60 + Number(g('minute')) };
}

const mean = (a: number[]) => a.reduce((s, x) => s + x, 0) / a.length;

export function addIndicators<T extends Candle>(candles: T[]): (T & IndicatorBar)[] {
  const S = SETTINGS;
  const kF = 2 / (S.emaFast + 1), kS = 2 / (S.emaSlow + 1);
  const out: (T & IndicatorBar)[] = [];

  let emaF = NaN, emaS = NaN;
  let avgGain = NaN, avgLoss = NaN, rsiSeed: number[] = [];
  let atr = NaN, trSeed: number[] = [];
  const closes: number[] = [], vols: number[] = [];

  // VWAP / daily state
  let curDate = '', pv = 0, vv = 0, dayOpen = NaN, dayHigh = -Infinity, dayLow = Infinity, dayClose = NaN;
  const dailyCloses: number[] = [], dailyTR: number[] = [];

  // same-slot volume history: mins -> volumes on previous days
  const slotHist = new Map<number, number[]>();

  for (let i = 0; i < candles.length; i++) {
    const c = candles[i];
    const { date, mins } = etClock(c);
    const prevClose = i > 0 ? candles[i - 1].close : NaN;

    // ---- new day: close out the previous day
    if (date !== curDate) {
      if (curDate) {
        const prevDayClose = dailyCloses.length ? dailyCloses[dailyCloses.length - 1] : NaN;
        const tr = isNaN(prevDayClose) ? dayHigh - dayLow
          : Math.max(dayHigh - dayLow, Math.abs(dayHigh - prevDayClose), Math.abs(dayLow - prevDayClose));
        dailyTR.push(tr);
        dailyCloses.push(dayClose);
      }
      curDate = date; pv = 0; vv = 0;
      dayOpen = c.open ?? c.close; dayHigh = -Infinity; dayLow = Infinity;
    }
    dayHigh = Math.max(dayHigh, c.high); dayLow = Math.min(dayLow, c.low); dayClose = c.close;

    // ---- VWAP (typical price, resets each day)
    const tp = (c.high + c.low + c.close) / 3;
    pv += tp * c.volume; vv += c.volume;
    const vwap = vv > 0 ? pv / vv : c.close;

    // ---- EMAs
    emaF = isNaN(emaF) ? c.close : emaF + kF * (c.close - emaF);
    emaS = isNaN(emaS) ? c.close : emaS + kS * (c.close - emaS);

    // ---- RSI (Wilder)
    let rsi = NaN;
    if (i > 0) {
      const ch = c.close - prevClose;
      const gain = Math.max(ch, 0), loss = Math.max(-ch, 0);
      if (isNaN(avgGain)) {
        rsiSeed.push(ch);
        if (rsiSeed.length === S.rsi) {
          avgGain = mean(rsiSeed.map(x => Math.max(x, 0)));
          avgLoss = mean(rsiSeed.map(x => Math.max(-x, 0)));
        }
      } else {
        avgGain = (avgGain * (S.rsi - 1) + gain) / S.rsi;
        avgLoss = (avgLoss * (S.rsi - 1) + loss) / S.rsi;
      }
      if (!isNaN(avgGain)) rsi = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
    }

    // ---- ATR (Wilder) on 5-min bars
    const tr = isNaN(prevClose) ? c.high - c.low
      : Math.max(c.high - c.low, Math.abs(c.high - prevClose), Math.abs(c.low - prevClose));
    if (isNaN(atr)) { trSeed.push(tr); if (trSeed.length === S.atr) atr = mean(trSeed); }
    else atr = (atr * (S.atr - 1) + tr) / S.atr;

    // ---- Bollinger / Keltner squeeze
    closes.push(c.close); if (closes.length > S.bb) closes.shift();
    let bbUpper = NaN, bbLower = NaN, kcUpper = NaN, kcLower = NaN, squeeze = false;
    if (closes.length === S.bb && !isNaN(atr)) {
      const m = mean(closes);
      const sd = Math.sqrt(mean(closes.map(x => (x - m) ** 2)));
      bbUpper = m + S.bbMult * sd; bbLower = m - S.bbMult * sd;
      kcUpper = m + S.kcMult * atr; kcLower = m - S.kcMult * atr;
      squeeze = bbUpper < kcUpper && bbLower > kcLower;
    }

    // ---- Volume: rolling average and same-time-of-day average
    vols.push(c.volume); if (vols.length > S.volAvg) vols.shift();
    const volAvg = vols.length === S.volAvg ? mean(vols) : NaN;
    const hist = slotHist.get(mins) ?? [];
    const slotVolAvg = hist.length >= 5 ? mean(hist) : NaN;   // need at least 5 prior days
    const relVol = slotVolAvg > 0 ? c.volume / slotVolAvg : NaN;
    hist.push(c.volume); if (hist.length > S.slotDays) hist.shift();
    slotHist.set(mins, hist);

    // ---- Daily context (completed prior days only, so no look-ahead)
    const n = dailyCloses.length;
    const prevDayClose = n ? dailyCloses[n - 1] : NaN;
    const dailySma20 = n >= S.dailySma ? mean(dailyCloses.slice(-S.dailySma)) : NaN;
    const dailyAtr14 = dailyTR.length >= S.dailyAtr ? mean(dailyTR.slice(-S.dailyAtr)) : NaN;

    out.push({
      ...c, date, mins,
      vwap, emaFast: emaF, emaSlow: emaS, rsi, atr,
      bbUpper, bbLower, kcUpper, kcLower, squeeze,
      volAvg, slotVolAvg, relVol,
      dayOpen, prevDayClose, dailySma20, dailyAtr14,
    });
  }
  return out;
}