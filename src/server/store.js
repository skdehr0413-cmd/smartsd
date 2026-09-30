// JSON 파일 저장소. 쓰기는 임시 파일 → rename 으로 원자적으로 처리해
// 저장 도중 전원이 꺼져도 이전 버전이 남는다.
import fs from 'node:fs';
import path from 'node:path';

export class FileStore {
  constructor(file) {
    this.file = file;
  }

  load() {
    try {
      return JSON.parse(fs.readFileSync(this.file, 'utf8'));
    } catch (err) {
      if (err.code === 'ENOENT') return null;
      throw new Error(`데이터 파일을 읽을 수 없습니다: ${this.file} (${err.message})`);
    }
  }

  save(state) {
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const tmp = `${this.file}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(state));
    fs.renameSync(tmp, this.file);
  }
}

export class MemoryStore {
  constructor(initial = null) {
    this.data = initial ? JSON.stringify(initial) : null;
  }

  load() {
    return this.data ? JSON.parse(this.data) : null;
  }

  save(state) {
    this.data = JSON.stringify(state);
  }
}
