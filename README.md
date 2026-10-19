# Model Gear

Automatically selects the right Claude Code model and reasoning effort for every prompt, balancing performance, speed, and cost.

Without it, you pick one model and live with it. A rename runs on the same model as a database redesign. With Model Gear on, each prompt you type is sorted first. Quick jobs go to a small model at low effort. Hard jobs go to the strongest model you have, thinking longer.

## Install

You need Claude Code with plugin support.

```
claude plugin marketplace add muhamoussa7/claude-model-gear
claude plugin install model-gear@claude-model-gear
```

Start a new session, then run:

```
/modelgear on
```

A "Model Gear" chip appears in the footer. Press it to switch Model Gear on or off.

## Where it works

| Where | Works? |
| --- | --- |
| Terminal (`claude`) | Yes |
| Claude desktop app, Code tab | Yes, for local sessions. Not in WSL sessions. |
| VS Code extension | Yes, with extension 2.1.299 or later |
| JetBrains | Yes, through the `claude` CLI in the IDE terminal |
| Claude Code on the web (claude.ai/code) | No. Cloud sessions don't load plugins from your machine. |
| Regular claude.ai chat | No. Plugins don't run in chat. |

## Use

| Command | What it does |
| --- | --- |
| `/modelgear on` | Turns it on and remembers the model you were using. |
| `/modelgear off` | Turns it off and puts that model back. |
| `/modelgear status` | Shows whether it is on, the current model, and what the last prompt got. |

After each prompt, the model and effort it ran with are shown under the prompt, for example `sonnet · medium`.

## How it picks

1. When you type a prompt, a small model reads it and answers in two words: a level, then an effort. The call times out after 4 seconds. If it fails or times out, keyword rules make the guess instead.
2. The level decides the model line:

   | Level | Model line | Default effort |
   | --- | --- | --- |
   | small | haiku | low |
   | everyday | sonnet | medium |
   | strong | opus | high |
   | strongest | fable | xhigh |

   Models are matched by line name inside the options your install offers, so new versions work without a code change. If your install has no model for a level, it steps down to the next line that exists.
3. If your prompt names an effort ("ultrathink", "use max effort"), that wins over the classifier.
4. The model is set through Claude Code's own `model` setting. Effort is sent with each request, for the main session and its subagents. Effort is never saved to your settings. Subagents keep their own model.

It leaves these prompts alone: slash commands, messages sent while Claude is still working, and short replies such as "yes" or "keep going".

## Your choice always wins

If you change the model with `/model`, or the effort with `/effort`, Model Gear turns itself off and keeps what you picked. It does the same if the model has changed since the last prompt. Turning it off with the command or the chip puts back the model you had before you turned it on.

If your organization fixes the model, Model Gear stays off and says so.

## What it sends

Each prompt you type (the first 6,000 characters) is sent to the smallest model your install offers, only to be sorted. It uses your normal Claude Code session and account, with no other service involved. Besides the `model` setting it changes, the only thing it stores is its own on/off state and the last pick.

## Develop

There is no build step and no dependencies. Claude Code checks the types and runs the tests:

```
claude plugin validate model-gear
claude plugin test model-gear
```

The tests import from `claude-code/testing`, which exists only under `claude plugin test`, so `node` and `bun test` will not run them.

| File | Purpose |
| --- | --- |
| `model-gear/hooks/register.tsx` | Wires the hooks, the command and the footer chip. |
| `model-gear/hooks/logic.ts` | Pure functions: reading answers, keyword fallback, labels. |
| `model-gear/hooks/model-gear.test.ts` | Tests for both, using a mock engine. |
| `model-gear/types/index.d.ts` | The plugin's own types and its saved state. |

## License

MIT. See [LICENSE](LICENSE).
