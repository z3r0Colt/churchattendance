import type { ReactElement, ReactNode } from "react";
import { Button } from "@fluentui/react-components";
import { LockClosedRegular } from "@fluentui/react-icons";

// A labelled group of sidebar links, such as Worship or Records.
export function NavGroup({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <div role="group" aria-label={label} className="nav-group">
      <span className="nav-label" aria-hidden="true">
        {label}
      </span>
      {children}
    </div>
  );
}

// Session-only destinations show a lock and say "Session only" to screen readers.
export function NavItem({
  label,
  current,
  onClick,
  session = false,
  icon,
}: {
  label: string;
  current: boolean;
  onClick: () => void;
  session?: boolean;
  icon?: ReactElement;
}) {
  return (
    <Button
      appearance="subtle"
      className="nav-item"
      icon={icon}
      aria-current={current ? "page" : undefined}
      aria-label={session ? `${label} · Session only` : undefined}
      onClick={onClick}
    >
      <span className="nav-text">{label}</span>
      {session && <LockClosedRegular className="nav-lock" aria-hidden />}
    </Button>
  );
}
