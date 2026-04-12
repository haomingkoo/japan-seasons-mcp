import { cache, TTL } from "./cache.js";
import { logger } from "./logger.js";
import { safeFetch } from "./fetch.js";
import { findAreaByName, findWeatherCityId, JMA_AREAS } from "./areas.js";

export interface WeatherForecast {
  publicTime: string;
  publishingOffice: string;
  title: string;
  description: string;
  forecasts: DayForecast[];
  location: {
    area: string;
    prefecture: string;
    district: string;
    city: string;
  };
}

export interface DayForecast {
  date: string;
  dateLabel: string;
  telop: string;
  detail: {
    weather: string | null;
    wind: string | null;
    wave: string | null;
  };
  temperature: {
    min: { celsius: string | null; fahrenheit: string | null };
    max: { celsius: string | null; fahrenheit: string | null };
  };
  chanceOfRain: {
    T00_06: string;
    T06_12: string;
    T12_18: string;
    T18_24: string;
  };
}


/** Fetch weather forecast via the tsukumijima API (JMA data wrapper) */
export async function getWeatherForecast(city: string): Promise<WeatherForecast> {
  const cityId = findWeatherCityId(city);
  if (!cityId) {
    const available = Object.keys(
      await import("./areas.js").then((m) => m.WEATHER_CITY_IDS)
    ).join(", ");
    throw new Error(
      `City "${city}" not found. Available cities: ${available}`
    );
  }

  const cacheKey = `weather:${cityId}`;
  return cache.getOrFetch(cacheKey, TTL.WEATHER, async () => {
    const url = `https://weather.tsukumijima.net/api/forecast/city/${cityId}`;
    logger.info(`Fetching weather for ${city} (${cityId})`);

    const res = await safeFetch(url);
    const data = await res.json();

    return {
      publicTime: data.publicTimeFormatted ?? data.publicTime,
      publishingOffice: data.publishingOffice,
      title: data.title,
      description: data.description?.text ?? "",
      forecasts: (data.forecasts ?? []).map((f: any) => ({
        date: f.date,
        dateLabel: f.dateLabel,
        telop: f.telop,
        detail: {
          weather: f.detail?.weather ?? null,
          wind: f.detail?.wind ?? null,
          wave: f.detail?.wave ?? null,
        },
        temperature: {
          min: {
            celsius: f.temperature?.min?.celsius ?? null,
            fahrenheit: f.temperature?.min?.fahrenheit ?? null,
          },
          max: {
            celsius: f.temperature?.max?.celsius ?? null,
            fahrenheit: f.temperature?.max?.fahrenheit ?? null,
          },
        },
        chanceOfRain: {
          T00_06: f.chanceOfRain?.T00_06 ?? "--%",
          T06_12: f.chanceOfRain?.T06_12 ?? "--%",
          T12_18: f.chanceOfRain?.T12_18 ?? "--%",
          T18_24: f.chanceOfRain?.T18_24 ?? "--%",
        },
      })),
      location: {
        area: data.location?.area ?? "",
        prefecture: data.location?.prefecture ?? "",
        district: data.location?.district ?? "",
        city: data.location?.city ?? city,
      },
    };
  });
}

