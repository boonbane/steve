type Formatter = (value: string) => string;

export type Theme = {
  primary: Formatter;
  white: Formatter;
  service: Formatter;
  code: Formatter;
  header: Formatter;
  command: Formatter;
  arg: Formatter;
  option: Formatter;
  type: Formatter;
  description: Formatter;
  dim: Formatter;
};

function rgb(r: number, g: number, b: number): Formatter {
  return (value: string) => `\x1b[38;2;${r};${g};${b}m${value}\x1b[39m`;
}

const gray = (value: number) => rgb(value, value, value);
const imessageBlue = rgb(0, 122, 255);
const brightGreen = rgb(0, 255, 0);
const white = rgb(255, 255, 255);

export const defaultTheme: Theme = {
  primary: rgb(114, 161, 136),
  white,
  service: (value) => {
    const key = value.trim().toLowerCase();

    if (key === "imessage") {
      return imessageBlue(value);
    }

    if (key === "sms" || key === "rcs") {
      return brightGreen(value);
    }

    return white(value);
  },
  code: rgb(212, 212, 161),
  header: gray(128),
  command: rgb(114, 161, 136),
  arg: rgb(161, 212, 212),
  option: rgb(212, 212, 161),
  type: gray(128),
  description: (value) => value,
  dim: gray(128),
};
