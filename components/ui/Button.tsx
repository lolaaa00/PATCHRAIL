import clsx from "clsx";
import { type ButtonHTMLAttributes, forwardRef } from "react";

type Variant = "primary" | "secondary" | "ghost" | "danger";

export const Button = forwardRef<
  HTMLButtonElement,
  ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant }
>(function Button({ variant = "primary", className, ...props }, ref) {
  return (
    <button
      ref={ref}
      {...props}
      className={clsx(
        "font-mono text-xs uppercase tracking-wide px-4 py-2.5 transition-colors disabled:cursor-not-allowed disabled:opacity-40",
        variant === "primary" && "bg-green text-midnight hover:bg-phosphor",
        variant === "secondary" && "border border-phosphor/30 text-phosphor hover:border-phosphor hover:bg-phosphor/10",
        variant === "ghost" && "text-titanium hover:text-phosphor",
        variant === "danger" && "border border-coral text-coral hover:bg-coral hover:text-midnight",
        className,
      )}
    />
  );
});
