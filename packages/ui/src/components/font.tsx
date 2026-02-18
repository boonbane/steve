import hack from "../assets/fonts/hack.woff2";
import hackBold from "../assets/fonts/hack-bold.woff2";

type MonoFont = {
  family: string;
  regular: string;
  bold: string;
};

export const MONO_FONTS = [
  {
    family: "Hack",
    regular: hack,
    bold: hackBold,
  },
] satisfies MonoFont[];

const css = {
  mono: MONO_FONTS.map(
  (font) => `
    @font-face {
      font-family: "${font.family}";
      src: url("${font.regular}") format("woff2");
      font-display: swap;
      font-style: normal;
      font-weight: 400;
    }
    @font-face {
      font-family: "${font.family}";
      src: url("${font.bold}") format("woff2");
      font-display: swap;
      font-style: normal;
      font-weight: 700;
    }
  `).join(""),
}

export const Font = () => <style>{`${css.mono}`}</style>
