import { defaultTheme as theme } from "./theme";

export function formatPath(value: string): string {
  const bodyLength = value.trimEnd().length;
  const body = value.slice(0, bodyLength);
  const padding = value.slice(bodyLength);
  const slash = body.lastIndexOf("/");

  if (slash === -1) {
    return theme.primary(body) + padding;
  }

  return (
    theme.dim(body.slice(0, slash + 1)) +
    theme.primary(body.slice(slash + 1)) +
    padding
  );
}
