import { render, screen } from '@testing-library/react';
import App from './App';

jest.mock('./lib/supabaseClient', () => ({
  isSupabaseConfigured: false,
  supabase: null,
}));

jest.mock('./lib/openrouter', () => ({
  isOpenRouterConfigured: false,
  sendOpenRouterChat: jest.fn(),
}));

test('renders the DoudouGPT brand', () => {
  render(<App />);

  expect(screen.getAllByText(/DoudouGPT/i).length).toBeGreaterThan(0);
});
