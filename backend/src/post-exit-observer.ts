import 'dotenv/config';
import {runPostExitObserver} from './services/post-exit-observer.service';
import {disconnectPrisma} from './lib/prisma';
const tick=()=>runPostExitObserver().catch(e=>console.error('[PostExitObserver]',e instanceof Error?e.message:'failed'));
void tick();
const interval=setInterval(()=>void tick(),60000);
for(const signal of ['SIGTERM','SIGINT'])process.on(signal,()=>{clearInterval(interval);void disconnectPrisma().finally(()=>process.exit(0));});
