import { brandPalettes, type PublicBranding } from "@sycamore/shared";
import {
  createDarkTheme,
  createLightTheme,
  type BrandVariants,
} from "@fluentui/react-components";
// A restrained green ramp anchored at the church's #2F6B4F brand color.
const brand: BrandVariants = {
  10: "#020403",
  20: "#0E1D15",
  30: "#173224",
  40: "#1F4431",
  50: "#27583F",
  60: "#2F6B4F",
  70: "#39805F",
  80: "#438F6C",
  90: "#529F7D",
  100: "#6FB592",
  110: "#85C3A3",
  120: "#9BD0B4",
  130: "#B1DDC6",
  140: "#C8E8D8",
  150: "#DFF3EA",
  160: "#F2FAF6",
};
// Cambria ships with Windows, so the display serif works offline in the booth.
export const displayFont = 'Cambria, Georgia, "Times New Roman", serif';
// A warm, quiet ground with white panels. See DESIGN.md section 2.1.
export const lightTheme = {
  ...createLightTheme(brand),
  colorBrandBackground: "#2F6B4F",
  colorBrandForeground1: "#2F6B4F",
  colorNeutralBackground1: "#FFFFFF",
  colorNeutralBackground2: "#F6F4EE",
  colorNeutralBackground3: "#EFECE4",
  colorNeutralForeground1: "#1F2321",
  colorNeutralForeground2: "#5B625E",
  colorNeutralStroke1: "#E2DED5",
  colorNeutralStroke2: "#EEEBE4",
  fontFamilyBase: '"Segoe UI Variable", "Segoe UI", sans-serif',
};
export const darkTheme = {
  ...createDarkTheme(brand),
  colorBrandBackground: "#2F6B4F",
  colorBrandForeground1: "#6FB592",
  colorNeutralBackground1: "#222624",
  colorNeutralBackground2: "#181B1A",
  colorNeutralBackground3: "#2A2F2C",
  colorNeutralForeground1: "#ECEEEC",
  colorNeutralForeground2: "#A9B0AC",
  colorNeutralStroke1: "#383E3B",
  colorNeutralStroke2: "#2E3331",
  fontFamilyBase: lightTheme.fontFamilyBase,
};


export function churchTheme(palette: PublicBranding["palette"] = "forest", dark = false) {
  const colors = brandPalettes[palette];
  const accent = dark ? colors.dark : colors.light;
  return {
    ...(dark ? darkTheme : lightTheme),
    colorBrandBackground: colors.light,
    colorBrandBackgroundHover: colors.light,
    colorBrandBackgroundPressed: colors.light,
    colorBrandForeground1: accent,
    colorBrandForeground2: accent,
    colorBrandForegroundLink: accent,
    colorBrandForegroundLinkHover: accent,
    colorBrandStroke1: accent,
    colorCompoundBrandBackground: accent,
    colorCompoundBrandBackgroundHover: accent,
    colorCompoundBrandBackgroundPressed: accent,
    colorCompoundBrandStroke: accent,
    colorCompoundBrandStrokeHover: accent,
    colorCompoundBrandStrokePressed: accent,
  };
}
