import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

describe('component test environment', () => {
  it('renders into jsdom', () => {
    render(<p>salut.</p>);
    expect(screen.getByText('salut.')).toBeTruthy();
  });
});
