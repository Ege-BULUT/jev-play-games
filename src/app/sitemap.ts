import type { MetadataRoute } from "next";
import { GAMES } from "@/games";

const BASE = "https://jev-play-games.vercel.app";

export default function sitemap(): MetadataRoute.Sitemap {
  return ["", ...GAMES.map((g) => `/play/${g.id}`)].map((p) => ({ url: BASE + p, lastModified: new Date() }));
}
