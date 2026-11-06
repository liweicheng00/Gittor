#!/usr/bin/env python3
"""Makes the background music of the intro video: an original jazzy lo-fi hip hop track. The script
synthesizes all sounds from sine waves and noise. No sample, melody or recording of another work is
in it.

The parts: a Rhodes with jazz chords (Gm9, C13, Fmaj9, Dm9), an upright bass, swung boom bap drums,
a soft flute melody, vinyl crackle, and a warm low-pass filter on the mix.

Usage: python3 scripts/video/music.py <seconds> <out.wav>
Needs numpy.
"""
import sys
import wave

import numpy as np

RATE = 44100
BPM = 88
BEAT = 60 / BPM
BAR = 4 * BEAT
SWING = 0.62  # The off-beat eighth is at 62 % of the beat.
rng = np.random.default_rng(11)


def hz(midi):
    return 440.0 * 2 ** ((midi - 69) / 12)


def at(beat):
    """The time of a beat position, with swing on the off-beat eighths."""
    whole = np.floor(beat)
    frac = beat - whole
    if abs(frac - 0.5) < 1e-6:
        frac = SWING
    return (whole + frac) * BEAT


def samples(seconds):
    return np.arange(int(seconds * RATE)) / RATE


def add(track, start, sig, gain=1.0):
    i = int(start * RATE)
    j = min(len(track), i + len(sig))
    if 0 <= i < j:
        track[i:j] += gain * sig[: j - i]


def lowpass(x, cutoff):
    """A one-pole low-pass filter, two times for a softer slope."""
    a = np.exp(-2 * np.pi * cutoff / RATE)
    for _ in range(2):
        y = np.empty_like(x)
        acc = 0.0
        for i, v in enumerate(x):
            acc = (1 - a) * v + a * acc
            y[i] = acc
        x = y
    return x


def echo(x, delay, feedback, mix):
    d = int(delay * RATE)
    y = x.copy()
    for i in range(d, len(y)):
        y[i] += feedback * y[i - d]
    return (1 - mix) * x + mix * y


def rhodes(midi, seconds):
    """An electric piano: FM with a bell that decays fast, and a slow tremolo."""
    t = samples(seconds)
    f = hz(midi) * (1 + 0.0015 * np.sin(2 * np.pi * 0.4 * t))  # a little tape wobble
    index = 1.6 * np.exp(-t * 6) + 0.25
    s = np.sin(2 * np.pi * f * t + index * np.sin(2 * np.pi * f * t))
    s += 0.15 * np.sin(2 * np.pi * 14 * f * t) * np.exp(-t * 40)  # the tine
    e = np.exp(-t / 1.6) * np.minimum(1, t / 0.004)
    e *= 1 + 0.12 * np.sin(2 * np.pi * 4.5 * t)
    return s * e


def bass(midi, seconds):
    t = samples(seconds)
    f = hz(midi)
    s = np.sin(2 * np.pi * f * t) + 0.35 * np.sin(4 * np.pi * f * t) + 0.1 * np.sin(6 * np.pi * f * t)
    e = np.minimum(1, t / 0.008) * np.exp(-t / 0.45)
    return np.tanh(1.5 * s) * e


def flute(midi, seconds):
    t = samples(seconds)
    vib = 1 + 0.006 * np.sin(2 * np.pi * 5.2 * t) * np.minimum(1, t / 0.35)
    f = hz(midi) * vib
    phase = 2 * np.pi * np.cumsum(f) / RATE
    s = np.sin(phase) + 0.22 * np.sin(2 * phase) + 0.06 * np.sin(3 * phase)
    breath = rng.standard_normal(len(t)) * 0.05
    e = np.minimum(1, t / 0.07) * np.minimum(1, (seconds - t) / 0.12)
    return (s + breath) * np.clip(e, 0, 1)


def kick():
    t = samples(0.45)
    f = 48 + 90 * np.exp(-t * 28)
    s = np.sin(2 * np.pi * np.cumsum(f) / RATE) * np.exp(-t * 7)
    click = rng.standard_normal(len(t)) * np.exp(-t * 400) * 0.3
    return np.tanh(2.2 * (s + click))


def snare():
    t = samples(0.3)
    body = np.sin(2 * np.pi * 185 * t) * np.exp(-t * 25)
    noise = rng.standard_normal(len(t)) * np.exp(-t * 16)
    return 0.6 * body + 0.5 * noise


def hat(open_=False):
    t = samples(0.18 if open_ else 0.06)
    noise = np.diff(rng.standard_normal(len(t)), prepend=0)
    return noise * np.exp(-t * (18 if open_ else 70))


