import type { MetadataRoute } from "next";

const routes = ["", "/players", "/squad", "/optimize", "/about-model"];

export default function sitemap(): MetadataRoute.Sitemap {
  return routes.map((route) => ({
    url: `https://fpl-copilot.tech${route}`,
    lastModified: new Date(),
  }));
}
