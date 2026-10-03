"""Recolor Recordly's blue icon to crimson, add gold sparkles and an avatar badge.

Usage: python3 make_icon.py <blue-1024.png> <out.png> <mac|rounded|flat> [avatar.png]

The blue masters are the upstream icons (git show c9e62fb3~1:<path>):
public/app-icons/recordlymac-1024.png (mac), icons/icons/png/1024x1024.png
(rounded) and public/app-icons/recordly-1024.png (flat). Needs Pillow and NumPy.
"""
import sys

import numpy as np
from PIL import Image, ImageChops, ImageDraw, ImageFilter


def rgb_to_hsv(rgb):
    r, g, b = rgb[..., 0], rgb[..., 1], rgb[..., 2]
    maxc = rgb.max(-1)
    minc = rgb.min(-1)
    delta = maxc - minc
    v = maxc
    s = np.where(maxc > 1e-6, delta / np.maximum(maxc, 1e-6), 0.0)
    safe = np.maximum(delta, 1e-6)
    rc, gc, bc = (maxc - r) / safe, (maxc - g) / safe, (maxc - b) / safe
    h = np.where(r == maxc, bc - gc, np.where(g == maxc, 2.0 + rc - bc, 4.0 + gc - rc))
    h = np.where(delta > 1e-6, (h / 6.0) % 1.0, 0.0)
    return h, s, v


def hsv_to_rgb(h, s, v):
    i = np.floor(h * 6.0).astype(int) % 6
    f = h * 6.0 - np.floor(h * 6.0)
    p, q, t = v * (1 - s), v * (1 - s * f), v * (1 - s * (1 - f))
    choices = [(v, t, p), (q, v, p), (p, v, t), (p, q, v), (t, p, v), (v, p, q)]
    out = np.zeros(h.shape + (3,), dtype=np.float32)
    for index, (rr, gg, bb) in enumerate(choices):
        mask = i == index
        out[..., 0] = np.where(mask, rr, out[..., 0])
        out[..., 1] = np.where(mask, gg, out[..., 1])
        out[..., 2] = np.where(mask, bb, out[..., 2])
    return out


def recolor(image):
    """Blue -> crimson at the top, warming to red-orange at the bottom."""
    data = np.asarray(image.convert("RGBA")).astype(np.float32) / 255.0
    rgb, alpha = data[..., :3], data[..., 3]
    h, s, v = rgb_to_hsv(rgb)
    height = rgb.shape[0]
    y = np.linspace(0.0, 1.0, height)[:, None] * np.ones((1, rgb.shape[1]))

    saturated = s > 0.25
    source_hue = float(np.median(h[saturated & (alpha > 0.9)]))
    target = (0.968 + 0.05 * y) % 1.0  # 348 deg at the top to 6 deg at the bottom
    new_h = (target + (h - source_hue)) % 1.0

    # Deepen the bright top so it reads crimson rather than neon, and keep the
    # pale bottom red instead of salmon. Pale glass highlights barely change.
    weight = np.clip((s - 0.18) / 0.25, 0.0, 1.0)
    new_v = v * (1.0 - weight * (0.16 - 0.08 * y))
    new_s = np.clip(s + weight * (1.0 - s) * (0.28 * y), 0.0, 1.0)
    out = hsv_to_rgb(new_h, new_s, new_v)
    result = np.dstack([out, alpha])
    return Image.fromarray((np.clip(result, 0, 1) * 255).astype(np.uint8), "RGBA")


def sparkle_mask(size, cx, cy, radius, scale=4, power=2.6):
    """Four-point star with concave sides, supersampled for smooth edges."""
    big = Image.new("L", (size * scale, size * scale), 0)
    t = np.linspace(0, 2 * np.pi, 720, endpoint=False)
    cos, sin = np.cos(t), np.sin(t)
    xs = cx + radius * np.sign(cos) * np.abs(cos) ** power
    ys = cy + radius * np.sign(sin) * np.abs(sin) ** power
    ImageDraw.Draw(big).polygon(
        [(x * scale, y * scale) for x, y in zip(xs, ys)], fill=255
    )
    return big.resize((size, size), Image.LANCZOS)


