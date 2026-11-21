'use strict';

// New runtime for the actual imported Core sequence.  It does not manufacture
// repeated 25-fps cels, crossfade unrelated poses, or restart on pointer samples.
class NativeMotionController {
  constructor(manifest, { maxDelta = 80, historyLimit = 160 } = {}) {
    this.manifest = manifest;
    this.definitions = manifest.actions;
    this.maxDelta = maxDelta;
    this.historyLimit = historyLimit;
    this.intents = new Map();
    this.history = [];
    this.serial = 0;
    this.clock = 0;
    this.rootX = 0;
    this.endVariantCursor = 0;
    this.validate();
    this.begin(this.winner());
  }

  validate() {
    const assets = new Set(this.manifest.assets.map(r => r.file));
    if (!this.definitions.idle) throw new Error('Neutral idle is required');
    const normalPath = s => s.replaceAll('\\', '/').toLowerCase();
    for (const [name, def] of Object.entries(this.definitions)) {
      if (def.loopPasses !== undefined && (!Number.isSafeInteger(def.loopPasses) || def.loopPasses < 1 || def.loopPasses > 20)) {
        throw new Error(`${name}: invalid loop pass count`);
      }
      if (def.releaseTimeScale !== undefined &&
          (!Number.isFinite(def.releaseTimeScale) || def.releaseTimeScale <= 0)) {
        throw new Error(`${name}: invalid release time scale`);
      }
      for (const phase of (def.kind === 'drag' ? ['dynamic','start','loop','end'] : ['start', 'loop', 'end'])) {
        if (!def[phase]?.frames?.length) throw new Error(`${name}/${phase}: no real cels`);
        for (const f of def[phase].frames) {
          if (!assets.has(f.asset) || !Number.isFinite(f.ms) || f.ms <= 0) {
            throw new Error(`${name}/${phase}: invalid asset or duration`);
          }
        }
      }
      if (def.kind !== 'drag' && (def.start.from !== 'neutral' || def.start.to !== def.loop.from ||
          def.loop.to !== def.loop.from || def.end.from !== def.loop.to || def.end.to !== 'neutral')) {
        throw new Error(`${name}: incompatible pose ports`);
      }
      if (!def.nativeSequence && !def.nativeSingle && !def.nativeDrag) continue;
      if (!normalPath(def.sourceRoot).includes('/mod/0000_core/pet/vup/')) {
        throw new Error(`${name}: only original 0000_core is a motion source`);
      }
      // Native A/B/C endpoints are neighboring DRAWINGS, not identical bitmap
      // IDs. Validate exact native order/durations instead of inserting duplicate
      // boundary holds merely to satisfy the older symbolic prototype's guard.
      const sourceTimeline = this.manifest.nativeTimelines?.[name] || this.manifest.nativeTimeline;
      const timeline = sourceTimeline.filter(r =>
        normalPath(r.source).startsWith(normalPath(def.sourceRoot) + '/'));
      const phases = def.nativeSingle ? [['loop','S']] :
        def.nativeDrag ? [['dynamic','D'],['start','A'],['loop','B'],['end','C']] : [['start','A'],['loop','B'],['end','C']];
      for (const [phase, originalPhase] of phases) {
        const expected = timeline.filter(r => r.phase === originalPhase);
        const actual = def[phase].frames;
        if (expected.length !== actual.length || actual.some((f, i) =>
          f.asset !== expected[i].asset || f.ms !== expected[i].ms || f.nativeIndex !== expected[i].nativeIndex)) {
          throw new Error(`${name}/${phase}: changed original Core sequence`);
        }
      }
      const neutral = this.manifest.neutralAsset || this.definitions.idle.loop.frames[0].asset;
      if (def.nativeSequence && def.end.frames.at(-1).asset !== neutral) throw new Error(`${name}: return cel is not neutral`);
    }
  }

  winner() {
    let selected = { owner: 'default', action: 'idle', priority: -Infinity, hold: true, token: 0 };
    for (const candidate of this.intents.values()) {
      if (candidate.priority > selected.priority ||
          (candidate.priority === selected.priority && candidate.token > selected.token)) selected = candidate;
    }
    return selected;
  }

  request(owner, action, priority = 0, { hold = false } = {}) {
    if (!this.definitions[action]) throw new Error(`Unavailable motion: ${action}`);
    const old = this.intents.get(owner);
    if (old?.action === action && old.priority === priority && old.hold === hold) return;
    this.intents.set(owner, { owner, action, priority, hold, token: ++this.serial });
    // A resting neutral cel is safe to leave immediately; do not add 250ms of
    // avoidable input latency. Active A/B/C never hard-swap on a request.
    if ((this.action === 'idle' && action !== 'idle') ||
        (action === 'drag' && this.winner().action === 'drag' && (this.action !== 'drag'||this.phase==='end'))) this.begin(this.winner());
  }

