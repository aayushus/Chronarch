# Chronarch Brand Guidelines

## Identity

**Chronarch** = *Chrono* (time) + *Arch* (structure/control plane). The logomark is a rounded arch with a clock hand pivoting at its center — the "control plane for time" the BRD positions the product as (§37).

Logo files: [`apps/web/public/logo.svg`](apps/web/public/logo.svg).

- Minimum clear space: 0.5× the mark's height on all sides.
- Minimum size: 20px (favicon/tab) up to any size (it's vector).
- Do not recolor the mark outside the approved gradient/dark-tile combination below.
- Do not place the mark on a light background without the dark tile — it's designed as a dark app icon, not a standalone line mark.

## Color

Dark theme is the primary (and for MVP, only) theme, matching the macOS Calendar reference the UI is modeled on.

| Token | Value | Use |
|---|---|---|
| `--bg-app` | `#1c1c1e` | Main content background |
| `--bg-sidebar` | `#17171a` | Sidebar / chrome background |
| `--bg-panel` | `#232326` | Right detail panel, popovers |
| `--bg-raised` | `#2c2c2e` | Cards, hover states |
| `--border` | `#3a3a3c` | Hairlines, grid lines |
| `--text-primary` | `#f5f5f7` | Primary text |
| `--text-secondary` | `#98989d` | Secondary/meta text |
| `--text-tertiary` | `#636366` | Placeholder, disabled |
| `--accent` | `#0a84ff` | Primary accent (selection, links, today) |
| `--accent-gradient-start` | `#5ac8fa` | Logo gradient start |
| `--danger` | `#ff453a` | Destructive actions, decline |
| `--success` | `#30d158` | Accept / confirmed RSVP |
| `--warning` | `#ff9f0a` | Tentative / warnings |

**Calendar colors** (assigned per-calendar, BRD §9.11): draw from a fixed palette so colors stay distinguishable in dark mode — blue `#0a84ff`, purple `#bf5af2`, pink `#ff375f`, orange `#ff9f0a`, green `#30d158`, teal `#64d2ff`, red `#ff453a`, gray `#98989d`, yellow `#ffd60a`, indigo `#5e5ce6`.

## Typography

System font stack — no custom webfont, matching the native-app feel the BRD benchmarks against (§35):

```css
font-family: -apple-system, BlinkMacSystemFont, "SF Pro Text", "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
```

- Page/date headers: 28–34px, weight 700
- Section labels (sidebar group headers): 11–12px, weight 600, `--text-secondary`, uppercase optional
- Body / event text: 12–13px, weight 500
- Meta text (times, locations): 11–12px, weight 400, `--text-secondary`

## Spacing & shape

- Base spacing unit: 4px, scale in multiples of 4 (4/8/12/16/24/32).
- Corner radius: 6px for event blocks and inputs, 10px for panels/cards, 56px (≈22%) for the app icon tile.
- Hairline borders (`--border`) at 1px, never heavier — density and restraint over decoration, per the Apple Calendar benchmark.

## Voice

Chronarch is infrastructure, not a consumer toy — copy should be direct and unadorned ("Read only", "45 min free", "Accept") rather than cute or exclamation-heavy. It's a control plane; it should feel calm and load-bearing.
