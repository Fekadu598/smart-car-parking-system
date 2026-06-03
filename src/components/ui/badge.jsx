import React from "react";
import { cva } from "class-variance-authority";
import { cn } from "../../lib/utils";

const badgeVariants = cva("inline-flex items-center rounded-full px-2.5 py-1 text-xs font-semibold transition-all", {
  variants: {
    variant: {
      default: "bg-primary/10 text-primary",
      secondary: "bg-secondary text-secondary-foreground",
      success: "bg-emerald-100 text-emerald-700",
      warning: "bg-amber-100 text-amber-700",
      destructive: "bg-destructive/20 text-destructive",
      premium: "bg-gradient-to-r from-blue-600 to-indigo-600 text-white shadow-sm",
      outline: "border border-border bg-transparent text-foreground",
    },
  },
  defaultVariants: {
    variant: "default",
  },
});

export function Badge({ className, variant, dot, pulse, ...props }) {
  return (
    <span className={cn(badgeVariants({ variant }), className)} {...props}>
      {dot && (
        <span className={`mr-1.5 inline-block h-1.5 w-1.5 rounded-full ${pulse ? "animate-pulse-soft" : ""}`}
          style={{ backgroundColor: variant === "success" ? "#10b981" : variant === "warning" ? "#f59e0b" : variant === "destructive" ? "#ef4444" : "currentColor" }}
        />
      )}
      {props.children}
    </span>
  );
}