def main():
    seconds = float(sys.argv[1])
    path = sys.argv[2]
    n = int((seconds + 3) * RATE)
    keys = np.zeros(n)
    low = np.zeros(n)
    drums = np.zeros(n)
    lead = np.zeros(n)

    # ii - V - I - vi in F, with extensions.
    chords = [
        (43, [58, 62, 65, 69, 72]),  # Gm9: Bb D F A C
        (36, [58, 64, 69, 72, 74]),  # C13: Bb E A C D
        (41, [57, 60, 64, 67, 69]),  # Fmaj9: A C E G (A)
        (38, [60, 65, 69, 72, 76]),  # Dm9: C F A C E
    ]
    # Rhodes rhythm in beats: a long chord, a push on the "and" of 2, a short one on 4.
    comp = [(0, 1.0, 1.4), (1.5, 0.55, 0.9), (3.5, 0.45, 0.8)]
    # Bass in beats, as (beat, offset in semitones from the root, length in beats).
    walk = [(0, 0, 1.2), (1.5, 7, 0.5), (2, 12, 0.9), (3, 10, 0.5), (3.5, 7, 0.6)]
    # An original flute phrase of four bars, as (beat, midi note, length in beats).
    phrase = [
        (0.5, 74, 0.5), (1, 77, 0.5), (1.5, 81, 1.2), (3, 79, 0.5), (3.5, 77, 1.0),
        (4.5, 76, 1.2), (6, 74, 0.5), (6.5, 72, 1.3),
        (8.5, 69, 0.5), (9, 72, 0.5), (9.5, 76, 1.0), (11, 79, 0.5), (11.5, 81, 1.4),
        (13, 77, 1.0), (14, 76, 0.5), (14.5, 74, 1.4),
    ]
    answer = [
        (0.5, 81, 0.5), (1, 84, 1.0), (2.5, 81, 0.5), (3, 79, 1.0),
        (4.5, 76, 0.5), (5, 79, 0.5), (5.5, 77, 1.5),
        (8.5, 76, 0.5), (9, 77, 0.5), (9.5, 79, 0.5), (10, 81, 1.5), (12, 84, 0.5), (12.5, 81, 1.0),
        (13.5, 77, 0.5), (14, 76, 0.5), (14.5, 74, 1.4),
    ]

    bars = int(seconds / BAR) + 1
    last = bars - 1
    for b in range(bars):
        root, notes = chords[b % 4]
        start = b * BAR
        for beat, gain, length in comp:
            for k, m in enumerate(notes):
                # A small strum: each note of the chord comes a little later.
                add(keys, start + at(beat) + k * 0.012, rhodes(m, length * BEAT + 0.6), 0.05 * gain)
        if b >= 2 and b < last:
            for beat, step, length in walk:
                add(low, start + at(beat), bass(root + step, length * BEAT), 0.22)
        if b >= 2 and b < last:
            # Boom bap: kick on 1 and the "and" of 2 (and of 3 in odd bars), snare on 2 and 4.
            kicks = [0, 1.5] + ([2.5] if b % 2 else [2.25])
            for beat in kicks:
                add(drums, start + at(beat), kick(), 0.42)
            for beat in (1, 3):
                add(drums, start + at(beat) + 0.012, snare(), 0.2)  # a lazy snare, a little late
            for k in range(8):
                beat = k / 2
                open_ = k == 7 and b % 4 == 3
                add(drums, start + at(beat), hat(open_), (0.032 if k % 2 else 0.022) * (1 + 0.2 * rng.random()))
        # The flute: from bar 6, a phrase and an answer, then the phrase again.
        for first, notes_ in ((6, phrase), (10, answer), (18, phrase), (22, answer)):
            if b == first:
                for beat, m, length in notes_:
                    t0 = start + at(beat % 4) + int(beat // 4) * BAR
                    add(lead, t0, flute(m, length * BEAT), 0.075)

    keys = echo(lowpass(keys, 3200), BEAT * 0.75, 0.25, 0.2)
    lead = echo(lead, BEAT * 0.75, 0.3, 0.3)
    low = lowpass(low, 500)
    drums = lowpass(drums, 5000)
    mix = keys + low + drums + lead

    # Vinyl: a quiet hiss and some clicks.
    hiss = lowpass(rng.standard_normal(n), 3000) * 0.012
    clicks = np.zeros(n)
    for i in rng.integers(0, n, int(seconds * 7)):
        clicks[i] = rng.uniform(-1, 1) * 0.12
    mix += hiss + lowpass(clicks, 4000)

    mix = np.tanh(1.3 * mix) / np.tanh(1.3)
    total = int(seconds * RATE)
    mix = mix[:total]
    fade_in = int(1.0 * RATE)
    fade_out = int(3.5 * RATE)
    mix[:fade_in] *= np.linspace(0, 1, fade_in)
    mix[-fade_out:] *= np.linspace(1, 0, fade_out) ** 1.5
    mix /= np.max(np.abs(mix)) / 0.8
    right = mix.copy()
    d = int(0.011 * RATE)
    right[d:] = 0.8 * mix[d:] + 0.2 * mix[:-d]
    data = (np.stack([mix, right], axis=1) * 32767).astype(np.int16)
    with wave.open(path, "wb") as w:
        w.setnchannels(2)
        w.setsampwidth(2)
        w.setframerate(RATE)
        w.writeframes(data.tobytes())


if __name__ == "__main__":
    main()
