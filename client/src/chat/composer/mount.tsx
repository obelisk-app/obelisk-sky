// The chat panel's message bar as a React island: ChatPanel (plain DOM)
// mounts it once into its composer slot and re-renders it with new props
// when the channel, the reply or the handlers change.

import { createRoot } from 'react-dom/client';
import SkyComposer, { type SkyComposerProps } from './SkyComposer';
import '../../obelisk.generated.css';

export type { SkyComposerProps };

export interface MountedComposer {
  render(props: Omit<SkyComposerProps, 'inputRef'>): void;
  focus(): void;
  unmount(): void;
}

/** How long a focus asked for waits for the text box React is about to draw (a first mount, a new channel's box). */
export const FOCUS_WAIT_MS = 1500;

export function mountComposer(el: HTMLElement): MountedComposer {
  const root = createRoot(el);
  // React draws later than render() returns: a focus asked for meanwhile goes to
  // the next text box it attaches (within FOCUS_WAIT_MS), not the one going away.
  let input: HTMLTextAreaElement | null = null;
  let focusUntil = 0;
  const inputRef = {
    get current() { return input; },
    set current(box: HTMLTextAreaElement | null) {
      input = box;
      if (box && Date.now() < focusUntil) { focusUntil = 0; box.focus(); }
    },
  };
  let last: Omit<SkyComposerProps, 'inputRef'> | null = null;
  return {
    render(props) {
      last = props;
      // Keyed by channel: a new channel gets a fresh draft, like the app's.
      root.render(<SkyComposer key={props.groupId} {...props} inputRef={inputRef} />);
    },
    focus() {
      if (!last) return;
      input?.focus();
      focusUntil = Date.now() + FOCUS_WAIT_MS;
    },
    unmount() {
      root.unmount();
    },
  };
}
