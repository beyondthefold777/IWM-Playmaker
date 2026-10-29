import dotenv from 'dotenv';
dotenv.config();
import { fetchIWM } from './lib/data.js';
import { addIndicators } from './lib/indicators.js';
import { scoreSignal } from './strategies/iwmLongShort.js';
import { sendAlert } from './lib/alerts.js';

async function run(){
  console.log('IWM Signals Bot - TS - Longs & Shorts');
  while(true){
    try{
      const candles = await fetchIWM(); // <-- no args now
      const withInd = addIndicators(candles);
      const signal = scoreSignal(withInd);
      await sendAlert(signal); // <-- no second arg
    } catch(e){ console.error('fetch error', e); }
    await new Promise(r=>setTimeout(r, 5*60*1000));
  }
}
run();