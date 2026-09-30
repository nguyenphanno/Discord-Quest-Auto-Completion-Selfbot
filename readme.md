# Discord Quest Auto-Completion Selfbot

A selfbot that automatically completes **Discord Quests**, with a typed quest
orchestrator, structured logging and a full console UI.

Based on the original work by [amia](https://gist.github.com/aamiaa/204cd9d42013ded9faf646fae7f89fbb).

This project provides a minimal selfbot framework built on top of discord.js core libraries, demonstrating how selfbot patches can be implemented without modifying the library’s source code directly.

> [!CAUTION]
> As of April 7th 2026, Discord has expressed their intent to crack down on automating quest completion.
> 
> Some users have received the following system message:
> 
> <img width="836" height="272" alt="image" src="https://github.com/user-attachments/assets/3f19670e-e6f4-4425-99d7-7f04d1398787" />
> 
> Use the script at your own risk.

> [!WARNING]
> **I take no responsibility for accounts that get blocked for using this repo.**

> [!CAUTION]
> **Using this on a user account is prohibited by the [Discord TOS](https://discord.com/terms) and can lead to account suspension.**

## ✨ Features

* Automatically **enrolls** and **completes** currently active quests. Supported task types:

  * `WATCH_VIDEO`
  * `WATCH_VIDEO_ON_MOBILE`
  * `PLAY_ON_DESKTOP` / `PLAY_ON_DESKTOP_V2`
  * `PLAY_ON_XBOX` (untested)
  * `PLAY_ON_PLAYSTATION` (untested)
  * `PLAY_ACTIVITY` (untested)
  * `ACHIEVEMENT_IN_ACTIVITY`
  * `ACHIEVEMENT_IN_GAME` (detected, reported as unsupported)
  * `STREAM_ON_DESKTOP` (detected, requires the desktop client)

* ~~Automatically **redeems rewards** for completed quests.~~ Available behind `REDEEM_REWARDS=true`, with automatic hCaptcha handling when a solver is configured.
* Detects the current Discord **client build number** from `discord.com/app` so the request fingerprint never goes stale.
* **Typed domain layer** - quest payloads, tasks, rewards and progress are modelled from the current [quest resources documentation](https://docs.discord.food/resources/quests).
* **Validated configuration** - every problem is reported at once, in one readable block, instead of failing halfway through a run.
* **Webhook reporting** - per-quest completions plus an end-of-run summary, delivered in order and never able to break the run.
* **Graceful failure handling** - retries with backoff on transient HTTP errors, request timeouts on every non-REST call, and a clean shutdown on `SIGINT` / `SIGTERM`.
* **Structured logging** - colourised scopes, aligned columns, a progress bar for long running tasks and optional newline-delimited JSON output for log collectors.

## 🖥️ Console UI

The run starts with the wordmark centred in the terminal, followed by a preflight
block, a live quest board and a final summary table.

```
                                      _ _                       _                             _                 _  __ _           _
                                   __| (_)___  ___ ___  _ __ __| |       __ _ _   _  ___  ___| |_      ___  ___| |/ _| |__   ___ | |_
                                  / _` | / __|/ __/ _ \| '__/ _` |_____ / _` | | | |/ _ \/ __| __|____/ __|/ _ \ | |_| '_ \ / _ \| __|
                                 | (_| | \__ \ (_| (_) | | | (_| |_____| (_| | |_| |  __/\__ \ ||_____\__ \  __/ |  _| |_) | (_) | |_
                                  \__,_|_|___/\___\___/|_|  \__,_|      \__, |\__,_|\___||___/\__|    |___/\___|_|_| |_.__/ \___/ \__|
                                                                            |_|

                                                 Discord Quest Auto-Completion Selfbot
                                        v1.1.0 · node v24.21.0 · win32 x64 · 2026-09-30 06:04:46

                                 ─────────────────────────────────────────────────────────────────────────────────────

── preflight ────────────────────────────────────────────────────────────────
  · Token        MTIzND********3456
  · Session      local
  · Timezone     Asia/Saigon
  · Locale       vi / en-US
  · Concurrency  unlimited
  · Redeem       disabled
  · Webhook      disabled
  · Captcha      manual
  · Build        auto-detect

── quest board ──────────────────────────────────────────────────────────────
  · Account      @example (1234567890)
  · Total        9
  · Pending      6
  · Completed    1
  · Expired      2

06:04:50.118│ INFO    │ quest     │ Enrolling in "Opera GX" using the Desktop profile
06:04:50.121│ INFO    │ quest     │ Spoofing video for "Opera GX" (15m 00s to go)
06:04:50.129│ SUCCESS │ quest     │ Quest "Opera GX" completed
```

Log format:

```
HH:MM:SS.mmm │ LEVEL   │ scope      │ message
```

* the timestamp and separators are grey, body text is a light grey
* levels are colourised (`INFO` cyan, `SUCCESS` green, `WARN` amber, `ERROR` red, `FATAL` inverted red)
* each `scope` (`quest`, `enroll`, `reward`, `captcha`, `http`, `webhook`, …) has a stable colour
* `LOG_ASCII=true` swaps the box-drawing glyphs for pure ASCII, `LOG_JSON=true` emits newline-delimited JSON instead

## 📁 Project structure

```
bot.ts                         entry point (config -> app -> exit code)
src/
├── _app.ts                    run lifecycle: banner, preflight, summary, shutdown
├── core/
│   ├── _client.ts             patched REST + gateway client
│   ├── _config.ts             environment loading and validation
│   └── _constants.ts          protocol fingerprints, endpoints, tuning
├── domain/
│   ├── _quest.ts              Quest entity (status, task, progress, expiry)
│   ├── _quest-manager.ts      enrolment, task workers, reward claiming
│   └── _types.ts              quest payload types
├── providers/
│   └── _yes-captcha.ts        third-party captcha provider
├── services/
│   ├── _build-info.ts         live client build number lookup
│   ├── _captcha.ts            captcha solving facade
│   ├── _discord-says.ts       discordsays.com activity bridge
│   └── _reporter.ts           webhook reporting
├── ui/
│   ├── _banner.ts             centred ASCII wordmark
│   ├── _logger.ts             levelled, scoped logger
│   ├── _progress.ts           panels, tables, progress bars
│   └── _theme.ts              RGB palette and ANSI helpers
└── utils/
    ├── _async.ts              mapLimit, retry, sleep, timeouts
    ├── _headers.ts            desktop/Android request fingerprints
    ├── _http.ts               fetch with timeout + backoff
    └── _time.ts               duration and timestamp formatting
```

## 📦 Installation & Setup (Local)

> [!NOTE]
> **Node.js 24.0.0 or newer is required**

### 1. Install dependencies

```sh
npm install
```

### 2. Insert your token

Copy `.env.example` to `.env` and fill in `TOKEN`.

### 3. Start the bot

```sh
npm run start
```

A missing or malformed token does not crash the process: the run stops with a
readable `CANNOT START` panel that lists every problem at once.

## ⚙️ Configuration

Everything is optional except `TOKEN`. See `.env.example` for the commented template.

| Variable | Default | Purpose |
| --- | --- | --- |
| `TOKEN` | – | **Required.** Raw user token. Never add the `Bot ` prefix. |
| `WEBHOOK_URL` | – | Discord webhook used for completion reports and the run summary. |
| `YES_CAPTCHA_API_KEY` | – | Enables automatic hCaptcha solving when claiming a reward. |
| `REDEEM_REWARDS` | `false` | Also claim rewards for quests that are already completed. |
| `QUEST_CONCURRENCY` | `0` | Max concurrent quest workers; `0` keeps the unbounded fan-out. |
| `QUEST_INCLUDE` | – | Process only these quest ids (space/comma separated). |
| `QUEST_EXCLUDE` | – | Skip these quest ids. |
| `FETCH_EXCLUDED_QUESTS` | `false` | Also resolve quests the account cannot participate in. |
| `CLIENT_BUILD_NUMBER` | auto | Pin the fingerprint build number instead of scraping it. |
| `DISCORD_TIMEZONE` | `Asia/Saigon` | `x-discord-timezone` request header. |
| `DISCORD_LOCALE` | `en-US` | `x-discord-locale` request header. |
| `DISCORD_ACCEPT_LANGUAGE` | `vi` | `accept-language` request header. |
| `LOG_LEVEL` | `info` | `trace`, `debug`, `info`, `success`, `warn`, `error`, `fatal`, `silent`. |
| `LOG_JSON` | `false` | Emit newline-delimited JSON records instead of decorated text. |
| `LOG_ASCII` | `false` | Use ASCII-only glyphs for legacy consoles. |
| `LOG_COLOR` | auto | Force colour on/off. `NO_COLOR` and `FORCE_COLOR` are honoured. |
| `LOG_TIMESTAMPS` | `true` | Prefix every record with `HH:MM:SS.mmm`. |
| `HTTP_TIMEOUT_MS` | `20000` | Timeout for the non-REST calls (assets, activity proxy, captcha). |
| `HTTP_RETRIES` | `2` | Retry attempts for transient HTTP failures. |
| `HTTP_RETRY_DELAY_MS` | `700` | Base delay for the retry backoff. |

## 🎯 Supported task types

| Task | Flow | Status |
| --- | --- | --- |
| `WATCH_VIDEO` | `POST /quests/{id}/video-progress` with paced timestamps | ✅ |
| `WATCH_VIDEO_ON_MOBILE` | Same, enrolled with the Android fingerprint | ✅ |
| `PLAY_ON_DESKTOP` / `PLAY_ON_DESKTOP_V2` | `POST /quests/{id}/heartbeat` | ✅ |
| `PLAY_ON_XBOX` / `PLAY_ON_PLAYSTATION` | Heartbeat carrying the application id | ⚠️ untested |
| `PLAY_ACTIVITY` | Heartbeat carrying a `stream_key` | ⚠️ untested |
| `ACHIEVEMENT_IN_ACTIVITY` | OAuth authorize → `discordsays.com` proxy → deauthorize | ✅ |
| `ACHIEVEMENT_IN_GAME` | Requires real in-game progress | ❌ reported as unsupported |
| `STREAM_ON_DESKTOP` | Requires the desktop voice client | ❌ reported as unsupported |

Unsupported tasks are detected, reported in the summary table and skipped - they
never abort the run.

## 📤 Example Output

Illustrative run (colour stripped for readability):

```sh
── quest board ──────────────────────────────────────────────────────────────
  · Account      @example (1234567890)
  · Total        9
  · Pending      6
  · Completed    1
  · Expired      2

06:04:50.110│ INFO    │ quest     │ Found 6 valid quest(s) to process with unbounded concurrency.
06:04:50.118│ INFO    │ quest     │  1/6  Opera GX  WATCH_VIDEO
06:04:50.119│ INFO    │ quest     │ Enrolling in "Opera GX" using the Desktop profile
06:04:50.201│ INFO    │ quest     │ Spoofing video for "Opera GX" (15m 00s to go)
06:04:50.205│ INFO    │ quest     │  2/6  Amazon  PLAY_ON_DESKTOP
06:04:50.280│ INFO    │ quest     │ Spoofed your game to Amazon. Wait for 15 minute(s) more.  ░░░░░░░░░░░░░░░░░░░░░░░░    0%
06:04:57.300│ INFO    │ quest     │ Watching "Opera GX"  ███░░░░░░░░░░░░░░░░░░░░░   12%  1m 48s of 15m 00s
06:05:10.410│ INFO    │ quest     │ Spoofed your game to Amazon. Wait for 14 minute(s) more.  █░░░░░░░░░░░░░░░░░░░░░░░    5%
...
06:19:35.980│ SUCCESS │ quest     │ Quest "Opera GX" completed
06:19:36.010│ SUCCESS │ quest     │ Quest "Amazon" completed

── run summary ──────────────────────────────────────────────────────────────
  ┌────────────────────┬─────────────────────────┬────────────┬──────────────┐
  │ Quest              │ Task                    │     Status │       Detail │
  ├────────────────────┼─────────────────────────┼────────────┼──────────────┤
  │ Opera GX           │ WATCH_VIDEO             │  completed │ task finished │
  │ Amazon             │ PLAY_ON_DESKTOP         │  completed │ task finished │
  │ Where Winds Meet   │ ACHIEVEMENT_IN_ACTIVITY │  completed │ task finished │
  │ Streamelements     │ STREAM_ON_DESKTOP       │    skipped │  unsupported │
  └────────────────────┴─────────────────────────┴────────────┴──────────────┘

  ████████████████░░░░░░░░   75%  quests completed

┌─ RESULT ────────────────┐
│ Processed          4    │
│ Completed          3    │
│ Already done       0    │
│ Skipped            1    │
│ Failed             0    │
│ Duration           14m 46s │
│ Warnings           0    │
│ Errors             0    │
└─────────────────────────┘
```

## 🧪 Development

| Script | What it does |
| --- | --- |
| `npm start` | Runs the bot, loading `.env` when it exists. |
| `npm run dev` | Same, with `--inspect-brk` for a debugger. |
| `npm run github` | Runs without loading `.env` (CI / secrets come from the environment). |
| `npm run typecheck` | `tsc --noEmit` against the strict project config. |

Every module keeps its `process.env` access inside `src/core/_config.ts`, so the
rest of the code base can be exercised with an explicit config object.

## 🙏 Credits

* [Complete Recent Discord Quest](https://gist.github.com/aamiaa/204cd9d42013ded9faf646fae7f89fbb/4912415839790240d49c1d2553e940f0c65f95d5)
* [Equicord's Questify plugin](https://equicord.org/plugins/Questify)
* [discord.js](https://github.com/discordjs/discord.js)
* [The idea of using GitHub Actions as a server to run the selfbot is from manishbhaiii](https://github.com/manishbhaiii/Discord-Quest-Auto-Completion-Selfbot)
* [Quest resources reference (discord-userdoccers)](https://docs.discord.food/resources/quests)

*README compiled with assistance from AI.*