def add_sparkles(image, stars):
    size = image.size[0]
    base = image.copy()
    # Everything added stays inside the icon's own shape.
    shape = image.getchannel("A")

    star_alpha = Image.new("L", (size, size), 0)
    for cx, cy, radius in stars:
        star_alpha = ImageChops.lighter(
            star_alpha, sparkle_mask(size, cx * size, cy * size, radius * size)
        )

    # Warm glow behind the stars.
    glow = star_alpha.filter(ImageFilter.GaussianBlur(size * 0.016))
    glow = ImageChops.multiply(glow.point(lambda value: int(value * 0.6)), shape)
    glow_layer = Image.new("RGBA", (size, size), (255, 214, 120, 0))
    glow_layer.putalpha(glow)
    base = Image.alpha_composite(base, glow_layer)

    # Gold body: pale champagne at the top to deep gold at the bottom.
    gradient = np.zeros((size, size, 4), dtype=np.uint8)
    top = np.array([255, 246, 214], dtype=np.float32)
    bottom = np.array([246, 184, 58], dtype=np.float32)
    mix = np.linspace(0, 1, size)[:, None, None]
    gradient[..., :3] = (top * (1 - mix) + bottom * mix).astype(np.uint8)
    gradient[..., 3] = np.asarray(ImageChops.multiply(star_alpha, shape))
    base = Image.alpha_composite(base, Image.fromarray(gradient, "RGBA"))

    # White glint in each star's center.
    glint = Image.new("L", (size, size), 0)
    for cx, cy, radius in stars:
        glint = ImageChops.lighter(
            glint,
            sparkle_mask(size, cx * size, cy * size, radius * size * 0.42, power=3.2),
        )
    glint_layer = Image.new("RGBA", (size, size), (255, 255, 255, 0))
    glint_layer.putalpha(glint.point(lambda value: int(value * 0.9)))
    return Image.alpha_composite(base, glint_layer)


def rounded_mask(size, box, radius, scale=4):
    big = Image.new("L", (size * scale, size * scale), 0)
    ImageDraw.Draw(big).rounded_rectangle(
        [coordinate * scale for coordinate in box], radius=radius * scale, fill=255
    )
    return big.resize((size, size), Image.LANCZOS)


def add_avatar_badge(image, avatar_path, center, badge_size, border):
    """A rounded tag with the owner's avatar on the icon's bottom-right corner."""
    size = image.size[0]
    cx, cy = center[0] * size, center[1] * size
    outer = badge_size * size
    ring = border * size
    radius = outer * 0.3
    box = (cx - outer / 2, cy - outer / 2, cx + outer / 2, cy + outer / 2)
    inner_box = (box[0] + ring, box[1] + ring, box[2] - ring, box[3] - ring)
    base = image.copy()

    # Soft shadow under the tag.
    shadow_box = (box[0], box[1] + outer * 0.02, box[2], box[3] + outer * 0.02)
    shadow = rounded_mask(size, shadow_box, radius).filter(ImageFilter.GaussianBlur(outer * 0.03))
    shadow_layer = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    shadow_layer.putalpha(shadow.point(lambda value: int(value * 0.28)))
    base = Image.alpha_composite(base, shadow_layer)

    # White rim.
    rim = Image.new("RGBA", (size, size), (255, 255, 255, 0))
    rim.putalpha(rounded_mask(size, box, radius))
    base = Image.alpha_composite(base, rim)

    # Avatar, cropped in on the face.
    avatar = Image.open(avatar_path).convert("RGB")
    width, height = avatar.size
    crop = min(width, height) * 0.74
    left, top = (width - crop) / 2, (height - crop) / 2 - crop * 0.03
    avatar = avatar.crop((left, top, left + crop, top + crop))
    inner = int(round(inner_box[2] - inner_box[0]))
    avatar = avatar.resize((inner, inner), Image.LANCZOS)
    photo = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    photo.paste(avatar, (int(round(inner_box[0])), int(round(inner_box[1]))))
    photo.putalpha(rounded_mask(size, inner_box, radius - ring))
    return Image.alpha_composite(base, photo)


if __name__ == "__main__":
    source, destination, layout = sys.argv[1], sys.argv[2], sys.argv[3]
    image = Image.open(source).convert("RGBA")
    if image.size[0] != 1024:
        image = image.resize((1024, 1024), Image.LANCZOS)
    # Star centers and radii as fractions of the icon size.
    stars = {
        # macOS squircle with transparent margin.
        "mac": [(0.785, 0.222, 0.07), (0.848, 0.318, 0.024), (0.712, 0.148, 0.014)],
        # Rounded square with transparent corners.
        "rounded": [(0.80, 0.20, 0.078), (0.875, 0.30, 0.027), (0.71, 0.12, 0.016)],
        # Full-bleed square.
        "flat": [(0.835, 0.165, 0.085), (0.915, 0.275, 0.030), (0.735, 0.085, 0.018)],
    }[layout]
    badge = {
        "mac": ((0.79, 0.79), 0.27, 0.016),
        "rounded": ((0.80, 0.80), 0.29, 0.016),
        "flat": ((0.81, 0.81), 0.30, 0.016),
    }[layout]
    icon = add_sparkles(recolor(image), stars)
    if len(sys.argv) > 4:
        icon = add_avatar_badge(icon, sys.argv[4], *badge)
    icon.save(destination)
