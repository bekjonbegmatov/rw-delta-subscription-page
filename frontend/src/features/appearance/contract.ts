import { z } from "zod";

const color = z.string().regex(/^#[0-9a-fA-F]{6}$/);
const percent = z.number().int().min(0).max(100);
export const patternNames = {
  none: "Нет", grid: "Сетка", dots: "Точки", lines: "Линии", diagonal: "Диагональ",
  checker: "Шахматы", diamonds: "Ромбы", triangles: "Треугольники", hexagons: "Соты",
  crosshatch: "Штриховка", crosses: "Крестики", zigzag: "Зигзаг", waves: "Волны",
  scales: "Чешуя", rings: "Кольца", circles: "Круги", bricks: "Кирпичи",
  weave: "Плетение", herringbone: "Ёлочка", isometric: "Кубы", stars: "Звёзды",
  confetti: "Конфетти", circuit: "Схема", topography: "Рельеф", rain: "Штрихи",
} as const;
export const gradientNames = {
  none: "Без градиента", linear: "Линейный", radial: "Мягкое сияние", conic: "Конический",
  mesh: "Цветовые облака", aurora: "Северное сияние", spotlight: "Прожектор",
  horizon: "Горизонт", diagonal_glow: "Световая диагональ", duotone: "Два полюса",
} as const;
export const effectNames = { none: "Без эффекта", snow: "Снег", stars: "Мерцание звёзд", rain: "Дождь", fireflies: "Светлячки", bubbles: "Пузырьки", aurora: "Живое сияние" } as const;
export const themeSchema = z.strictObject({
  accent: color, accent_secondary: color, background: color, surface: color,
  text: color, muted: color, border: color, gradient_from: color, gradient_to: color,
  gradient_type: z.enum(Object.keys(gradientNames) as [keyof typeof gradientNames, ...(keyof typeof gradientNames)[]]),
  gradient_angle: z.number().int().min(0).max(360), gradient_opacity: percent,
  pattern: z.enum(Object.keys(patternNames) as [keyof typeof patternNames, ...(keyof typeof patternNames)[]]),
  pattern_color: color, pattern_opacity: percent, pattern_size: z.number().int().min(12).max(120),
  card_radius: z.number().int().min(0).max(32), card_opacity: percent,
  effect: z.enum(Object.keys(effectNames) as [keyof typeof effectNames, ...(keyof typeof effectNames)[]]).default("none"),
  effect_color: color.default("#ffffff"), effect_opacity: percent.default(35),
  effect_speed: z.number().int().min(1).max(5).default(2),
});
export const alertSchema = z.strictObject({
  id: z.string().uuid(), enabled: z.boolean(), type: z.enum(["info", "success", "warning", "danger"]),
  title: z.string().max(120), message: z.string().trim().min(1).max(1200),
  timeout_seconds: z.number().int().min(0).max(3600), dismissible: z.boolean(),
});
export const appearanceSchema = z.object({
  schema_version: z.literal(1), revision: z.number().int().nonnegative(),
  renewal_enabled: z.boolean().default(true),
  renewal_subtitle: z.string().trim().max(120).default("Без смены ключа"),
  theme: themeSchema, alerts: z.array(alertSchema).max(6).refine(a => new Set(a.map(x => x.id)).size === a.length),
});
export type Theme = z.infer<typeof themeSchema>;
export type Announcement = z.infer<typeof alertSchema>;
export type Appearance = z.infer<typeof appearanceSchema>;
export const defaultTheme: Theme = {
  accent: "#22d3ee", accent_secondary: "#9775fa", background: "#161b23",
  surface: "#202733", text: "#f4f7fb", muted: "#a6b0c0", border: "#354152",
  gradient_from: "#9775fa", gradient_to: "#22d3ee", gradient_type: "radial",
  gradient_angle: 135, gradient_opacity: 12, pattern: "grid",
  pattern_color: "#8190a5", pattern_opacity: 8, pattern_size: 60,
  card_radius: 16, card_opacity: 75, effect: "none", effect_color: "#ffffff", effect_opacity: 35, effect_speed: 2,
};
export const defaultAppearance: Appearance = { schema_version: 1, revision: 0, renewal_enabled: true, renewal_subtitle: "Без смены ключа", theme: defaultTheme, alerts: [] };
export const rgb = (hex: string) => [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16)).join(", ");
export const rgba = (hex: string, opacity: number) => `rgba(${rgb(hex)}, ${opacity / 100})`;
export function themeVariables(theme: Theme): Record<string, string> {
  const t = themeSchema.parse(theme);
  const ink = rgba(t.pattern_color, t.pattern_opacity);
  // Only fixed geometry and validated HEX/numbers; never accept user SVG or CSS.
  const tile = (geometry: string) => `url("data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="60" height="60" viewBox="0 0 60 60"><g fill="none" stroke="${t.pattern_color}" stroke-opacity="${t.pattern_opacity / 100}" stroke-width="1">${geometry}</g></svg>`)}")`;
  const patterns = {
    none: "none",
    dots: `radial-gradient(circle, ${ink} 1.2px, transparent 1.2px)`,
    lines: `linear-gradient(0deg, ${ink} 1px, transparent 1px)`,
    diagonal: `repeating-linear-gradient(135deg, ${ink} 0 1px, transparent 1px ${t.pattern_size}px)`,
    grid: `linear-gradient(90deg, ${ink} 1px, transparent 1px), linear-gradient(0deg, ${ink} 1px, transparent 1px)`,
    checker: `conic-gradient(${ink} 25%, transparent 0 50%, ${ink} 0 75%, transparent 0)`,
    diamonds: tile('<path d="M30 0 60 30 30 60 0 30Z"/>'),
    triangles: tile('<path d="M0 0 30 60 60 0ZM0 60 30 0 60 60Z"/>'),
    hexagons: tile('<path d="M15 0 45 0 60 30 45 60 15 60 0 30ZM0 30H-15M60 30H75"/>'),
    crosshatch: `repeating-linear-gradient(45deg, ${ink} 0 1px, transparent 1px 12px), repeating-linear-gradient(-45deg, ${ink} 0 1px, transparent 1px 12px)`,
    crosses: tile('<path d="M24 30H36M30 24V36"/>'),
    zigzag: tile('<path d="M-15 15 0 30 15 15 30 30 45 15 60 30 75 15M-15 45 0 60 15 45 30 60 45 45 60 60 75 45"/>'),
    waves: tile('<path d="M-15 15Q0 0 15 15T45 15T75 15M-15 45Q0 30 15 45T45 45T75 45"/>'),
    scales: tile('<path d="M0 0A30 30 0 0 0 60 0M-30 30A30 30 0 0 0 30 30M30 30A30 30 0 0 0 90 30"/>'),
    rings: tile('<circle cx="30" cy="30" r="24"/><circle cx="30" cy="30" r="17"/><circle cx="30" cy="30" r="10"/>'),
    circles: tile('<circle cx="15" cy="15" r="10"/><circle cx="45" cy="45" r="5"/>'),
    bricks: tile('<path d="M0 0H60M0 30H60M30 0V30M0 30V60M60 30V60"/>'),
    weave: tile('<path d="M0 5H30V25H0M60 35H30V55H60M5 60V30H25V60M35 0V30H55V0"/>'),
    herringbone: tile('<path d="M0 0 30 30 60 0M0 15 30 45 60 15M0 30 30 60 60 30M0 45 30 75 60 45"/>'),
    isometric: tile('<path d="M30 0 60 15V45L30 60 0 45V15ZM0 15 30 30 60 15M30 30V60"/>'),
    stars: tile('<path d="m30 14 4 12 13 4-13 4-4 12-4-12-13-4 13-4ZM5 4V10M2 7H8"/>'),
    confetti: tile('<path d="m8 10 8 5m30 20 5 9M12 48l7-4"/><circle cx="42" cy="12" r="3"/><path d="m28 32 4-6 4 6Z"/>'),
    circuit: tile('<path d="M0 10H20L30 20V60M60 40H45L35 30V0"/><circle cx="20" cy="10" r="3"/><circle cx="45" cy="40" r="3"/>'),
    topography: tile('<path d="M-10 15Q20-10 40 15T80 15M-10 25Q20 0 40 25T80 25M-10 40Q20 15 40 40T80 40M-10 50Q20 25 40 50T80 50"/>'),
    rain: tile('<path d="m10 4-5 15m30 5-5 15m25 5-5 15"/>'),
  };
  const a = rgba(t.gradient_from, t.gradient_opacity), b = rgba(t.gradient_to, t.gradient_opacity);
  const gradients = {
    none: "none", linear: `linear-gradient(${t.gradient_angle}deg, ${a}, ${b})`,
    radial: `radial-gradient(ellipse at 15% 15%, ${a}, transparent 65%), radial-gradient(ellipse at 90% 85%, ${b}, transparent 65%)`,
    conic: `conic-gradient(from ${t.gradient_angle}deg at 50% 40%, ${a}, transparent, ${b}, ${a})`,
    mesh: `radial-gradient(at 20% 20%, ${a}, transparent 50%), radial-gradient(at 80% 30%, ${b}, transparent 50%), radial-gradient(at 50% 90%, ${a}, transparent 60%)`,
    aurora: `linear-gradient(120deg, transparent 15%, ${a} 35%, transparent 50%, ${b} 65%, transparent 85%)`,
    spotlight: `radial-gradient(ellipse at 50% 0%, ${a}, ${b} 30%, transparent 70%)`,
    horizon: `linear-gradient(0deg, transparent 20%, ${a} 48%, ${b} 52%, transparent 85%)`,
    diagonal_glow: `linear-gradient(${t.gradient_angle}deg, transparent 25%, ${a} 45%, ${b} 55%, transparent 75%)`,
    duotone: `radial-gradient(ellipse at 0% 50%, ${a}, transparent 60%), radial-gradient(ellipse at 100% 50%, ${b}, transparent 60%)`,
  };
  return {
    "--sp-accent": t.accent, "--sp-accent-rgb": rgb(t.accent),
    "--sp-secondary": t.accent_secondary, "--sp-secondary-rgb": rgb(t.accent_secondary),
    "--sp-background": t.background, "--sp-surface": t.surface,
    "--sp-card": rgba(t.surface, t.card_opacity), "--sp-text": t.text,
    "--sp-muted": t.muted, "--sp-border": t.border,
    "--sp-radius": `${t.card_radius}px`, "--sp-pattern": patterns[t.pattern],
    "--sp-pattern-size": t.pattern === "diagonal" ? "auto" : `${t.pattern_size}px ${t.pattern_size}px`,
    "--sp-gradient": gradients[t.gradient_type], "--sp-effect-color": t.effect_color,
    "--sp-effect-opacity": String(t.effect_opacity / 100), "--sp-effect-duration": `${30 / t.effect_speed}s`,
  };
}
