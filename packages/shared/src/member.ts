export const memberTabs = [
  "directory",
  "events",
  "privacy",
  "account",
] as const;
export type MemberTab = (typeof memberTabs)[number];
// Sign-in links can be forwarded or edited, so the return target is rebuilt
// from an allowlist and never followed as a URL.
export function safeReturnPath(value: string | null | undefined): string {
  const tab = memberReturnTab(value);
  return tab ? `/?tab=${tab}` : "/";
}
export function memberReturnTab(
  value: string | null | undefined,
): MemberTab | null {
  if (!value || !/^\/(\?tab=[a-z]+)?$/.test(value)) return null;
  const tab = value.slice(6);
  return (memberTabs as readonly string[]).includes(tab)
    ? (tab as MemberTab)
    : null;
}
