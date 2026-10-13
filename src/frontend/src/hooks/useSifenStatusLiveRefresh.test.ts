import { renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  SIFEN_LIVE_REFRESH_MS,
  isSifenStatusInFlight,
  useSifenStatusLiveRefresh,
} from "./useSifenStatusLiveRefresh";

describe("isSifenStatusInFlight", () => {
  it("is true only for the statuses the backend can still change on its own", () => {
    expect(isSifenStatusInFlight("QUEUED")).toBe(true);
    expect(isSifenStatusInFlight("PENDING_VERIFICATION")).toBe(true);
    expect(isSifenStatusInFlight("APPROVED")).toBe(false);
    expect(isSifenStatusInFlight("APPROVED_WITH_OBSERVATION")).toBe(false);
    expect(isSifenStatusInFlight("REJECTED")).toBe(false);
    expect(isSifenStatusInFlight("CANCELLED")).toBe(false);
    expect(isSifenStatusInFlight(null)).toBe(false);
    expect(isSifenStatusInFlight(undefined)).toBe(false);
  });
});

describe("useSifenStatusLiveRefresh", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("refreshes every interval while active, and stops once nothing is in flight", () => {
    const refresh = vi.fn();
    const { rerender, unmount } = renderHook(
      ({ active }) => useSifenStatusLiveRefresh(active, refresh),
      { initialProps: { active: true } },
    );

    vi.advanceTimersByTime(SIFEN_LIVE_REFRESH_MS);
    expect(refresh).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(SIFEN_LIVE_REFRESH_MS * 2);
    expect(refresh).toHaveBeenCalledTimes(3);

    rerender({ active: false });
    vi.advanceTimersByTime(SIFEN_LIVE_REFRESH_MS * 5);
    expect(refresh).toHaveBeenCalledTimes(3);
    unmount();
  });

  it("never refreshes while inactive", () => {
    const refresh = vi.fn();
    renderHook(() => useSifenStatusLiveRefresh(false, refresh));
    vi.advanceTimersByTime(SIFEN_LIVE_REFRESH_MS * 5);
    expect(refresh).not.toHaveBeenCalled();
  });

  it("skips ticks while the browser tab is hidden", () => {
    const refresh = vi.fn();
    const visibility = vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
    renderHook(() => useSifenStatusLiveRefresh(true, refresh));
    vi.advanceTimersByTime(SIFEN_LIVE_REFRESH_MS * 3);
    expect(refresh).not.toHaveBeenCalled();

    visibility.mockReturnValue("visible");
    document.dispatchEvent(new Event("visibilitychange"));
    expect(refresh).toHaveBeenCalledTimes(1);
    visibility.mockRestore();
  });

  it("always calls the latest refresh callback", () => {
    const first = vi.fn();
    const second = vi.fn();
    const { rerender } = renderHook(({ cb }) => useSifenStatusLiveRefresh(true, cb), {
      initialProps: { cb: first },
    });
    rerender({ cb: second });
    vi.advanceTimersByTime(SIFEN_LIVE_REFRESH_MS);
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
  });
});
