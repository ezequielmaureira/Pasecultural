const DIACRITICS_REGEX = new RegExp("[̀-ͯ]", "g");

export function slugify(text) {
    return text
        .toString()
        .normalize("NFD")
        .replace(DIACRITICS_REGEX, "")
        .toLowerCase()
        .trim()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "");
}

export async function generateUniqueSlug(title, isTaken) {
    const base = slugify(title) || "evento";
    let slug = base;
    let attempt = 0;

    while (await isTaken(slug)) {
        attempt += 1;
        slug = `${base}-${Math.random().toString(36).slice(2, 6)}`;
        if (attempt > 10) {
            slug = `${base}-${Date.now()}`;
            break;
        }
    }

    return slug;
}
