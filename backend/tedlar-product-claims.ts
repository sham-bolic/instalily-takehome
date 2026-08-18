export type TedlarOutreachAngle =
  | "uv_fading"
  | "graffiti_cleanability"
  | "weather_corrosion"
  | "durable_graphics"
  | "aircraft_interiors"
  | "role_only";

export type TedlarProductClaim = {
  id: string;
  angle: TedlarOutreachAngle;
  claim: string;
  sourceUrl: string;
};

const DUPONT_SIGNAGE_URL =
  "https://www.dupont.com/tedlar/tedlar-signage-applications.html";
const DUPONT_AEROSPACE_URL =
  "https://www.dupont.com/tedlar/tedlar-aerospace-applications.html";

export const TEDLAR_PRODUCT_CLAIMS: readonly TedlarProductClaim[] = [
  {
    id: "tedlar_uv_fading",
    angle: "uv_fading",
    claim:
      "Tedlar Clear Protection film is designed to protect outdoor graphics against harsh UV exposure and fading.",
    sourceUrl: DUPONT_SIGNAGE_URL,
  },
  {
    id: "tedlar_graffiti_cleanability",
    angle: "graffiti_cleanability",
    claim:
      "Tedlar Clear Protection film provides graffiti resistance and can reduce cleaning and maintenance for graphic surfaces.",
    sourceUrl: DUPONT_SIGNAGE_URL,
  },
  {
    id: "tedlar_weather_corrosion",
    angle: "weather_corrosion",
    claim:
      "Tedlar Clear Protection film is designed to protect graphics against fading and corrosion in demanding outdoor exposure.",
    sourceUrl: DUPONT_SIGNAGE_URL,
  },
  {
    id: "tedlar_durable_graphics",
    angle: "durable_graphics",
    claim:
      "Tedlar Clear Protection film is a surface laminate designed to keep outdoor signage looking newer for longer.",
    sourceUrl: DUPONT_SIGNAGE_URL,
  },
  {
    id: "tedlar_aircraft_interiors",
    angle: "aircraft_interiors",
    claim:
      "Tedlar PVF film provides easy-to-clean, scuff-resistant surface protection for aircraft interiors and is available in configurable colors, textures, gloss levels, and finishes.",
    sourceUrl: DUPONT_AEROSPACE_URL,
  },
  {
    id: "tedlar_role_only",
    angle: "role_only",
    claim:
      "Tedlar Clear Protection film is designed to protect graphics against UV exposure, fading, dirt, and graffiti.",
    sourceUrl: DUPONT_SIGNAGE_URL,
  },
] as const;

export function tedlarClaimFor(
  angle: TedlarOutreachAngle,
): TedlarProductClaim {
  return (
    TEDLAR_PRODUCT_CLAIMS.find((claim) => claim.angle === angle) ??
    TEDLAR_PRODUCT_CLAIMS.at(-1)!
  );
}
