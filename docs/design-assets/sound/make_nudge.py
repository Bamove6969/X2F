# X2F nudge sound: an original synthesized bulb-horn double honk ("hah-ONK").
# Built from scratch: a bright reed buzz (band-limited sawtooth + square blend)
# through two nasal formant resonators, with a quick pitch scoop at each honk.
import numpy as np, wave
SR = 44100
def honk(dur, f0, scoop, vib=5.5):
    t = np.arange(int(SR*dur))/SR
    # pitch: starts a little low, scoops up, slight droop at the end, gentle wobble
    f = f0*(1 - scoop*np.exp(-t/0.035)) * (1 - 0.04*(t/dur)**2) * (1 + 0.006*np.sin(2*np.pi*vib*t))
    ph = 2*np.pi*np.cumsum(f)/SR
    sig = np.zeros_like(t)
    for k in range(1, 40):                      # band-limited sawtooth
        mask = (k*f) < SR/2.2
        sig += mask*np.sin(k*ph)/k
    sig += 0.35*np.sign(np.sin(ph))*0.6          # a touch of square for the reed rasp
    env = np.minimum(1, t/0.012) * np.minimum(1, (dur-t)/0.06)   # fast attack, short release
    env *= 1 - 0.25*(t/dur)                      # bulb running out of air
    return sig*env
def resonate(x, fc, bw):
    r = np.exp(-np.pi*bw/SR); th = 2*np.pi*fc/SR
    a1, a2 = -2*r*np.cos(th), r*r; y = np.zeros_like(x); y1=y2=0.0
    for i, v in enumerate(x):
        yy = v - a1*y1 - a2*y2; y[i]=yy; y2, y1 = y1, yy
    return y
def voice(x):
    return 0.55*resonate(x, 700, 180) + 0.45*resonate(x, 1450, 260) + 0.15*resonate(x, 2600, 400)
gap = np.zeros(int(SR*0.07))
a = honk(0.16, 330, 0.18)          # short "hah"
b = honk(0.34, 392, 0.22)          # longer "ONK", a third higher
s = np.concatenate([voice(a), gap, voice(b), np.zeros(int(SR*0.05))])
s = np.tanh(2.2*s/np.max(np.abs(s)))         # soft saturation for the horn bite
s = s/np.max(np.abs(s))*10**(-3/20)          # peak -3 dBFS
def write(name, x):
    with wave.open(name,'wb') as w:
        w.setnchannels(1); w.setsampwidth(2); w.setframerate(SR)
        w.writeframes((x*32767).astype('<i2').tobytes())
write('x2f-nudge.wav', s)
write('x2f-nudge-soft.wav', s*10**(-9/20))   # -12 dBFS peak for night / quiet mode
print(len(s)/SR, 'seconds')
