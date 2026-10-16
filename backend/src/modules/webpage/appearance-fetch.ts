import axios from 'axios';
import { appearanceSchema, defaultAppearance } from './appearance-contract';

// Dedicated client: never forward the panel token, cookies or subscriber data.
export async function fetchAppearance(url?: string) {
    if (!url) return defaultAppearance;
    const response = await axios.get(url, {
        timeout: 3000, maxContentLength: 65536, maxRedirects: 0,
        headers: { Accept: 'application/json' },
    });
    const config = appearanceSchema.parse(response.data);
    return { ...config, alerts: config.alerts.filter((alert) => alert.enabled) };
}
