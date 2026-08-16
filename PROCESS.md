# Process overview

## What I built

**After the Bite** is an interactive explainer for one claim: three small habits
— what goes on the plate, the order you eat it in, and what you do for twenty
minutes afterwards — move your blood sugar more than the diet does. You build a
meal from 78 foods and the page draws two glucose curves from that one plate:
same food, same grams, same calories, different curve. The model is calibrated
to published figures rather than invented — glycaemic index from Atkinson's 2021
tables, the order effect from Shukla's 2019 prediabetes trial. The hard part was
never drawing the curve. It was stopping the model from flattering the claim it
exists to make.

## The moments that mattered

### Constraining the agent before it could be wrong

Rather than checking each curve by eye, I put the physiology into `CLAUDE.md` as
hard invariants: never below 70 mg/dL, back to baseline by 180 minutes, grams
always serves × unit weight. Giving it the *range* up front meant a class of
plausible-looking errors could never ship. Then I broke the model on purpose to
check the tests were load-bearing — and one was not. Deleting the hypoglycaemia clamp left all 38 curve tests green,
because the reactive dip is capped well above 70 and the clamp never fires. So I
extracted `clampFloor`, unit-tested it directly, and added a test that the model
keeps *margin* above the floor
([`5aebed3`](https://github.com/comp4020-agentic-coding-studio/comp4020-ass1-rithikanallaparaju16/commit/5aebed3),
[`1b828ce`](https://github.com/comp4020-agentic-coding-studio/comp4020-ass1-rithikanallaparaju16/commit/1b828ce)).

### The banana that proved the model was flattering me

A calibration harness showed a single banana getting a 14% benefit from "eating
the fibre first". That is incoherent: a banana's fibre and its sugar arrive
together, so the carbohydrate is absorbed and you get the spike regardless. The
agent had counted any fibre on the plate as a preload. Leaving it would have
made my headline effect look bigger, so I restricted the preload to items you can
physically lift and eat first. The model now says a cola, two slices of white
bread and a donut get **zero** benefit from reordering — and that plate is a
preset, whose verdict became the most interesting thing on the page
([`5aebed3`](https://github.com/comp4020-agentic-coding-studio/comp4020-ass1-rithikanallaparaju16/commit/5aebed3)).

### Stitch for the palette, then a sensor to police it

I used Google Stitch to settle the colour scheme, which produced `DESIGN.md`,
then built both themes from that one token set — dark derives from its
`inverse-*` and `*-fixed-dim` tones rather than being invented alongside. The
second theme paid for itself immediately, exposing six colours that had escaped
the token layer, including the header, which was hardcoded light and turned the
brand name invisible against itself. My contrast sensor now runs every pair
against **both** palettes
([`bb800f1`](https://github.com/comp4020-agentic-coding-studio/comp4020-ass1-rithikanallaparaju16/commit/bb800f1),
[`145b270`](https://github.com/comp4020-agentic-coding-studio/comp4020-ass1-rithikanallaparaju16/commit/145b270)).

### Directing the layout by screenshot

Twice the agent produced a layout that read fine in source and badly on screen.
First an empty right half of the fold; then a chart pinned beside the builder,
which spends half the screen showing a flat line while you are still choosing
food.

![The hero left the right half of the fold empty](image-3.png)
![The pinned chart, showing nothing while the plate is being built](image-2.png)

I sent it the screenshots and specified the fix rather than the symptom: one
scroll, a dashed rail with a checkpoint per step, plate before exercise before
curve, and a burger menu on the phone instead of five links wrapping the header
to 98px tall. Driving Playwright to measure rather than look also caught the bug
underneath it all — the chart SVG, in flow with a stale `width`, was propping the
grid to 976px inside a 768px window, and deadlocking its own `ResizeObserver`
([`145b270`](https://github.com/comp4020-agentic-coding-studio/comp4020-ass1-rithikanallaparaju16/commit/145b270),
[`a9965c3`](https://github.com/comp4020-agentic-coding-studio/comp4020-ass1-rithikanallaparaju16/commit/a9965c3)).

Every lesson above is now written into `CLAUDE.md`, so the next build here starts
on the far side of them
([`5aebed3...a9965c3`](https://github.com/comp4020-agentic-coding-studio/comp4020-ass1-rithikanallaparaju16/compare/5aebed3...a9965c3)).
