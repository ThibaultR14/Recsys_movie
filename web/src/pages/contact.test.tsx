import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CONTACT, CONTACT_EMAIL, MESSAGE_MAX } from '../content/contact';
import { Contact } from './Contact';
import { mailtoHref } from './contactMail';

describe('mailtoHref', () => {
  it('encodes the subject and the body; nothing added', () => {
    const href = mailtoHref('a@b.fr', 'film mal reconnu', 'Le Mépris (1963) & « Ran » ?\n#2');
    expect(href).toBe(
      'mailto:a@b.fr?subject=%5Bp%C3%A9pite%5D%20film%20mal%20reconnu' +
        '&body=Le%20M%C3%A9pris%20(1963)%20%26%20%C2%AB%20Ran%20%C2%BB%20%3F%0D%0A%232',
    );
    const url = new URL(href);
    expect(url.searchParams.get('subject')).toBe('[pépite] film mal reconnu');
    expect(url.searchParams.get('body')).toBe('Le Mépris (1963) & « Ran » ?\r\n#2');
    expect([...url.searchParams.keys()]).toEqual(['subject', 'body']);
  });

  it('a 2 000-character message stays whole', () => {
    const msg = 'é'.repeat(MESSAGE_MAX);
    expect(new URL(mailtoHref('a@b.fr', 'idée', msg)).searchParams.get('body')).toBe(msg);
  });
});

describe('Contact', () => {
  afterEach(() => vi.restoreAllMocks());

  it('the address is selectable text; copy uses the clipboard and says so', async () => {
    const user = userEvent.setup();
    const write = vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue();
    render(<Contact navigate={() => {}} />);
    expect(screen.getByText(CONTACT_EMAIL).tagName).toBe('CODE');
    await user.click(screen.getByRole('button', { name: CONTACT.copier }));
    expect(write).toHaveBeenCalledWith(CONTACT_EMAIL);
    expect(await screen.findByText(CONTACT.copie)).toHaveAttribute('aria-live', 'polite');
  });

  it('copy without clipboard: the address gets selected', async () => {
    const user = userEvent.setup();
    vi.spyOn(navigator.clipboard, 'writeText').mockRejectedValue(new Error('denied'));
    render(<Contact navigate={() => {}} />);
    await user.click(screen.getByRole('button', { name: CONTACT.copier }));
    expect(await screen.findByText(CONTACT.copieEchec)).toBeInTheDocument();
    expect(window.getSelection()?.toString()).toBe(CONTACT_EMAIL);
  });

  it('subject and message are required; then the mailto: opens, never a request', async () => {
    const navigate = vi.fn();
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    render(<Contact navigate={navigate} />);
    const send = screen.getByRole('button', { name: CONTACT.bouton });
    const subjects = screen.getByRole('group', { name: CONTACT.sujetLegende });
    expect(within(subjects).getAllByRole('radio')).toHaveLength(4);
    for (const r of within(subjects).getAllByRole('radio')) expect(r).not.toBeChecked();

    await userEvent.click(send);
    expect(screen.getByRole('alert')).toHaveTextContent(CONTACT.erreurSujet);
    await userEvent.click(within(subjects).getByRole('radio', { name: 'bug' }));
    await userEvent.click(send);
    expect(screen.getByRole('alert')).toHaveTextContent(CONTACT.erreurMessage);
    const box = screen.getByRole('textbox', { name: CONTACT.messageLabel });
    expect(box).toHaveAttribute('maxlength', String(MESSAGE_MAX));
    await userEvent.type(box, 'le curseur saute');
    expect(screen.getByText(`16 / ${MESSAGE_MAX}`)).toBeInTheDocument();
    await userEvent.click(send);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(navigate).toHaveBeenCalledWith(mailtoHref(CONTACT_EMAIL, 'bug', 'le curseur saute'));
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
