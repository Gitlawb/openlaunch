import type { PostRow } from "./postsServer";

/**
 * Token-page comment threading + composer helpers (pure; unit-tested).
 *
 * TokenComments rendered every reply list with `posts.filter(p => p.parent_id
 * === id)` per top-level post: O(n²) per render on a viral token. These
 * helpers build the reply map once (O(n)) and own client pagination + draft
 * persistence so the component stays thin.
 */

/** How many top-level comments render before "Show more". */
export const COMMENTS_PAGE = 20;

export function groupReplies(posts: PostRow[]): { top: PostRow[]; repliesById: Map<number, PostRow[]> } {
  const top: PostRow[] = [];
  const repliesById = new Map<number, PostRow[]>();
  for (const p of posts) {
    if (p.parent_id === null) top.push(p);
    else {
      const list = repliesById.get(p.parent_id);
      if (list) list.push(p);
      else repliesById.set(p.parent_id, [p]);
    }
  }
  // Newest reply last under each comment (server sends newest first).
  for (const list of repliesById.values()) list.reverse();
  return { top, repliesById };
}

export function visibleTopIds(top: PostRow[], shownCount: number): PostRow[] {
  return top.slice(0, Math.max(0, shownCount));
}

export function draftKey(chain: string, token: string): string {
  return `ol:comment-draft:${chain}:${token.toLowerCase()}`;
}

/** Composer draft: body plus the reply destination (null = top-level post). */
export type CommentDraft = { body: string; parentId: number | null };

function cleanParentId(v: unknown): number | null {
  return typeof v === "number" && Number.isInteger(v) && v > 0 ? v : null;
}

/** Load the full draft (body + reply target). Understands the new JSON shape and legacy plain-text drafts. */
export function loadCommentDraft(chain: string, token: string): CommentDraft {
  try {
    if (typeof localStorage === "undefined") return { body: "", parentId: null };
    const raw = localStorage.getItem(draftKey(chain, token));
    if (!raw) return { body: "", parentId: null };
    try {
      const parsed = JSON.parse(raw) as { body?: unknown; parentId?: unknown };
      if (parsed && typeof parsed === "object" && typeof parsed.body === "string") {
        return { body: parsed.body, parentId: cleanParentId(parsed.parentId) };
      }
    } catch {
      /* legacy plain-text draft falls through */
    }
    return { body: raw, parentId: null };
  } catch {
    return { body: "", parentId: null };
  }
}

export function loadDraft(chain: string, token: string): string {
  return loadCommentDraft(chain, token).body;
}

export function saveDraft(chain: string, token: string, body: string, parentId: number | null = null): void {
  try {
    if (typeof localStorage === "undefined") return;
    const pid = cleanParentId(parentId);
    if (!body && pid === null) localStorage.removeItem(draftKey(chain, token));
    else localStorage.setItem(draftKey(chain, token), JSON.stringify({ body: body.slice(0, 2000), parentId: pid }));
  } catch {
    /* storage blocked: the in-memory textarea state is what survives */
  }
}

export function clearDraft(chain: string, token: string): void {
  try {
    if (typeof localStorage === "undefined") return;
    localStorage.removeItem(draftKey(chain, token));
  } catch {
    /* ignore */
  }
}

/**
 * Resolve a restored reply target against the loaded posts (PR #31).
 *
 * Draft restoration and the initial posts fetch race: posts starts empty, so
 * an empty list must not read as "parent missing" before the fetch, nor as
 * "parent exists" for signing. While !postsLoaded a non-null replyTo is
 * pending (caller blocks submit instead of signing an unvalidated parent);
 * after loading, membership decides — even when the list is empty — and a
 * missing/hidden parent falls back to null (top-level).
 */
export function resolveReplyTarget(
  replyTo: number | null,
  posts: readonly { id: number }[],
  postsLoaded: boolean,
): { target: number | null; pending: boolean; missing: boolean } {
  if (replyTo === null) return { target: null, pending: false, missing: false };
  if (!postsLoaded) return { target: replyTo, pending: true, missing: false };
  if (posts.some((p) => p.id === replyTo)) return { target: replyTo, pending: false, missing: false };
  return { target: null, pending: false, missing: true };
}
