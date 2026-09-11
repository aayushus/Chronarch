function toRgb(hex: string): [number, number, number] {
  const clean = hex.replace("#", "");
  const bigint = parseInt(clean.length === 3 ? clean.split("").map((c) => c + c).join("") : clean, 16);
  return [(bigint >> 16) & 255, (bigint >> 8) & 255, bigint & 255];
}

/** Blend a hex calendar color into a low-opacity fill so event blocks read
 * as "belonging" to their calendar at a glance, instead of flat gray. */
export function tint(hex: string, alpha: number): string {
  const [r, g, b] = toRgb(hex);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

/** Pick black or white text for a solid-fill chip, by relative luminance —
 * white-on-orange/yellow calendar colors is unreadable otherwise (WCAG's
 * sRGB luminance formula, threshold picked so mid-brightness colors like
 * our default palette's orange/yellow get dark text, blue/purple/red keep
 * white). */
export function contrastText(hex: string): string {
  const [r, g, b] = toRgb(hex);
  const [rl, gl, bl] = [r, g, b].map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  });
  const luminance = 0.2126 * rl + 0.7152 * gl + 0.0722 * bl;
  return luminance > 0.55 ? "#1c1c1e" : "#ffffff";
}
