export const fetcher = (url: string) =>
  fetch(url).then(async (r) => {
    const json = await r.json().catch(() => ({}));
    if (!r.ok) {
      const msg = (json as { error?: string })?.error ?? `API ${r.status}`;
      throw new Error(msg);
    }
    return json;
  });
