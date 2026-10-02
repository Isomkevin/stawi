"""Build public/og.png from the landing hero and the public headline."""

from PIL import Image, ImageDraw, ImageFont

hero = Image.open("src/assets/hero.png").convert("RGB")
width, height = 1200, 630
background = (35, 60, 49)
lime = (210, 243, 128)
cream = (244, 241, 232)
muted = (196, 208, 196)

canvas = Image.new("RGB", (width, height), background)
scale = height / hero.height
resized = hero.resize((int(hero.width * scale), height), Image.Resampling.LANCZOS)
paste_x = width - resized.width + 36
canvas.paste(resized, (paste_x, 0))

fade_width = 200
mask = Image.new("L", (fade_width, height), 0)
mask_draw = ImageDraw.Draw(mask)
for column in range(fade_width):
    mask_draw.line([(column, 0), (column, height)], fill=int(255 * (1 - column / (fade_width - 1))))
veil = Image.new("RGB", (fade_width, height), background)
canvas.paste(veil, (paste_x - 24, 0), mask)

draw = ImageDraw.Draw(canvas)
brand = ImageFont.truetype(r"C:\Windows\Fonts\segoeuib.ttf", 28)
headline = ImageFont.truetype(r"C:\Windows\Fonts\segoeuib.ttf", 54)
detail = ImageFont.truetype(r"C:\Windows\Fonts\segoeui.ttf", 26)

draw.text((64, 148), "STAWI", font=brand, fill=lime)
lines = ["One payment in.", "Every farmer paid,", "same day."]
cursor = 198
for index, line in enumerate(lines):
    draw.text((64, cursor), line, font=headline, fill=lime if index == 0 else cream)
    cursor += 64
draw.text((64, cursor + 20), "0.8% flat. Same-day KES to M-Pesa or a bank.", font=detail, fill=muted)

canvas.save("public/og.png", "PNG", optimize=True)
print(f"wrote public/og.png {canvas.size}")
