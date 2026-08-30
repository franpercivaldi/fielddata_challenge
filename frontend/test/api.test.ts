import { ApiError, api, toPercentage, toRatio } from '@/lib/api';
import { beforeEach, describe, expect, it, vi } from 'vitest';

describe('API client', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  it('converts percentages without floating-point noise', () => {
    expect(toRatio(73)).toBe(0.73);
    expect(toPercentage('0.7300')).toBe(73);
  });

  it('adds the user header and serializes alert thresholds', async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response(
        JSON.stringify({
          id: 'alert-1',
          field_id: 'field-1',
          event_type: 'rain',
          threshold: '0.7300',
          is_active: true,
          created_at: '',
          updated_at: '',
        }),
        { status: 201, headers: { 'Content-Type': 'application/json' } },
      ),
    );

    await api.createAlert('user-1', {
      field_id: 'field-1',
      event_type: 'rain',
      thresholdPercent: 73,
    });

    const [, init] = vi.mocked(fetch).mock.calls[0];
    const headers = init?.headers as Headers;
    expect(headers.get('X-User-ID')).toBe('user-1');
    expect(JSON.parse(String(init?.body))).toMatchObject({ threshold: 0.73 });
  });

  it('keeps the internal token out of persistent storage and sends it as a header', async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify({ id: 'forecast-1' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    await api.upsertForecast('secret-token', {
      field_id: 'field-1',
      event_type: 'frost',
      forecast_date: '2026-08-29',
      probabilityPercent: 80,
    });
    const [, init] = vi.mocked(fetch).mock.calls[0];
    expect((init?.headers as Headers).get('X-Internal-Token')).toBe('secret-token');
  });

  it('normalizes FastAPI error responses', async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify({ detail: 'Unknown user' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    await expect(api.listFields('missing')).rejects.toEqual(
      expect.objectContaining<ApiError>({ message: 'Unknown user', status: 401 }),
    );
  });
});
