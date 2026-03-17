export function extractYouTubeVideoId(input: string) {
  const value = input.trim();
  if (!value) {
    return null;
  }

  if (/^[a-zA-Z0-9_-]{11}$/.test(value)) {
    return value;
  }

  try {
    const url = new URL(value);

    if (url.hostname === "youtu.be") {
      const candidate = url.pathname.replace(/^\/+/, "");
      return /^[a-zA-Z0-9_-]{11}$/.test(candidate) ? candidate : null;
    }

    if (url.hostname.includes("youtube.com")) {
      const fromQuery = url.searchParams.get("v");
      if (fromQuery && /^[a-zA-Z0-9_-]{11}$/.test(fromQuery)) {
        return fromQuery;
      }

      const segments = url.pathname.split("/").filter(Boolean);
      const last = segments.at(-1);
      if (last && /^[a-zA-Z0-9_-]{11}$/.test(last)) {
        return last;
      }
    }
  } catch {
    return null;
  }

  return null;
}
