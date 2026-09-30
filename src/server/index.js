#!/usr/bin/env node
// 실행: npm start  (PORT, DATA_FILE, SMARTSD_NOW, SMARTSD_SEED 환경 변수로 조정)
import path from 'node:path';
import { createApp } from './app.js';

const port = Number(process.env.PORT) || 3000;
const dataFile = process.env.DATA_FILE === ':memory:' ? null : path.resolve(process.env.DATA_FILE || 'data/smartsd.json');
const { server, clock } = createApp({
  dataFile,
  now: process.env.SMARTSD_NOW || undefined,
  seed: process.env.SMARTSD_SEED === 'empty' ? 'empty' : 'demo',
  allowReset: process.env.SMARTSD_ALLOW_RESET !== '0',
});

server.listen(port, () => {
  console.log(`스마트설비 실행 중: http://localhost:${port}  (현재 시각 ${clock()}, 데이터 ${dataFile || '메모리'})`);
});

const stop = () => server.close(() => process.exit(0));
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
