"""Draw the app icon, adaptive-icon layers and splash screens (run once; outputs are committed)."""
from PIL import Image, ImageDraw, ImageFont, ImageFilter
import os, sys
ROOT = os.path.join(os.path.dirname(__file__), '..')
RES = os.path.join(ROOT, 'android/app/src/main/res')
SANS = '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf'
SERIF = '/usr/share/fonts/truetype/dejavu/DejaVuSerif-Bold.ttf'
GREEN_A, GREEN_B = (47, 174, 104), (10, 60, 34)

def felt(size):
    im = Image.new('RGB', (size, size), GREEN_B)
    d = ImageDraw.Draw(im)
    for r in range(size // 2, 0, -2):
        t = r / (size / 2)
        c = tuple(int(GREEN_A[k] * (1 - t) + GREEN_B[k] * t) for k in range(3))
        d.ellipse((size / 2 - r * 1.15, size * 0.45 - r, size / 2 + r * 1.15, size * 0.45 + r), fill=c)
    return im

def card(w, h, rank, suit, red, angle):
    im = Image.new('RGBA', (w + 40, h + 40), (0, 0, 0, 0))
    sh = Image.new('RGBA', im.size, (0, 0, 0, 0))
    ImageDraw.Draw(sh).rounded_rectangle((26, 30, w + 26, h + 30), radius=w * 0.1, fill=(0, 0, 0, 110))
    sh = sh.filter(ImageFilter.GaussianBlur(w * 0.04))
    im.alpha_composite(sh)
    d = ImageDraw.Draw(im)
    d.rounded_rectangle((20, 20, w + 20, h + 20), radius=w * 0.1, fill=(251, 248, 241), outline=(226, 220, 205), width=max(2, w // 60))
    col = (179, 36, 43) if red else (28, 28, 30)
    f1 = ImageFont.truetype(SERIF, int(w * 0.26)); f2 = ImageFont.truetype(SANS, int(w * 0.2)); f3 = ImageFont.truetype(SANS, int(w * 0.62))
    d.text((20 + w * 0.08, 20 + h * 0.04), rank, font=f1, fill=col)
    d.text((20 + w * 0.09, 20 + h * 0.04 + w * 0.3), suit, font=f2, fill=col)
    d.text((20 + w / 2, 20 + h * 0.58), suit, font=f3, fill=col, anchor='mm')
    return im.rotate(angle, resample=Image.BICUBIC, expand=True)

def art(size, transparent=False):
    """Two fanned aces, centred, filling about 62% of the square."""
    im = Image.new('RGBA', (size, size), (0, 0, 0, 0)) if transparent else felt(size).convert('RGBA')
    w = int(size * 0.34); h = int(w * 1.42)
    a = card(w, h, 'A', '♥', True, 14)
    b = card(w, h, 'A', '♠', False, -12)
    im.alpha_composite(a, (int(size * 0.5 - a.width * 0.86), int(size * 0.5 - a.height / 2)))
    im.alpha_composite(b, (int(size * 0.5 - b.width * 0.18), int(size * 0.5 - b.height / 2 + size * 0.01)))
    return im

def rounded(im, radius):
    m = Image.new('L', im.size, 0)
    ImageDraw.Draw(m).rounded_rectangle((0, 0, im.width - 1, im.height - 1), radius=radius, fill=255)
    out = Image.new('RGBA', im.size, (0, 0, 0, 0)); out.paste(im, (0, 0), m); return out

def circle(im):
    m = Image.new('L', im.size, 0); ImageDraw.Draw(m).ellipse((0, 0, im.width - 1, im.height - 1), fill=255)
    out = Image.new('RGBA', im.size, (0, 0, 0, 0)); out.paste(im, (0, 0), m); return out

master = art(1024)
os.makedirs(os.path.join(ROOT, 'icons'), exist_ok=True)
rounded(master, 220).save(os.path.join(ROOT, 'icons/icon-512.png').replace('512', '1024'))
rounded(master.resize((512, 512), Image.LANCZOS), 110).save(os.path.join(ROOT, 'icons/icon-512.png'))
fg_master = Image.new('RGBA', (1024, 1024), (0, 0, 0, 0))
inner = art(int(1024 * 0.62), transparent=True)
fg_master.alpha_composite(inner, ((1024 - inner.width) // 2, (1024 - inner.height) // 2))
bg_master = felt(1024)
for name, legacy, fg in [('mdpi', 48, 108), ('hdpi', 72, 162), ('xhdpi', 96, 216), ('xxhdpi', 144, 324), ('xxxhdpi', 192, 432)]:
    dd = os.path.join(RES, f'mipmap-{name}')
    rounded(master.resize((legacy, legacy), Image.LANCZOS), legacy * 0.2).save(os.path.join(dd, 'ic_launcher.png'))
    circle(master.resize((legacy, legacy), Image.LANCZOS)).save(os.path.join(dd, 'ic_launcher_round.png'))
    fg_master.resize((fg, fg), Image.LANCZOS).save(os.path.join(dd, 'ic_launcher_foreground.png'))
    bg_master.resize((fg, fg), Image.LANCZOS).save(os.path.join(dd, 'ic_launcher_background.png'))

def splash(w, h):
    im = Image.new('RGB', (w, h), (5, 16, 11))
    d = ImageDraw.Draw(im)
    s = min(w, h)
    for r in range(int(s * 0.7), 0, -3):
        t = r / (s * 0.7)
        c = tuple(int((24, 90, 55)[k] * (1 - t) + (5, 16, 11)[k] * t) for k in range(3))
        d.ellipse((w / 2 - r * 1.3, h / 2 - r, w / 2 + r * 1.3, h / 2 + r), fill=c)
    ic = rounded(master.resize((int(s * 0.36), int(s * 0.36)), Image.LANCZOS), int(s * 0.08))
    im.paste(ic, ((w - ic.width) // 2, int(h / 2 - ic.height * 0.72)), ic)
    f = ImageFont.truetype(SANS, int(s * 0.075))
    d.text((w / 2, h / 2 + s * 0.2), 'Italian Bridge', font=f, fill=(255, 233, 168), anchor='mm')
    return im
for dd in os.listdir(RES):
    p = os.path.join(RES, dd, 'splash.png')
    if dd.startswith('drawable') and os.path.exists(p):
        w, h = Image.open(p).size
        splash(w, h).save(p)
print('icons and splash screens written')
