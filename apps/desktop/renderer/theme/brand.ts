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
export const lightTheme = {
  ...createLightTheme(brand),
  colorBrandBackground: "#2F6B4F",
  colorBrandForeground1: "#2F6B4F",
  colorNeutralBackground1: "#FFFFFF",
  colorNeutralBackground2: "#FAFAF8",
  colorNeutralForeground1: "#1F2321",
  colorNeutralForeground2: "#5B625E",
  colorNeutralStroke1: "#DADFDC",
  fontFamilyBase: '"Segoe UI Variable", "Segoe UI", sans-serif',
};
export const darkTheme = {
  ...createDarkTheme(brand),
  colorBrandBackground: "#2F6B4F",
  colorBrandForeground1: "#6FB592",
  colorNeutralBackground1: "#242726",
  colorNeutralBackground2: "#1B1D1C",
  colorNeutralForeground1: "#ECEEEC",
  colorNeutralForeground2: "#A9B0AC",
  colorNeutralStroke1: "#3A3F3D",
  fontFamilyBase: lightTheme.fontFamilyBase,
};
