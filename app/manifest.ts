import type { MetadataRoute } from "next";

// What a phone shows when HEAT is added to the home screen, and how it opens.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "HEAT · Know your menu",
    short_name: "HEAT",
    description: "Menu knowledge, ready for service.",
    start_url: "/",
    display: "standalone",
    background_color: "#f7f1e6",
    theme_color: "#f7f1e6",
    icons: [
      { src: "/icon.svg", sizes: "any", type: "image/svg+xml" },
      { src: "/apple-icon", sizes: "180x180", type: "image/png" },
    ],
  };
}
