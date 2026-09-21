// A game is a pure, deterministic state machine driven one Jev decision at a time.
// The same module runs in the browser (simulate, render) and on the server (describe the state to
// Jev, check it is well formed), so nothing here may touch the DOM outside render().

export type Option = {
  id: string;     // key Jev answers with
  label: string;  // short text on the decision bar
  detail: string; // what taking it leads to; Jev reads this as the option's criterion
};

export type Game<S> = {
  id: string;
  title: string;
  blurb: string;
  accent: string;        // card and bar colour
  instruction: string;   // the question put to Jev every turn
  stepMs: number;        // how long one decision's animation lasts in the viewer
  init(seed: number): S;
  isState(value: unknown): value is S; // server-side shape check on client-supplied state
  describe(s: S): string;
  options(s: S): Option[];             // legal actions only, at most 255
  step(s: S, action: string): S;
  over(s: S): boolean;
  score(s: S): number;
  render(ctx: CanvasRenderingContext2D, s: S, w: number, h: number, t: number): void; // t: 0..1 through the step
};

export type AnyGame = Game<any>; // eslint-disable-line @typescript-eslint/no-explicit-any
