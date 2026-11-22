import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const getAssistantSpeechToken = vi.fn();
vi.mock("../api/assistant", () => ({ getAssistantSpeechToken: () => getAssistantSpeechToken() }));

import { getSpeechToken, resetSpeechTokenCache, TOKEN_REUSE_MARGIN_MS } from "./speechToken";

const answer = (token: string, expiresInSeconds = 540) =>
  Promise.resolve({ token, region: "centralus", expiresInSeconds });

describe("speech token in memory", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    getAssistantSpeechToken.mockReset();
    resetSpeechTokenCache();
  });
  afterEach(() => vi.useRealTimers());

  it("asks the backend once and reuses the token while there is room to listen", async () => {
    getAssistantSpeechToken.mockImplementation(() => answer("t1"));

    expect(await getSpeechToken()).toEqual({ token: "t1", region: "centralus" });
    vi.advanceTimersByTime(5 * 60_000);
    expect((await getSpeechToken()).token).toBe("t1");

    expect(getAssistantSpeechToken).toHaveBeenCalledTimes(1);
  });

  it("asks again once less than the safety margin is left", async () => {
    getAssistantSpeechToken.mockImplementationOnce(() => answer("t1")).mockImplementationOnce(() => answer("t2"));

    await getSpeechToken();
    vi.advanceTimersByTime(540_000 - TOKEN_REUSE_MARGIN_MS + 1);

    expect((await getSpeechToken()).token).toBe("t2");
    expect(getAssistantSpeechToken).toHaveBeenCalledTimes(2);
  });

  it("respects the time the backend says is left (a token it already kept for a while)", async () => {
    getAssistantSpeechToken
      .mockImplementationOnce(() => answer("t1", 200)) // 200 s left: under the margin of 150 s soon
      .mockImplementationOnce(() => answer("t2"));

    await getSpeechToken();
    vi.advanceTimersByTime(60_000);

    expect((await getSpeechToken()).token).toBe("t2");
  });

  it("shares one request between simultaneous callers (prewarm + tap)", async () => {
    getAssistantSpeechToken.mockImplementation(() => answer("t1"));

    const [a, b] = await Promise.all([getSpeechToken(), getSpeechToken()]);

    expect(a).toEqual(b);
    expect(getAssistantSpeechToken).toHaveBeenCalledTimes(1);
  });

  it("does not remember a failure: the next attempt asks again", async () => {
    getAssistantSpeechToken.mockRejectedValueOnce(new Error("503")).mockImplementationOnce(() => answer("t1"));

    await expect(getSpeechToken()).rejects.toThrow("503");
    expect((await getSpeechToken()).token).toBe("t1");
  });
});
