from PIL import Image
from pathlib import Path

source = Path('/home/ubuntu/upload/d170eab7d1f8ce3b0dbc9fc3c88551e6.jpg')
out = Path('/home/ubuntu/work/grabpenny-app/client/public/assets/gold-icon.png')
image = Image.open(source).convert('RGB')
size = min(image.size)
left = (image.width - size) // 2
top = (image.height - size) // 2
image = image.crop((left, top, left + size, top + size)).resize((512, 512), Image.Resampling.LANCZOS).convert('RGBA')
pixels = image.load()
center = 255.5
radius = 255.5
for y in range(512):
    for x in range(512):
        distance = ((x - center) ** 2 + (y - center) ** 2) ** 0.5
        if distance > radius - 2:
            pixels[x, y] = (*pixels[x, y][:3], 0 if distance >= radius else int((radius - distance) / 2 * 255))
image.save(out, 'PNG', optimize=True)
print(out, image.size, image.mode)
