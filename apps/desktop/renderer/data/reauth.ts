import { RECENT_SIGN_IN_REASON } from "@sycamore/shared";

type Request = { resolve: () => void; reject: (cause: Error) => void };
type Open = (request: Request) => void;
// Confirm dialogs register here. The newest wins, so a dialog that opens over a form
// (such as the record editor) nests inside it, as Fluent's modal handling requires.
const hosts: Open[] = [];

export function hostReauth(open: Open) {
  hosts.push(open);
  return () => {
    const index = hosts.lastIndexOf(open);
    if (index >= 0) hosts.splice(index, 1);
  };
}

export function needsRecentSignIn(error: unknown) {
  const value = error as { code?: string; details?: { reason?: string } };
  return (
    value?.code === "functions/unauthenticated" &&
    value.details?.reason === RECENT_SIGN_IN_REASON
  );
}

// Runs an action and, if the server asks for a recent sign-in, asks the person to
// confirm it is them and runs it once more. Cancelling rejects with a plain message.
export async function withRecentSignIn<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (error) {
    const open = hosts[hosts.length - 1];
    if (!needsRecentSignIn(error) || !open) throw error;
    await new Promise<void>((resolve, reject) => open({ resolve, reject }));
    return run();
  }
}
