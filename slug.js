// Ladny adres wyszukiwania zamiast nazwy pliku: #olx-mieszkania-wynajem-gdansk.
// Wspolne dla klienta (routing) i serwera (/api/history?slug=... rozwiazuje udostepniony link).
export function histSlug(h) {
  try {
    return [h.portal, ...new URL(h.url).pathname.split("/").filter((s) => s && s !== "pl" && s !== "nieruchomosci")]
      .join("-").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  } catch {
    return h.file.replace(/\.json$/i, "");
  }
}
