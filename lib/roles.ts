/**
 * Who may do what in a project, taken from GitHub — nothing to set up in
 * RepoBoard. Add a person to the repository on GitHub (Settings →
 * Collaborators, or a team in an organisation) and pick their role there:
 *
 *   Admin, Maintain → manager: every board, boards for other people, settings
 *   Write           → member:  works on cards; makes and changes their own boards
 *   Triage, Read    → viewer:  sees the project, changes nothing
 *
 * GitHub enforces the same limits on anything written to the repository;
 * RepoBoard keeps its own screens and database in line with them.
 */
export type Role = "manager" | "member" | "viewer";

export const ROLE_LABEL: Record<Role, string> = {
  manager: "Admin",
  member: "Member",
  viewer: "View only",
};

export function roleOf(p?: { admin?: boolean; maintain?: boolean; push?: boolean; triage?: boolean; pull?: boolean } | null): Role {
  // No permissions in the answer: a token GitHub did not describe — treat as the repository's own.
  if (!p) return "manager";
  if (p.admin || p.maintain) return "manager";
  if (p.push) return "member";
  return "viewer";
}

const same = (a?: string | null, b?: string | null) => Boolean(a && b && a.toLowerCase() === b.toLowerCase());

export interface Who {
  login: string | null;
  role: Role;
}

export const canWrite = (who: Who) => who.role !== "viewer";

/** A board's own settings (name, picture, owner, who sees it), archiving. */
export function canManageBoard(who: Who, board: { owner: string | null; primary?: boolean }): boolean {
  if (who.role === "manager") return true;
  if (who.role === "viewer" || board.primary) return false;
  return same(board.owner, who.login);
}

/** A new board for `owner` (null: an area board like "Design"). */
export function canCreateBoard(who: Who, owner: string | null): boolean {
  if (who.role === "manager") return true;
  return who.role === "member" && same(owner, who.login);
}

/** "Only the owner and admins" boards are hidden from everyone else. */
export function canSeeBoard(who: Who | null, board: { owner: string | null; visibility?: string | null }): boolean {
  if (board.visibility !== "owner") return true;
  if (!who) return false;
  return who.role === "manager" || same(board.owner, who.login);
}
