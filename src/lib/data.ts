import dotenv from 'dotenv';
dotenv.config();

const KEY = process.env.TWELVEDATA_KEY!;

export async function fetchIWM() {
  if (!KEY) throw new Error('Missing TWELVEDATA_KEY in .env');

  // TwelveData - last 10 days, 5min
  const url = `https://api.twelvedata.com/time_series?symbol=IWM&interval=5min&outputsize=500&apikey=${KEY}`;

  const res = await fetch(url);
  const data: any = await res.json();

  if (data.status === 'error' || !data.values) {
    console.log('TwelveData response:', data);
    throw new Error('TwelveData error: ' + (data.message || data.code));
  }

  // TwelveData returns newest first, we need oldest first
  return data.values.reverse().map((v: any) => ({
    close: parseFloat(v.close),
    high: parseFloat(v.high),
    low: parseFloat(v.low),
    volume: parseFloat(v.volume),
    timestamp: new Date(v.datetime).getTime()
  }));
}