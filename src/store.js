'use strict';
const fs = require('fs');
const path = require('path');
const { EventEmitter } = require('events');
const R = require('../media/reducer.js');

const RUN_ID = /^[a-z0-9][a-z0-9-]{0,63}$/;
const ACTIVE_WINDOW_MS = 15 * 60 * 1000;

class Store extends EventEmitter {
  constructor(getDir) {
    super();
    this.getDir = getDir;
    this.runs = new Map();
    this.timer = null;
    this.busy = false;
    this.primed = false;
    this.directory = null;
  }

  start(interval = 700) {
    this.poll();
    this.timer = setInterval(() => this.poll(), interval);
  }

  stop() {
    clearInterval(this.timer);
    this.timer = null;
  }

  async readFrom(file, offset, size) {
    const handle = await fs.promises.open(file, 'r');
    try {
      const buffer = Buffer.alloc(size - offset);
      await handle.read(buffer, 0, buffer.length, offset);
      const last = buffer.lastIndexOf(0x0a);
      if (last < 0) return { events: [], consumed: 0 };
      const events = [];
      for (const line of buffer.subarray(0, last + 1).toString('utf8').split('\n')) {
        if (!line.trim()) continue;
        try {
          const event = JSON.parse(line);
          if (event && R.validAgent(event.agent) && typeof event.type === 'string') events.push(event);
        } catch {}
      }
      return { events, consumed: last + 1 };
    } finally {
      await handle.close();
    }
  }

  async poll() {
    if (this.busy) return;
    this.busy = true;
    try {
      const dir = this.getDir();
      if (this.directory !== dir) {
        this.directory = dir;
        this.runs.clear();
        this.primed = false;
        this.emit('change');
      }
      let names = [];
      try { names = await fs.promises.readdir(dir); } catch { names = []; }
      const seen = new Set();
      let changed = false;
      for (const name of names) {
        if (!name.endsWith('.jsonl')) continue;
        const id = name.slice(0, -6);
        if (!RUN_ID.test(id)) continue;
        seen.add(id);
        const file = path.join(dir, name);
        let stat;
        try { stat = await fs.promises.stat(file); } catch { continue; }
        let run = this.runs.get(id);
        if (!run) {
          run = { id, events: [], state: R.emptyState(), offset: 0, mtimeMs: stat.mtimeMs };
          this.runs.set(id, run);
          changed = true;
          this.emit('added', id, this.primed);
        }
        if (stat.size < run.offset) {
          run.events = [];
          run.state = R.emptyState();
          run.offset = 0;
          run.reset = true;
          changed = true;
        }
        if (stat.size > run.offset) {
          const { events, consumed } = await this.readFrom(file, run.offset, stat.size);
          run.offset += consumed;
          if (events.length) {
            for (const event of events) { run.events.push(event); R.apply(run.state, event); }
            changed = true;
            this.emit('events', id, events, this.primed);
          }
        }
        if (run.mtimeMs !== stat.mtimeMs) { run.mtimeMs = stat.mtimeMs; changed = true; }
        if (run.reset) { delete run.reset; this.emit('reset', id); }
      }
      for (const id of [...this.runs.keys()]) {
        if (!seen.has(id)) { this.runs.delete(id); changed = true; this.emit('removed', id); }
      }
      this.primed = true;
      if (changed) this.emit('change');
    } catch (error) {
      this.emit('fault', error);
    } finally {
      this.busy = false;
    }
  }

  info(run) {
    const state = run.state;
    const age = Date.now() - run.mtimeMs;
    return { id: run.id, title: state.title || run.id, ended: state.ended, events: run.events.length,
      updated: run.mtimeMs, empty: !!state.sessionEmpty, paused: !!state.paused, active: !state.sessionEmpty && !state.ended && !state.paused && age < ACTIVE_WINDOW_MS,
      errors: state.counts.errors, agents: Object.fromEntries(R.agentIds(state).map(agent => [agent, state.agents[agent].status])) };
  }

  list() {
    return [...this.runs.values()].map(run => this.info(run)).sort((left, right) => right.updated - left.updated);
  }

  get(id) { return this.runs.get(id); }

  async remove(id) {
    if (!RUN_ID.test(id)) return;
    await fs.promises.rm(path.join(this.getDir(), id + '.jsonl'), { force: true });
    await fs.promises.rm(path.join(this.getDir(), id + '.state.json'), { force: true });
    await fs.promises.rm(path.join(this.getDir(), id + '.md'), { force: true });
    this.runs.delete(id);
    this.emit('removed', id);
    this.emit('change');
  }
}

module.exports = { Store, RUN_ID };
