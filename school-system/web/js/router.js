/**
 * Hash routing lives in its own module so views can navigate without importing
 * app.js, which imports them.
 */
export function parseHash() {
  const raw = window.location.hash.replace(/^#\/?/, "");
  const [path, query] = raw.split("?");
  return {
    route: path || "dashboard",
    params: Object.fromEntries(new URLSearchParams(query ?? "")),
  };
}

export function navigate(route, params = {}) {
  const query = new URLSearchParams(
    Object.entries(params).filter(([, value]) => value !== undefined && value !== null && value !== ""),
  ).toString();
  window.location.hash = `#/${route}${query ? `?${query}` : ""}`;
}
