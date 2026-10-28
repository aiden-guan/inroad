"use client";
import { useEffect, useRef } from "react";

interface Player {
  destroy: () => void;
  playVideo: () => void;
}
interface YouTubeApi {
  Player: new (
    element: HTMLElement,
    options: {
      videoId: string;
      host: string;
      width: string;
      height: string;
      playerVars: Record<string, string | number>;
      events: {
        onReady: (event: { target: Player }) => void;
        onError: () => void;
      };
    },
  ) => Player;
}
declare global {
  interface Window {
    YT?: YouTubeApi;
    onYouTubeIframeAPIReady?: () => void;
  }
}
let loading: Promise<YouTubeApi> | null = null;

function loadPlayer(): Promise<YouTubeApi> {
  if (window.YT?.Player) return Promise.resolve(window.YT);
  if (loading) return loading;
  loading = new Promise<YouTubeApi>((resolve, reject) => {
    const previous = window.onYouTubeIframeAPIReady;
    const script = document.createElement("script");
    const timeout = window.setTimeout(
      () => reject(new Error("Player unavailable")),
      8000,
    );
    window.onYouTubeIframeAPIReady = () => {
      previous?.();
      window.clearTimeout(timeout);
      if (window.YT?.Player) resolve(window.YT);
      else reject(new Error("Player unavailable"));
    };
    script.src = "https://www.youtube.com/iframe_api";
    script.referrerPolicy = "strict-origin-when-cross-origin";
    script.onerror = () => {
      window.clearTimeout(timeout);
      script.remove();
      reject(new Error("Player unavailable"));
    };
    document.head.append(script);
  }).catch((error) => {
    loading = null;
    throw error;
  });
  return loading;
}

/** The official API reports private, removed, region-restricted and embedding-disabled videos. */
export function YouTubePlayer({
  videoId,
  title,
  onUnavailable,
}: {
  videoId: string;
  title: string;
  onUnavailable: () => void;
}) {
  const container = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let cancelled = false;
    let player: Player | undefined;
    let readyTimeout: number | undefined;
    void loadPlayer()
      .then((api) => {
        if (cancelled || !container.current) return;
        const mount = document.createElement("iframe");
        mount.title = title;
        mount.referrerPolicy = "strict-origin-when-cross-origin";
        mount.allow =
          "autoplay; encrypted-media; picture-in-picture; fullscreen";
        mount.allowFullscreen = true;
        mount.src = `https://www.youtube-nocookie.com/embed/${videoId}?enablejsapi=1&autoplay=1&rel=0&origin=${encodeURIComponent(window.location.origin)}`;
        container.current.replaceChildren(mount);
        readyTimeout = window.setTimeout(() => {
          if (!cancelled) onUnavailable();
        }, 8000);
        player = new api.Player(mount, {
          videoId,
          host: "https://www.youtube-nocookie.com",
          width: "100%",
          height: "100%",
          playerVars: { autoplay: 1, rel: 0, origin: window.location.origin },
          events: {
            onReady: (event) => {
              window.clearTimeout(readyTimeout);
              if (!cancelled) event.target.playVideo();
            },
            onError: () => {
              window.clearTimeout(readyTimeout);
              if (!cancelled) onUnavailable();
            },
          },
        });
      })
      .catch(() => {
        if (!cancelled) onUnavailable();
      });
    return () => {
      cancelled = true;
      window.clearTimeout(readyTimeout);
      player?.destroy();
    };
  }, [videoId, title, onUnavailable]);
  return (
    <div
      ref={container}
      aria-label={title}
      className="absolute inset-0 size-full [&_iframe]:size-full"
    />
  );
}
