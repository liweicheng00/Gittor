#!/usr/bin/env python3
"""Makes the background music of the intro video: a calm electronic track that this script
synthesizes from sine waves and noise. No sample or recording of another work is in it.

Usage: python3 scripts/video/music.py <seconds> <out.wav>
Needs numpy.
"""
import sys
import wave

import numpy as np

RATE = 44100
BPM = 100
BEAT = 60 / BPM
BAR = 4 * BEAT
rng = np.random.default_rng(7)


def hz(midi):
    return 440.0 * 2 ** ((midi - 69) / 12)


def env(n, attack, release):
    """A linear attack and an exponential decay over n samples."""
    t = np.arange(n) / RATE
    e = np.exp(-t / release)
    a = int(attack * RATE)
    if a > 0:
        e[:a] *= np.linspace(0, 1, a)
    return e


def tone(freq, seconds, harmonics=((1, 1.0),), detune=0.0):
    t = np.arange(int(seconds * RATE)) / RATE
    out = np.zeros_like(t)
    for k, amp in harmonics:
        out += amp * np.sin(2 * np.pi * freq * k * t)
        if detune:
            out += amp * np.sin(2 * np.pi * freq * k * (1 + detune) * t + 1.3)
    return out


def add(track, start, sig, gain=1.0):
    i = int(start * RATE)
    j = min(len(track), i + len(sig))
    if i < j:
        track[i:j] += gain * sig[: j - i]


def lowpass(x, cutoff):
    """A one-pole low-pass filter."""
    a = np.exp(-2 * np.pi * cutoff / RATE)
    y = np.empty_like(x)
    acc = 0.0
    for i, v in enumerate(x):
        acc = (1 - a) * v + a * acc
        y[i] = acc
    return y


def echo(x, delay, feedback, mix):
    d = int(delay * RATE)
    y = x.copy()
    for i in range(d, len(y)):
        y[i] += feedback * y[i - d]
    return (1 - mix) * x + mix * y


def main():
    seconds = float(sys.argv[1])
    path = sys.argv[2]
    n = int((seconds + 2) * RATE)
    pad = np.zeros(n)
    keys = np.zeros(n)
    bass = np.zeros(n)
    drums = np.zeros(n)

    # Cmaj9 - Am9 - Fmaj7 - G6, two bars each chord would be slow; one bar each.
    chords = [
        (48, [60, 64, 67, 71, 74]),
        (45, [57, 60, 64, 67, 71]),
        (41, [57, 60, 64, 65, 69]),
        (43, [55, 59, 62, 64, 67]),
    ]
    bars = int(seconds / BAR) + 1
    pad_h = ((1, 1.0), (2, 0.25), (3, 0.08))
    key_h = ((1, 1.0), (2, 0.35), (3, 0.12), (4, 0.05))
    for b in range(bars):
        root, notes = chords[b % 4]
        start = b * BAR
        # The pad: soft, detuned, with a slow attack.
        for m in notes[:4]:
            s = tone(hz(m), BAR + 1.5, pad_h, detune=0.003)
            s *= env(len(s), 0.9, 2.5)
            add(pad, start, s, 0.05)
        # The arpeggio: eighth notes, from bar 2.
        if b >= 1:
            order = [0, 2, 4, 3, 1, 3, 2, 4]
            for k, idx in enumerate(order):
                m = notes[idx] + 12 * (1 if k % 4 == 2 else 0)
                s = tone(hz(m), 1.2, key_h) * env(int(1.2 * RATE), 0.004, 0.22)
                add(keys, start + k * BEAT / 2, s, 0.07 if k % 2 == 0 else 0.05)
        # The bass, from bar 3.
        if b >= 2:
            for k, beat in enumerate([0, 1.5, 2, 3.5]):
                s = tone(hz(root), 0.6, ((1, 1.0), (2, 0.3))) * env(int(0.6 * RATE), 0.01, 0.25)
                add(bass, start + beat * BEAT, s, 0.16 if k % 2 == 0 else 0.1)
        # The drums, from bar 5: a soft kick, a rim on 2 and 4, and closed hats.
        if b >= 4:
            for beat in range(4):
                t = np.arange(int(0.35 * RATE)) / RATE
                kick = np.sin(2 * np.pi * (45 + 70 * np.exp(-t * 30)) * t) * np.exp(-t * 9)
                if beat in (0, 2):
                    add(drums, start + beat * BEAT, kick, 0.32)
                if beat in (1, 3):
                    noise = rng.standard_normal(int(0.12 * RATE)) * env(int(0.12 * RATE), 0.001, 0.03)
                    add(drums, start + beat * BEAT, noise, 0.06)
            for k in range(8):
                hat = np.diff(rng.standard_normal(int(0.05 * RATE)), prepend=0) * env(int(0.05 * RATE), 0.0005, 0.012)
                add(drums, start + k * BEAT / 2, hat, 0.03 if k % 2 else 0.018)

    keys = echo(keys, BEAT * 0.75, 0.35, 0.35)
    pad = lowpass(pad, 2200)
    bass = lowpass(bass, 400)
    mix = pad + keys + bass + drums
    # A fade in at the start and a fade out at the end.
    total = int(seconds * RATE)
    mix = mix[:total]
    fade_in = int(1.5 * RATE)
    fade_out = int(3.5 * RATE)
    mix[:fade_in] *= np.linspace(0, 1, fade_in)
    mix[-fade_out:] *= np.linspace(1, 0, fade_out) ** 1.5
    mix /= np.max(np.abs(mix)) / 0.7
    # A small stereo width: the arpeggio echo goes a little to the right.
    right = mix.copy()
    d = int(0.012 * RATE)
    right[d:] = 0.85 * mix[d:] + 0.15 * mix[:-d]
    data = (np.stack([mix, right], axis=1) * 32767).astype(np.int16)
    with wave.open(path, "wb") as w:
        w.setnchannels(2)
        w.setsampwidth(2)
        w.setframerate(RATE)
        w.writeframes(data.tobytes())


if __name__ == "__main__":
    main()
