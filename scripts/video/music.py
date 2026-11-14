#!/usr/bin/env python3
"""Makes the music of a short video: a WAV file that numpy computes, with no samples and no service.

    python3 music.py <spec.json> <out.wav>

The spec: {"duration": seconds, "end": the start of the end card, "accents": [seconds, ...],
"style": "pulse" | "lofi" | "drive"}. The tempo changes a little so that a bar starts at "end": the
last chord and the two notes of the logo come with the end card. A bell marks each accent.
"""
import json
import sys
import wave

import numpy as np

SR = 44100
rng = np.random.default_rng(7)

STYLES = {
    # Soft plucks in eighths, a low kick, light hats.
    "pulse": {"bpm": 104, "arp": 2, "keys": False, "kick": [0, 2], "snare": [], "hats": 2, "bass": [0, 2.5], "tone": 0.0, "noise": 0.0},
    # A slow electric piano, a soft snare, swing, the hiss of a tape.
    "lofi": {"bpm": 82, "arp": 0, "keys": True, "kick": [0, 2.5], "snare": [1, 3], "hats": 2, "bass": [0, 2.5], "tone": 0.55, "noise": 0.0025},
    # Sixteenths, a kick on each beat, a bass in eighths.
    "drive": {"bpm": 122, "arp": 4, "keys": False, "kick": [0, 1, 2, 3], "snare": [1, 3], "hats": 4, "bass": [0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5], "tone": 0.0, "noise": 0.0},
}
# vi, IV, I, V in C major: the root of the bass and the notes of the chord, as MIDI numbers.
CHORDS = [(45, [57, 60, 64, 71]), (41, [57, 60, 64, 65]), (48, [55, 60, 64, 67]), (43, [55, 59, 62, 67])]
HOME = (48, [55, 60, 64, 67, 74])


def hz(midi):
    return 440.0 * 2 ** ((midi - 69) / 12)


def clock(seconds):
    return np.arange(int(seconds * SR)) / SR


def attack(sig, seconds=0.004):
    n = min(len(sig), int(seconds * SR))
    sig[:n] *= np.linspace(0, 1, n)
    return sig


def pluck(midi, seconds=0.9, bright=1.0):
    t, f = clock(seconds), hz(midi)
    return attack(sum(np.sin(2 * np.pi * k * f * t) / k * np.exp(-t * (2.5 + k * 3.0 / bright)) for k in range(1, 7)))


def bell(midi, seconds=1.8):
    t, f = clock(seconds), hz(midi)
    return attack(np.sin(2 * np.pi * f * t + 1.8 * np.exp(-t * 7) * np.sin(2 * np.pi * 3.5 * f * t)) * np.exp(-t / 0.55))


def keys(midi, seconds=2.2):
    t, f = clock(seconds), hz(midi)
    tine = 0.25 * np.sin(2 * np.pi * 14 * f * t) * np.exp(-t * 30)
    return attack((np.sin(2 * np.pi * f * t + 1.3 * np.exp(-t * 4) * np.sin(2 * np.pi * f * t)) + tine) * np.exp(-t / 0.9), 0.008)


