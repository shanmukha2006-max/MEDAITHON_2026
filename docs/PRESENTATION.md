# Presentation pack

**Central message:** BreatheGuard doesn’t just detect a changing signal. It asks whether that signal can be trusted.

## Before you present

1. `npm run dev`, open the app in a fresh browser window (or click **Reset demo data**).
2. Stay on the login screen. Have the window wide enough that the narration bar and the result are both visible.
3. Optional backup: open a second tab on **Choose a patch** in case you are asked about the hardware.

## Judge Demo (about 3 minutes, 11 steps)

Click **Start Judge Demo** on the login screen, or **Judge Demo** in any portal’s top bar. The step-by-step table with timings and wording is in `docs/HANDOVER.md`, section 5. **Minimise** shrinks the narration bar; on a phone, use the floating Back/Next control.

| Step | Where | Point at |
|---|---|---|
| 1 | Patch page | The problem, the proposed solution, the two patches |
| 2 | Simulator | Care at rest: within range |
| 3 | Simulator | Walking: chest not trusted, breath sound trusted, chest-only alarm |
| 4 | Simulator | Fast, irregular breathing at rest: concerning; side-by-side with the walk |
| 5 | Simulator | Sensors fail: insufficient, and what would make it conclusive |
| 6 | Simulator | Quick in the same walk: insufficient; Care vs Quick |
| 7 | Patient portal | Only verified doctors listed |
| 8 | Hospital portal | Consented report visible; Ben locked |
| 9 | Authority portal | Decision needs a written reason |
| 10 | Patch page | Hardware-validation roadmap |
| 11 | Summary | Three outcomes and the core message |

## Three-minute script

Use the timed table in `docs/HANDOVER.md`, section 5: it follows the 11 steps above.

## Likely judge questions

**1. “Is any of this real hardware?”**
No. Both patches are proposed designs. The 10–15-day wear for Care is a target that depends on battery, adhesive and skin-safety work we haven’t done. What is real is the software: the simulator, the analysis engine and the three portals.

**2. “Your numbers look too good. Isn’t it circular?”**
Partly. We wrote the generator, the labels and the engine. We report seeds held out from tuning, and we report weaknesses, for example 1.3% false alarms under the heaviest noise setting. But this shows the logic works on our assumptions, not on people.

**3. “How do you tell movement from a real change?”**
Movement context from the motion sensor; per-sensor quality; the fact that chest motion is ruined by walking but breath sound much less so; and cross-sensor agreement, because real breaths show up in both sensors with the same timing while independent noise doesn’t. A change is flagged only if trustworthy evidence shows it beyond what the activity explains.

**4. “Why would anyone buy Quick if it says ‘insufficient’ so often?”**
That is the trade-off we want to make visible. At rest, Quick can still give an answer. While moving, a single chest sensor genuinely can’t separate artefact from change, and a cheap device that admits that is safer than one that guesses. Whether adding an acoustic sensor to Quick is worth its cost is an open design question; the simulator lets us explore it.

**5. “What if the system is wrong?”**
It is designed to fail towards uncertainty. Poor quality can only produce “insufficient”, never reassurance and never an alarm by itself. A normal simulated result says nothing about a real person, and anyone with real breathing difficulty should seek medical help rather than rely on a device like this.