  release(owner) {
    this.intents.delete(owner);
    // Native VPet release goes straight to Raised_Static/C, even if the
    // last suspended cel has a long hold. Do not keep following the cursor.
    if (this.action === 'drag' && this.ticket.owner === owner && this.phase !== 'end') this.enter('end');
  }

  notifyDragMotion() {
    if (this.action !== 'drag' || this.phase === 'end') return;
    this.lastDragMotion = this.clock;
    this.dragDynamicCycles = 0;
    if (this.phase !== 'dynamic') this.enter('dynamic');
  }

  record(event) {
    this.history.push({ event, at: this.clock, action: this.action, phase: this.phase,
      asset: this.clip.frames[this.index].asset });
    if (this.history.length > this.historyLimit) this.history.shift();
  }

  enter(phase) {
    this.phase = phase;
    const def = this.definitions[this.action];
    if (this.action === 'drag' && phase === 'end' && def.endVariants?.length) {
      this.clip = def.endVariants[this.endVariantCursor % def.endVariants.length];
      this.endVariantCursor++;
    } else this.clip = def[phase];
    this.index = 0;
    this.elapsed = 0;
    this.phaseStartedAt = this.clock;
    this.record('enter');
  }

  begin(intent) {
    this.ticket = intent;
    this.action = intent.action;
    this.cycles = 0;
    if (this.action === 'drag') {
      this.dragDynamicCycles = 0; this.lastDragMotion = this.clock; this.enter('dynamic');
    } else this.enter(this.action === 'idle' ? 'loop' : 'start');
  }

  finishOneShot() {
    if (!this.ticket.hold && this.intents.get(this.ticket.owner)?.token === this.ticket.token) {
      this.intents.delete(this.ticket.owner);
    }
  }

  advance() {
    const frame = this.clip.frames[this.index];
    const def = this.definitions[this.action];
    if (def.kind === 'drag') {
      if (this.index + 1 < this.clip.frames.length) { this.index++; return; }
      this.record('complete');
      if (this.phase === 'end') this.begin(this.winner());
      else if (this.phase === 'dynamic') {
        this.dragDynamicCycles++;
        this.enter(this.dragDynamicCycles >= def.settleAfterDynamicCycles && this.clock-this.lastDragMotion > 180 ? 'start' : 'dynamic');
      } else this.enter('loop');
      return;
    }
    // The original B cycle revisits B0. On release, return from the next safe
    // B0 rather than waiting the entire 1.5-second cycle or cutting a pose.
    if (this.phase === 'loop' && this.action !== 'idle' &&
        this.winner().action !== this.action && def.exitAtAssets?.includes(frame.asset)) {
      this.enter('end');
      return;
    }
    if (this.index + 1 < this.clip.frames.length) { this.index++; return; }
    this.record('complete');
    if (this.phase === 'start') {
      this.enter(this.winner().action === this.action ? 'loop' : 'end');
    } else if (this.phase === 'loop') {
      this.cycles++;
      if (this.cycles >= (def.loopPasses ?? 1)) this.finishOneShot();
      const wanted = this.winner();
      if (wanted.action !== this.action) {
        if (this.action === 'idle') this.begin(wanted);
        else this.enter('end');
      } else { this.ticket = wanted; this.enter('loop'); }
    } else this.begin(this.winner());
  }

  tick(delta) {
    if (!Number.isFinite(delta) || delta < 0) return this.snapshot();
    let remaining = Math.min(delta, this.maxDelta);
    while (remaining > 1e-7) {
      const frame = this.clip.frames[this.index];
      const portion = Math.min(remaining, this.duration(frame) - this.elapsed);
      this.rootX += (frame.rootVX || 0) * portion / 1000;
      this.clock += portion;
      this.elapsed += portion;
      remaining -= portion;
      if (this.elapsed >= this.duration(frame) - 1e-7) { this.elapsed = 0; this.advance(); }
    }
    return this.snapshot();
  }

  duration(f) {
    return f.ms * (this.action === 'drag' && this.phase === 'end'
      ? (this.definitions.drag.releaseTimeScale ?? 1) : 1);
  }

  snapshot() {
    const f = this.clip.frames[this.index];
    return { action: this.action, phase: this.phase, index: this.index, asset: f.asset,
      nativeIndex: f.nativeIndex ?? null, elapsed: this.elapsed, frameMs: this.duration(f),
      cycles: this.cycles, rootX: this.rootX, time: this.clock, phaseTime:this.clock-this.phaseStartedAt };
  }
}

if (typeof module !== 'undefined') module.exports = { NativeMotionController };
if (typeof window !== 'undefined') window.NativeMotionController = NativeMotionController;
