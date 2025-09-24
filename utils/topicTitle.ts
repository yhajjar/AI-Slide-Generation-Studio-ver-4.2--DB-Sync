// utils/topicTitle.ts
export const titleFromHtml = (html: string, fallback: string): string => {
  try {
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const h = doc.querySelector('h1, h2, h3');
    const t = h?.textContent?.trim();
    return t && t.length > 2 ? t : fallback;
  } catch (e) {
    console.error("Error parsing HTML for title:", e);
    return fallback;
  }
};
