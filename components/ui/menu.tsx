"use client";

import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import * as RadixPopover from "@radix-ui/react-popover";
import { Check } from "lucide-react";
import type { ReactNode } from "react";

/**
 * Thin wrappers around Radix so every menu in the app looks and behaves the
 * same: keyboard navigation, type-ahead, focus return and collision handling
 * come from Radix; the look comes from .rb-menu in globals.css.
 */

export function Menu({
  trigger,
  children,
  align = "start",
  side = "bottom",
  width,
}: {
  trigger: ReactNode;
  children: ReactNode;
  align?: "start" | "center" | "end";
  side?: "top" | "bottom" | "left" | "right";
  width?: number;
}) {
  return (
    <DropdownMenu.Root modal={false}>
      <DropdownMenu.Trigger asChild>{trigger}</DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align={align}
          side={side}
          sideOffset={4}
          collisionPadding={8}
          className="rb-menu max-h-[min(420px,var(--radix-dropdown-menu-content-available-height))] overflow-y-auto"
          style={width ? { width } : undefined}
        >
          {children}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}

export function MenuItem({
  children,
  onSelect,
  icon,
  shortcut,
  checked,
  danger,
  disabled,
}: {
  children: ReactNode;
  onSelect?: () => void;
  icon?: ReactNode;
  shortcut?: string;
  checked?: boolean;
  danger?: boolean;
  disabled?: boolean;
}) {
  return (
    <DropdownMenu.Item
      className={`rb-menu-item ${danger ? "text-danger data-[highlighted]:bg-danger-bg" : ""}`}
      onSelect={onSelect}
      disabled={disabled}
    >
      {icon && <span className="grid w-4 shrink-0 place-items-center text-muted">{icon}</span>}
      <span className="min-w-0 flex-1 truncate">{children}</span>
      {checked && <Check className="size-3.5 text-ink" />}
      {shortcut && <span className="ml-3 text-2xs text-faint">{shortcut}</span>}
    </DropdownMenu.Item>
  );
}

export function MenuLabel({ children }: { children: ReactNode }) {
  return <DropdownMenu.Label className="rb-menu-label">{children}</DropdownMenu.Label>;
}

export function MenuSeparator() {
  return <DropdownMenu.Separator className="rb-menu-sep" />;
}

export function Popover({
  trigger,
  children,
  align = "start",
  side = "bottom",
  open,
  onOpenChange,
  className = "",
}: {
  trigger: ReactNode;
  children: ReactNode;
  align?: "start" | "center" | "end";
  side?: "top" | "bottom" | "left" | "right";
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  className?: string;
}) {
  return (
    <RadixPopover.Root open={open} onOpenChange={onOpenChange}>
      <RadixPopover.Trigger asChild>{trigger}</RadixPopover.Trigger>
      <RadixPopover.Portal>
        <RadixPopover.Content
          align={align}
          side={side}
          sideOffset={4}
          collisionPadding={8}
          className={`rb-menu p-2 ${className}`}
        >
          {children}
        </RadixPopover.Content>
      </RadixPopover.Portal>
    </RadixPopover.Root>
  );
}

export const PopoverClose = RadixPopover.Close;
