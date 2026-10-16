import { z } from "zod";

const color = z.string().regex(/^#[0-9a-fA-F]{6}$/);
const percent = z.number().int().min(0).max(100);
export const themeSchema = z.strictObject({
  accent: color, accent_secondary: color, background: color, surface: color,
  text: color, muted: color, border: color, gradient_from: color, gradient_to: color,
  gradient_type: z.enum(["none", "linear", "radial"]),
  gradient_angle: z.number().int().min(0).max(360), gradient_opacity: percent,
  pattern: z.enum(["none", "grid", "dots", "lines", "diagonal"]),
  pattern_color: color, pattern_opacity: percent, pattern_size: z.number().int().min(12).max(120),
  card_radius: z.number().int().min(0).max(32), card_opacity: percent,
});
export const alertSchema = z.strictObject({
  id: z.string().uuid(), enabled: z.boolean(), type: z.enum(["info", "success", "warning", "danger"]),
  title: z.string().max(120), message: z.string().trim().min(1).max(1200),
  timeout_seconds: z.number().int().min(0).max(3600), dismissible: z.boolean(),
});
export const appearanceSchema = z.object({
  schema_version: z.literal(1), revision: z.number().int().nonnegative(),
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
  card_radius: 16, card_opacity: 75,
};
export const defaultAppearance: Appearance = { schema_version: 1, revision: 0, theme: defaultTheme, alerts: [] };
export const rgb = (hex: string) => [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16)).join(", ");
export const rgba = (hex: string, opacity: number) => `rgba(${rgb(hex)}, ${opacity / 100})`;
export function themeVariables(theme: Theme): Record<string, string> {
  const t = themeSchema.parse(theme);
  const ink = rgba(t.pattern_color, t.pattern_opacity);
  const patterns = {
    none: "none",
    dots: `radial-gradient(circle, ${ink} 1.2px, transparent 1.2px)`,
    lines: `linear-gradient(0deg, ${ink} 1px, transparent 1px)`,
    diagonal: `repeating-linear-gradient(135deg, ${ink} 0 1px, transparent 1px ${t.pattern_size}px)`,
    grid: `linear-gradient(90deg, ${ink} 1px, transparent 1px), linear-gradient(0deg, ${ink} 1px, transparent 1px)`,
  };
  const gradient = t.gradient_type === "none" ? "none" : t.gradient_type === "linear"
    ? `linear-gradient(${t.gradient_angle}deg, ${rgba(t.gradient_from, t.gradient_opacity)}, ${rgba(t.gradient_to, t.gradient_opacity)})`
    : `radial-gradient(ellipse at 15% 15%, ${rgba(t.gradient_from, t.gradient_opacity)}, transparent 65%), radial-gradient(ellipse at 90% 85%, ${rgba(t.gradient_to, t.gradient_opacity)}, transparent 65%)`;
  return {
    "--sp-accent": t.accent, "--sp-accent-rgb": rgb(t.accent),
    "--sp-secondary": t.accent_secondary, "--sp-secondary-rgb": rgb(t.accent_secondary),
    "--sp-background": t.background, "--sp-surface": t.surface,
    "--sp-card": rgba(t.surface, t.card_opacity), "--sp-text": t.text,
    "--sp-muted": t.muted, "--sp-border": t.border,
    "--sp-radius": `${t.card_radius}px`, "--sp-pattern": patterns[t.pattern],
    "--sp-pattern-size": t.pattern === "diagonal" ? "auto" : `${t.pattern_size}px ${t.pattern_size}px`,
    "--sp-gradient": gradient,
  };
}
