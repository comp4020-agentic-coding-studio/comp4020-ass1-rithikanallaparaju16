# Assignment 1 — After the Bite

## The breakthrough

Building the calibration harness before building anything visible. I had a
plausible glucose model and no way to know if it was right, so instead of
wiring it to a chart I wrote a throwaway test that printed ten reference plates
next to figures I had pulled from the literature. It took twenty minutes and it
immediately showed the model giving a 2,700 kcal blowout a *lower* peak than a
vending-machine lunch.

That reframed the whole week. Without the harness I would have looked at one
pretty curve, decided it looked about right, and shipped something confidently
wrong. With it, I could see that the problem was not a bad constant but a bad
representation — my brakes were in absolute grams when they should have been
relative to the meal's carbohydrate. The fix corrected all ten plates at once,
which is how I knew it was the real bug.

## What it changed about me

I used to treat green tests as the finish line. This week I broke my own code on
purpose to see whether the tests would notice, and one of them did not: deleting
the hypoglycaemia clamp left every test passing. The invariant I cared about most
was the one nothing was actually defending.

I want to be the kind of developer who asks "what would make this fail?" before
asking "does this pass?" — and who is willing to make a model *less* flattering
to their own argument when the honest version is better. Cutting the eating-order
benefit to zero for a plate of pure sugar weakened my headline number and made
the page worth reading.

---

*Draft in my own words — worth rewriting in your voice before you ship.*
