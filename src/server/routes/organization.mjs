// Compatibility facade. New composition uses explicit feature routes.
import { createRoutes as preferences } from './preferences.mjs';
import { createRoutes as taxonomy } from './taxonomy.mjs';
import { createRoutes as templates } from './templates.mjs';
export function offlineRoutes(context) {
  const routes = [preferences(context), taxonomy(context), templates(context)];
  return async (...args) => {
    for (const route of routes) if (await route(...args)) return true;
    return false;
  };
}
