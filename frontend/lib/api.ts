export type WeatherEvent = 'rain' | 'frost' | 'hail' | 'wind';

export interface User {
  id: string;
  name: string;
  created_at: string;
}

export interface FarmField {
  id: string;
  user_id: string;
  name: string;
  created_at: string;
}

export interface Alert {
  id: string;
  field_id: string;
  event_type: WeatherEvent;
  threshold: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface Notification {
  id: string;
  alert_id: string;
  forecast_id: string;
  event_type: WeatherEvent;
  forecast_date: string;
  probability: string;
  threshold: string;
  created_at: string;
  read_at: string | null;
}

export interface Forecast {
  id: string;
  field_id: string;
  event_type: WeatherEvent;
  forecast_date: string;
  probability: string;
  created_at: string;
  updated_at: string;
}

export class ApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL || 'http://localhost:8000').replace(
  /\/$/,
  '',
);

interface RequestOptions extends RequestInit {
  userId?: string;
  internalToken?: string;
}

async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { userId, internalToken, headers: customHeaders, ...init } = options;
  const headers = new Headers(customHeaders);
  if (init.body) headers.set('Content-Type', 'application/json');
  if (userId) headers.set('X-User-ID', userId);
  if (internalToken) headers.set('X-Internal-Token', internalToken);

  let response: Response;
  try {
    response = await fetch(`${API_BASE_URL}${path}`, { ...init, headers });
  } catch {
    throw new ApiError('No pudimos conectar con el servidor. Verificá que la API esté activa.', 0);
  }

  if (!response.ok) {
    let message = 'Ocurrió un error inesperado.';
    try {
      const payload = (await response.json()) as { detail?: string | Array<{ msg: string }> };
      if (typeof payload.detail === 'string') message = payload.detail;
      if (Array.isArray(payload.detail)) message = payload.detail.map((item) => item.msg).join('. ');
    } catch {
      // Keep the human-friendly fallback for non-JSON responses.
    }
    throw new ApiError(message, response.status);
  }

  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

export const toRatio = (percentage: number) => Number((percentage / 100).toFixed(4));
export const toPercentage = (ratio: string | number) => Math.round(Number(ratio) * 100);

export const api = {
  listUsers: () => request<User[]>('/users'),
  createUser: (name: string) =>
    request<User>('/users', { method: 'POST', body: JSON.stringify({ name }) }),

  listFields: (userId: string) => request<FarmField[]>('/fields', { userId }),
  createField: (userId: string, name: string) =>
    request<FarmField>('/fields', { method: 'POST', userId, body: JSON.stringify({ name }) }),

  listAlerts: (userId: string) => request<Alert[]>('/alerts', { userId }),
  createAlert: (
    userId: string,
    payload: { field_id: string; event_type: WeatherEvent; thresholdPercent: number },
  ) =>
    request<Alert>('/alerts', {
      method: 'POST',
      userId,
      body: JSON.stringify({
        field_id: payload.field_id,
        event_type: payload.event_type,
        threshold: toRatio(payload.thresholdPercent),
      }),
    }),
  updateAlert: (
    userId: string,
    alertId: string,
    payload: { thresholdPercent?: number; is_active?: boolean },
  ) =>
    request<Alert>(`/alerts/${alertId}`, {
      method: 'PATCH',
      userId,
      body: JSON.stringify({
        ...(payload.thresholdPercent === undefined
          ? {}
          : { threshold: toRatio(payload.thresholdPercent) }),
        ...(payload.is_active === undefined ? {} : { is_active: payload.is_active }),
      }),
    }),
  deactivateAlert: (userId: string, alertId: string) =>
    request<void>(`/alerts/${alertId}`, { method: 'DELETE', userId }),

  listNotifications: (userId: string, unreadOnly = false) =>
    request<Notification[]>(`/notifications${unreadOnly ? '?unread_only=true' : ''}`, { userId }),
  markNotificationRead: (userId: string, notificationId: string) =>
    request<Notification>(`/notifications/${notificationId}/read`, {
      method: 'PATCH',
      userId,
    }),

  upsertForecast: (
    internalToken: string,
    payload: {
      field_id: string;
      event_type: WeatherEvent;
      forecast_date: string;
      probabilityPercent: number;
    },
  ) =>
    request<Forecast>('/internal/weather-forecasts', {
      method: 'PUT',
      internalToken,
      body: JSON.stringify({
        field_id: payload.field_id,
        event_type: payload.event_type,
        forecast_date: payload.forecast_date,
        probability: toRatio(payload.probabilityPercent),
      }),
    }),
};