def pad(midi, seconds):
    t, f = clock(seconds), hz(midi)
    sig = np.sin(2 * np.pi * f * 0.997 * t) + np.sin(2 * np.pi * f * 1.003 * t) + 0.25 * np.sin(2 * np.pi * 2 * f * t)
    edge = min(len(t) // 2, int(0.5 * SR))
    sig[:edge] *= np.linspace(0, 1, edge)
    sig[-edge:] *= np.linspace(1, 0, edge)
    return sig


def bass(midi, seconds):
    t, f = clock(seconds), hz(midi)
    sig = attack(np.sin(2 * np.pi * f * t + 0.6 * np.sin(2 * np.pi * f * t)) * np.exp(-t / (seconds * 0.7)), 0.006)
    tail = min(len(sig), int(0.03 * SR))
    sig[-tail:] *= np.linspace(1, 0, tail)
    return sig


def kick():
    t = clock(0.35)
    return attack(np.sin(2 * np.pi * (45 * t - 90 / 30 * (np.exp(-t * 30) - 1))) * np.exp(-t * 11), 0.002)


def hat(seconds=0.06):
    t = clock(seconds)
    return np.diff(rng.standard_normal(len(t) + 1)) * np.exp(-t * 70)


def snare():
    t = clock(0.22)
    return 0.7 * np.diff(rng.standard_normal(len(t) + 1)) * np.exp(-t * 22) + 0.5 * np.sin(2 * np.pi * 190 * t) * np.exp(-t * 28)


class Bus:
    def __init__(self, seconds):
        self.n = int(seconds * SR)
        self.out = np.zeros((2, self.n))

    def add(self, sig, at, gain=1.0, pan=0.0):
        i = int(at * SR)
        if i < 0 or i >= self.n:
            return
        sig = sig[: self.n - i]
        angle = (pan + 1) * np.pi / 4
        self.out[0, i : i + len(sig)] += sig * gain * np.cos(angle)
        self.out[1, i : i + len(sig)] += sig * gain * np.sin(angle)


def reverb(stereo, seconds=1.6, wet=0.22):
    """A room: each channel with its own burst of noise that fades."""
    t = clock(seconds)
    size = 1 << int(np.ceil(np.log2(stereo.shape[1] + len(t))))
    out = stereo.copy()
    for ch in range(2):
        room = rng.standard_normal(len(t)) * np.exp(-t * 4.2)
        room /= np.sqrt(np.sum(room**2))
        tail = np.fft.irfft(np.fft.rfft(stereo[ch], size) * np.fft.rfft(room, size), size)[: stereo.shape[1]]
        out[ch] += wet * tail
    return out


def lowpass(stereo, amount):
    """Removes the top of the sound; amount 0 to 1."""
    if amount <= 0:
        return stereo
    spectrum = np.fft.rfft(stereo, axis=1)
    freq = np.fft.rfftfreq(stereo.shape[1], 1 / SR)
    cut = 9000 - 6000 * amount
    return np.fft.irfft(spectrum / np.sqrt(1 + (freq / cut) ** 4), stereo.shape[1], axis=1)


def compose(spec):
    style = STYLES[spec.get("style", "pulse")]
    duration, end = spec["duration"], spec["end"]
    bars = max(2, round(end / (240 / style["bpm"])))
    beat = end / (bars * 4)
    dry, wet = Bus(duration), Bus(duration)
    swing = beat * 0.08 if style["keys"] else 0.0

    for b in range(bars):
        t0 = b * 4 * beat
        root, chord = CHORDS[b % 4]
        full = b >= 1  # The first bar is thin: the drums and the bass start at bar 2.
        for m in chord[:3]:
            wet.add(pad(m, 4 * beat + 0.4), t0, 0.035)
        if style["arp"]:
            step = beat / (style["arp"] / 2) / 2
            order = [0, 2, 1, 3, 2, 1, 3, 2] if style["arp"] == 2 else [0, 1, 2, 3, 2, 1, 2, 3, 0, 2, 1, 3, 2, 1, 3, 2]
            for i, k in enumerate(order):
                wet.add(pluck(chord[k] + 12, 0.8, 1.0 if style["arp"] == 2 else 1.6), t0 + i * step, 0.11 if i % 2 == 0 else 0.075, 0.5 * (-1) ** i)
                wet.add(pluck(chord[k] + 12, 0.8), t0 + i * step + 0.75 * beat, 0.03, -0.5 * (-1) ** i)
        if style["keys"]:
            for at in (0, 1.5, 2.5):
                for j, m in enumerate(chord):
                    wet.add(keys(m), t0 + at * beat + j * 0.018, 0.085 if at == 0 else 0.055, (j - 1.5) * 0.3)
        if not full:
            continue
        for at in style["bass"]:
            dry.add(bass(root - 12 if root > 44 else root, beat * (0.45 if len(style["bass"]) > 4 else 1.4)), t0 + at * beat, 0.34)
        for at in style["kick"]:
            dry.add(kick(), t0 + at * beat, 0.55)
        for at in style["snare"]:
            dry.add(snare(), t0 + at * beat, 0.16)
            wet.add(snare(), t0 + at * beat, 0.05)
        if b >= 2:
            n = 4 * style["hats"]
            for i in range(n):
                off = swing if i % 2 else 0.0
                dry.add(hat(), t0 + i * 4 * beat / n + off, (0.04 if i % 2 else 0.022) * (1.5 if style["hats"] == 4 and i % 4 == 2 else 1), 0.25)

    # A bell on each accent, on the sixteenth that is nearest, with a note of the chord of that bar.
    for i, at in enumerate(a for a in spec.get("accents", []) if 0.2 < a < end - beat):
        at = round(at / (beat / 4)) * beat / 4
        chord = CHORDS[int(at // (4 * beat)) % 4][1]
        wet.add(bell(chord[(i * 2) % 3] + 24), at, 0.11, 0.3 * (-1) ** i)

    # The end card: the home chord, a long bass note, and the two notes of the logo.
    root, chord = HOME
    for j, m in enumerate(chord):
        wet.add(pad(m, duration - end + 0.3), end, 0.05)
        wet.add((keys if style["keys"] else pluck)(m + 12, 2.5), end + j * 0.03, 0.1, (j - 2) * 0.25)
    dry.add(bass(root - 12, duration - end), end, 0.36)
    dry.add(kick(), end, 0.5)
    wet.add(bell(79), end + 0.5 * beat, 0.16, -0.2)
    wet.add(bell(84), end + 1.0 * beat, 0.19, 0.2)

    mix = dry.out + reverb(wet.out)
    if style["noise"]:
        mix += style["noise"] * rng.standard_normal(mix.shape)
    mix = lowpass(mix, style["tone"])
    fade = int(0.7 * SR)
    mix[:, -fade:] *= np.linspace(1, 0, fade) ** 2
    mix[:, : int(0.05 * SR)] *= np.linspace(0, 1, int(0.05 * SR))
    # A soft limit, then the peak at -1 dB.
    mix = np.tanh(mix / (np.sqrt(np.mean(mix**2)) * 5.5))
    return mix / np.max(np.abs(mix)) * 0.89, 60 / beat, bars


def main():
    spec = json.load(open(sys.argv[1]))
    mix, bpm, bars = compose(spec)
    with wave.open(sys.argv[2], "wb") as f:
        f.setnchannels(2)
        f.setsampwidth(2)
        f.setframerate(SR)
        f.writeframes((mix.T * 32767).astype("<i2").tobytes())
    print(f"{spec.get('style', 'pulse')}: {bpm:.1f} bpm, {bars} bars, {spec['duration']:.1f} s")


if __name__ == "__main__":
    main()
