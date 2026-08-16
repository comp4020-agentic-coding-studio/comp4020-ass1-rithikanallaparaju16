# Process overview

## What I built

**After the Bite** is an interactive explainer for one claim: the order you eat
your food in changes your blood sugar. You build a plate from 78 foods, choose
what you do for the two hours afterwards, and the page draws two glucose curves
from that single plate — one where the protein and vegetables go in first, one
where the carbohydrate does. Same food, same grams, same calories, different
curve. Underneath is a postprandial model calibrated to published figures rather
than invented: glycaemic index from Atkinson's 2021 tables, the order effect from
Shukla's 2019 prediabetes trial, activity effects from walking and stair-climbing
crossover trials. The hard part was never drawing the curve. It was stopping the
model from flattering the claim it exists to make.

## The moments that mattered

### The model made a 2,700 kcal blowout safer than a snack

Before any UI, I wrote a throwaway harness that printed ten reference plates
against figures from the literature. It immediately showed a huge plate peaking
at 119 mg/dL and a vending-machine lunch at 148 — backwards. The obvious fix was
tuning coefficients until the numbers looked right. Instead I read it as a
*shape* error: my fibre, fat and protein brakes were in absolute grams, so 67 g
of fat braked a 471 g-carb meal as hard as a 30 g one. I changed the
representation, not the constants — every brake is now per gram of available
carbohydrate. That fixed the ordering across all ten plates at once, which is how
I knew it was the real bug and not a constant that happened to fit
([`5aebed3`](https://github.com/comp4020-agentic-coding-studio/comp4020-ass1-rithikanallaparaju16/commit/5aebed3)).

### Making the model less flattering to my own thesis

The same harness showed one banana getting a 14% benefit from "eating fibre
first" — incoherent, since you cannot eat a banana's fibre before its own sugar.
Leaving it would have made my headline effect look bigger. I restricted the
preload to items a visitor can physically eat first, so the model now says a
cola, two slices of white bread and a donut get **zero** benefit from reordering.
That plate is a preset, and its verdict — "the two lines are identical, and that
is the honest answer" — became the most interesting thing on the page
([`5aebed3`](https://github.com/comp4020-agentic-coding-studio/comp4020-ass1-rithikanallaparaju16/commit/5aebed3),
pinned by a test in
[`1b828ce`](https://github.com/comp4020-agentic-coding-studio/comp4020-ass1-rithikanallaparaju16/commit/1b828ce)).

### A test that passed with the code deleted

With 96 checks green I broke the model on purpose to see if the tests were
load-bearing. Two mutants failed as expected; the third did not. Deleting the
hypoglycaemia clamp left all 38 curve tests green, because the reactive dip is
capped well above 70 and the clamp never fires. Green tests, unguarded invariant.
So I extracted `clampFloor`, unit-tested it directly, and added a test asserting
the model keeps *margin* above the floor — a curve sitting on its own clamp is a
lie about its shape. Each mutant now fails a different test
([`1b828ce`](https://github.com/comp4020-agentic-coding-studio/comp4020-ass1-rithikanallaparaju16/commit/1b828ce)).

### Wiring the sensor the roster does not have

`CLAUDE.md` says nothing in the shipped checks measures accessibility and that
wiring those is my work. Mine computes WCAG contrast from the tokens *as declared
in `styles.css`*, so it cannot drift from a duplicated palette. It failed 13 of
28 immediately, including the focus ring — the one thing a keyboard user
navigates by — at 2.42:1. One failure was my test being wrong, not the design: it
compared luminance *between* the two curves, the wrong property for categorical
colour. It now asserts redundant encoding instead: one line dashed, one solid
([`bb800f1`](https://github.com/comp4020-agentic-coding-studio/comp4020-ass1-rithikanallaparaju16/commit/bb800f1)).

All four lessons are now written into `CLAUDE.md`, so the next build here starts
on the far side of them
([`5aebed3...bb800f1`](https://github.com/comp4020-agentic-coding-studio/comp4020-ass1-rithikanallaparaju16/compare/5aebed3...bb800f1)).
