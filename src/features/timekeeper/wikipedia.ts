export type WikipediaTopic = {
  extract: string;
  title: string;
  url: string;
};

const fallbackTopics: WikipediaTopic[] = [
  {
    title: "アホウドリ",
    extract: "長距離を滑るように飛ぶ鳥で、見ていると肩の力が抜けます。",
    url: "https://ja.wikipedia.org/wiki/%E3%82%A2%E3%83%9B%E3%82%A6%E3%83%89%E3%83%AA",
  },
  {
    title: "偏光",
    extract: "同じ光でも向きで見え方が変わるので、気分転換向きの題材です。",
    url: "https://ja.wikipedia.org/wiki/%E5%81%8F%E5%85%89",
  },
];

export async function fetchRandomWikipediaTopic(
  fetchImpl: typeof fetch = fetch,
): Promise<WikipediaTopic> {
  try {
    const response = await fetchImpl("https://ja.wikipedia.org/api/rest_v1/page/random/summary", {
      headers: {
        accept: "application/json",
      },
    });

    if (!response.ok) {
      throw new Error(`Wikipedia returned ${response.status}`);
    }

    const data = (await response.json()) as {
      content_urls?: { desktop?: { page?: string } };
      extract?: string;
      title?: string;
    };

    if (!data.title || !data.extract) {
      throw new Error("Wikipedia payload was missing title or extract");
    }

    return {
      extract: data.extract,
      title: data.title,
      url:
        data.content_urls?.desktop?.page ??
        `https://ja.wikipedia.org/wiki/${encodeURIComponent(data.title)}`,
    };
  } catch {
    return fallbackTopics[Math.floor(Math.random() * fallbackTopics.length)] ?? fallbackTopics[0]!;
  }
}
