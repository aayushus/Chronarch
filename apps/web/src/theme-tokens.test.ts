/** Theme-token tripwire: card tokens must exist in BOTH themes so the
 * Mondays card language never renders light-on-light or dark-on-dark. */
import { describe, expect, it } from "vitest";
import { readFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const css = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "theme.css"), "utf8");

function block(selector: string): string {
  const start = css.indexOf(selector);
  if (start < 0) return "";
  const next = css.indexOf("[data-theme=", start + selector.length);
  const end = next < 0 ? css.length : next;
  // :root block ends at the light-theme block; light block runs to its own close.
  return css.slice(start, selector === ":root" ? css.indexOf('[data-theme="light"]') : end);
}

describe("card tokens", () => {
  for (const token of ["--card-bg", "--card-ink", "--card-muted", "--card-line", "--shadow-card"]) {
    it(`${token} is defined in both themes`, () => {
      expect(block(":root")).toContain(token);
      expect(block('[data-theme="light"]')).toContain(token);
    });
  }

  it("dark and light card backgrounds differ", () => {
    const value = (cssBlock: string, token: string) =>
      cssBlock.match(new RegExp(`${token}:\\s*([^;]+);`))?.[1].trim();
    expect(value(block(":root"), "--card-bg")).not.toBe(value(block('[data-theme="light"]'), "--card-bg"));
    expect(value(block(":root"), "--card-ink")).not.toBe(value(block('[data-theme="light"]'), "--card-ink"));
  });
});
