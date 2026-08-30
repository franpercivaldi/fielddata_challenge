import Home from '@/app/page';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';

const user = { id: 'user-1', name: 'Ana Productora', created_at: '2026-08-28T10:00:00Z' };

function jsonResponse(value: unknown, status = 200) {
  return Promise.resolve(
    new Response(JSON.stringify(value), {
      status,
      headers: { 'Content-Type': 'application/json' },
    }),
  );
}

beforeEach(() => {
  window.localStorage.clear();
  vi.stubGlobal(
    'fetch',
    vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('/users')) return jsonResponse([user]);
      if (url.endsWith('/fields')) return jsonResponse([]);
      if (url.endsWith('/alerts')) return jsonResponse([]);
      if (url.includes('/notifications')) return jsonResponse([]);
      return jsonResponse({ detail: 'Not found' }, 404);
    }),
  );
});

it('selects a user, persists the choice and loads their dashboard', async () => {
  render(<Home />);
  const userButton = await screen.findByRole('button', { name: /Ana Productora/i });
  fireEvent.click(userButton);

  expect(await screen.findByText('Buen día, Ana')).toBeInTheDocument();
  expect(window.localStorage.getItem('agrobot-selected-user')).toBe(user.id);
  await waitFor(() => expect(fetch).toHaveBeenCalledWith(expect.stringContaining('/fields'), expect.anything()));
});

it('restores a previously selected user', async () => {
  window.localStorage.setItem('agrobot-selected-user', user.id);
  render(<Home />);
  expect(await screen.findByText('Buen día, Ana')).toBeInTheDocument();
});
