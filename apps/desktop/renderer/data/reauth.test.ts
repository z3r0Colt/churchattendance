import { afterEach, describe, expect, it } from "vitest";
import { RECENT_SIGN_IN_REASON } from "@sycamore/shared";
import { hostReauth, withRecentSignIn } from "./reauth";

type Request = { resolve: () => void; reject: (cause: Error) => void };

const recent = {
  code: "functions/unauthenticated",
  details: { reason: RECENT_SIGN_IN_REASON },
};
const cancelled = "Confirmation cancelled. Nothing was changed.";

// A confirm dialog that only records what it was asked to confirm.
let release = () => {};
function fakeHost() {
  const requests: Request[] = [];
  release = hostReauth((request) => {
    requests.push(request);
  });
  return requests;
}

// A sensitive call the server refuses once for an old sign-in, then accepts.
function sensitive<T>(value: T) {
  let tries = 0;
  return {
    tries: () => tries,
    run: async () => {
      tries += 1;
      if (tries === 1) throw recent;
      return value;
    },
  };
}

// Lets the refused first tries reach the confirm dialog.
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("withRecentSignIn", () => {
  afterEach(() => release());

  it("asks once for overlapping calls and runs each again after Confirm", async () => {
    const requests = fakeHost();
    const first = sensitive("first"),
      second = sensitive("second");
    const results = Promise.all([
      withRecentSignIn(first.run),
      withRecentSignIn(second.run),
    ]);
    await settle();
    expect(requests).toHaveLength(1);
    requests[0].resolve();
    await expect(results).resolves.toEqual(["first", "second"]);
    expect([first.tries(), second.tries()]).toEqual([2, 2]);
  });

  it("stops every waiting call with the same message after Cancel", async () => {
    const requests = fakeHost();
    const first = sensitive("first"),
      second = sensitive("second");
    const results = [
      withRecentSignIn(first.run),
      withRecentSignIn(second.run),
    ].map((call) =>
      call.then(
        () => "",
        (cause: Error) => cause.message,
      ),
    );
    await settle();
    expect(requests).toHaveLength(1);
    requests[0].reject(new Error(cancelled));
    await expect(Promise.all(results)).resolves.toEqual([cancelled, cancelled]);
    expect([first.tries(), second.tries()]).toEqual([1, 1]);
  });

  it("asks afresh once an earlier confirmation is settled", async () => {
    const requests = fakeHost();
    const first = withRecentSignIn(sensitive("first").run);
    await settle();
    requests[0].resolve();
    await expect(first).resolves.toBe("first");
    const second = withRecentSignIn(sensitive("second").run);
    await settle();
    expect(requests).toHaveLength(2);
    requests[1].resolve();
    await expect(second).resolves.toBe("second");
  });

  it("passes any other error straight through without asking", async () => {
    const requests = fakeHost();
    const denied = { code: "functions/permission-denied" };
    await expect(
      withRecentSignIn(async () => {
        throw denied;
      }),
    ).rejects.toBe(denied);
    expect(requests).toHaveLength(0);
  });

  it("passes the refusal through when no confirm dialog is open", async () => {
    await expect(
      withRecentSignIn(async () => {
        throw recent;
      }),
    ).rejects.toBe(recent);
  });
});
