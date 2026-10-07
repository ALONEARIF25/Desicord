import type { ButtonHTMLAttributes } from "react";

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  tone?: "dark" | "lime" | "quiet" | "danger" | "channel";
};

const tones = {
  dark: "bg-[var(--color-accent)] text-[var(--color-text)] hover:bg-[var(--color-hover)]",
  lime: "bg-[var(--color-accent)] text-[var(--color-text)] hover:bg-[var(--color-hover)]",
  quiet:
    "border border-[var(--color-hover)] bg-transparent text-[var(--color-muted)] hover:border-[var(--color-muted)] hover:text-[var(--color-text)]",
  danger:
    "border border-[var(--color-accent)]/40 bg-transparent text-[var(--color-accent)] hover:bg-[var(--color-accent)]/10",
  channel:
    "bg-transparent text-[var(--color-muted)] hover:text-[var(--color-text)]",
};

export function Button({
  tone = "dark",
  className = "",
  ...props
}: ButtonProps) {
  return (
    <button
      className={`rounded-[6px] px-4 py-1 text-sm font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-45 ${tones[tone]} ${className}`}
      {...props}
    />
  );
}
