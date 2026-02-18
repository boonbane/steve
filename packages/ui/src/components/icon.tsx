type IconProps = {
  size?: number;
  label?: string;
};

export const Icon = (props: IconProps) => {
  return (
    <svg
      viewBox="0 0 200 200"
      width={props.size  ?? 48}
      height={props.size ?? 48}
      role="img"
      aria-label={props.label ?? "App icon"}
    >
      <path
        d="M 148,52 C 148,10 52,10 52,52 C 52,72 70,85 100,85 C 130,85 148,98 148,118 C 148,165 52,165 52,125"
        fill="none"
        stroke="var(--icon-stroke)"
        stroke-width="32"
        stroke-linecap="round"
      />
      <path
        d="M 148,118 C 148,165 52,165 52,125"
        fill="none"
        stroke="var(--icon-highlight)"
        stroke-width="20"
        stroke-linecap="round"
      />
      <circle
        cx="70"
        cy="90"
        r="20"
        fill="var(--icon-eye-fill)"
        stroke="var(--icon-eye-stroke)"
        stroke-width="8"
      />
      <circle
        cx="130"
        cy="90"
        r="20"
        fill="var(--icon-eye-fill)"
        stroke="var(--icon-eye-stroke)"
        stroke-width="8"
      />
    </svg>
  );
};
