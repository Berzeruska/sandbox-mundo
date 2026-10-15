"""Gera os ícones do app (globo em pixel art original). Rodar: python3 pwa/make-icons.py"""
import math
from PIL import Image

S = 32
img = Image.new('RGBA', (S, S), (2, 3, 10, 255))
px = img.load()
cx = cy = (S - 1) / 2
R = 11.5  # dentro da zona segura de ícone "maskable" (80% central)


def blob(x, y, blobs):
    return any((x - bx) ** 2 + (y - by) ** 2 < r * r for bx, by, r in blobs)


LAND = [(-3, -1, 6.5), (3, 3, 5.0), (-1, 5, 3.5), (4, -4, 3.0)]
DESERT = [(-1, 1, 2.6), (2, 3, 2.0)]

for j in range(S):
    for i in range(S):
        x, y = i - cx, j - cy
        d = math.hypot(x, y)
        if d <= R:
            nz = math.sqrt(max(0, 1 - (d / R) ** 2))
            light = 0.45 + 0.65 * max(0, (-0.42 * x / R - 0.5 * y / R + 0.76 * nz))
            if y < -R * 0.78:
                base = (236, 244, 250)
            elif blob(x, y, DESERT):
                base = (222, 190, 120)
            elif blob(x, y, LAND):
                base = (62, 150, 62)
            else:
                base = (34, 84, 160)
            px[i, j] = tuple(min(255, int(c * light)) for c in base) + (255,)
        elif d <= R + 1.4:
            px[i, j] = (60, 110, 220, 255)

for size, name in [(512, 'icon-512.png'), (192, 'icon-192.png'), (180, 'apple-touch-icon.png')]:
    img.resize((size, size), Image.NEAREST).save(f'public/icons/{name}')
