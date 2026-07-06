#!/usr/bin/env python3
"""Generate the slice's placeholder synth SFX as 16-bit mono WAVs.

No dependencies beyond the standard library. Deterministic (seeded) so the
committed wavs are reproducible. Run from anywhere:

    python3 turtle-wars/tools/generate_sfx.py

These are stand-ins for the real synthwave/slack-key audio pass (brief step 10).
"""
import math
import os
import random
import struct
import wave

RATE = 22050
OUT_DIR = os.path.normpath(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "assets", "sfx"))

random.seed(5)


def write_wav(name, samples):
    os.makedirs(OUT_DIR, exist_ok=True)
    path = os.path.join(OUT_DIR, name + ".wav")
    with wave.open(path, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(RATE)
        w.writeframes(b"".join(
            struct.pack("<h", max(-32767, min(32767, int(s * 32767)))) for s in samples))
    print("wrote %s (%.2fs)" % (path, len(samples) / RATE))


def square(phase):
    return 1.0 if math.sin(phase) >= 0 else -1.0


def saw(phase):
    return 2.0 * ((phase / (2 * math.pi)) % 1.0) - 1.0


def sweep(dur, f0, f1, wave_fn, decay=6.0, vol=0.8):
    """Frequency sweep with exponential amplitude decay."""
    n = int(RATE * dur)
    out, phase = [], 0.0
    for i in range(n):
        t = i / n
        phase += 2 * math.pi * (f0 + (f1 - f0) * t) / RATE
        out.append(wave_fn(phase) * vol * math.exp(-decay * t))
    return out


def tone(dur, freq, wave_fn=square, decay=5.0, vol=0.4):
    return sweep(dur, freq, freq, wave_fn, decay, vol)


def claim():
    """Bright little blip — one turf tile flips. Pitch is varied in-engine."""
    return sweep(0.09, 800, 1500, square, decay=7.0, vol=0.45)


def charge():
    """Shell-charge whoosh: swelling noise plus a dropping sine."""
    n = int(RATE * 0.22)
    out, lp, phase = [], 0.0, 0.0
    for i in range(n):
        t = i / n
        phase += 2 * math.pi * (300 - 200 * t) / RATE
        lp += 0.25 * (random.uniform(-1, 1) - lp)
        swell = math.sin(math.pi * t)
        out.append((0.5 * lp * (1 + 2 * t) + 0.4 * math.sin(phase)) * swell * 0.8)
    return out


def hit():
    """Shell-on-shell impact: pitch-dropping thump plus a noise crack."""
    n = int(RATE * 0.14)
    out, phase = [], 0.0
    for i in range(n):
        t = i / n
        phase += 2 * math.pi * (160 * math.exp(-3 * t) + 40) / RATE
        crack = random.uniform(-1, 1) * math.exp(-18 * t) * 0.6
        out.append((math.sin(phase) * math.exp(-6 * t) * 0.9 + crack) * 0.9)
    return out


def win():
    """Beach secured: rising synth arpeggio into a held chord."""
    out = []
    for f in (440, 554, 659, 880):
        out += tone(0.11, f, square, decay=4.0, vol=0.35)
    n = int(RATE * 0.5)
    phases = [0.0, 0.0, 0.0]
    for i in range(n):
        t = i / n
        s = 0.0
        for j, f in enumerate((440, 554, 659)):
            phases[j] += 2 * math.pi * f / RATE
            s += math.sin(phases[j])
        out.append(s / 3 * math.exp(-3 * t) * 0.6)
    return out


def lose():
    """The sea took the turf: long descending saw."""
    n = int(RATE * 0.7)
    out, phase = [], 0.0
    for i in range(n):
        t = i / n
        phase += 2 * math.pi * (320 * math.exp(-1.6 * t) + 60) / RATE
        out.append(saw(phase) * 0.45 * math.exp(-1.5 * t))
    return out


def flood():
    """A row of turf drowns: soft low-passed noise swell."""
    n = int(RATE * 0.3)
    out, lp = [], 0.0
    for i in range(n):
        t = i / n
        lp += 0.12 * (random.uniform(-1, 1) - lp)
        out.append(lp * math.sin(math.pi * t) * 1.6)
    return out


def thump():
    """Rising-tension heartbeat; tempo and pitch scale with the tide in-engine."""
    n = int(RATE * 0.12)
    out, phase = [], 0.0
    for i in range(n):
        t = i / n
        phase += 2 * math.pi * (62 * math.exp(-2 * t)) / RATE
        out.append(math.sin(phase) * math.exp(-5 * t) * 0.9)
    return out


if __name__ == "__main__":
    for fn in (claim, charge, hit, win, lose, flood, thump):
        write_wav(fn.__name__, fn())
