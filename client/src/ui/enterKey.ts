// Enter / Return in the village (issue #6): type in the chat that's open, else
// open the relay's general chat ready to type in. Left alone over a dialog,
// with a modifier, or when it is pressing a focused button (the minimap…).

export type EnterAction = 'focus-chat' | 'open-general' | null;

export function enterAction(o: { key: string; mod: boolean; dialog: boolean; onControl: boolean; chatOpen: boolean }): EnterAction {
  if (o.key !== 'Enter' || o.mod || o.dialog || o.onControl) return null;
  return o.chatOpen ? 'focus-chat' : 'open-general';
}

/** Does Enter on this element already do something of its own (a button, a link, a select)? */
export function isControl(t: EventTarget | null): boolean {
  return !!(t as Element | null)?.closest?.('button, a, [role="button"], select');
}
