import * as React from "react";

import { cn } from "@/lib/utils";
import { Input } from "./input";

/**
 * A password field with a Show/Hide toggle. Drop-in replacement for <Input
 * type="password" />; the toggle switches the input between password and text.
 */
const PasswordInput = React.forwardRef<
  HTMLInputElement,
  Omit<React.ComponentProps<"input">, "type">
>(({ className, ...props }, ref) => {
  const [show, setShow] = React.useState(false);
  return (
    <div className="relative">
      <Input
        ref={ref}
        type={show ? "text" : "password"}
        className={cn("pr-14", className)}
        {...props}
      />
      <button
        type="button"
        tabIndex={-1}
        onClick={() => setShow((s) => !s)}
        aria-label={show ? "Hide password" : "Show password"}
        className="absolute inset-y-0 right-0 flex items-center px-3 text-xs font-medium text-muted-foreground hover:text-foreground"
      >
        {show ? "Hide" : "Show"}
      </button>
    </div>
  );
});
PasswordInput.displayName = "PasswordInput";

export { PasswordInput };
