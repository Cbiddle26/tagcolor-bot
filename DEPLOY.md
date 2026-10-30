# Deploy guide — DayZ clan tag colour bot

Four parts: the Discord app, the bot service on Render, the wrapper mod on your
server, and the end-to-end test.

---

## 1. Discord application

1. Go to the [Discord Developer Portal](https://discord.com/developers/applications)
   and click **New Application**. Name it something like `Tag Colour Bot`.
2. Left sidebar → **Bot** → **Reset Token** → copy it. That's `DISCORD_TOKEN`.
   Keep it somewhere safe and never commit it.
3. Left sidebar → **General Information** → copy the **Application ID**. That's
   `DISCORD_APP_ID`.
4. Left sidebar → **Installation** → under **Install Link** choose
   **Discord Provided Link**.
5. Under **Default Install Settings**, add the scope `applications.commands`.
   You don't need `bot` scope — this bot only posts slash command replies.
6. Copy the install link and open it, then add the app to your server.

If you want the slash command to register instantly, copy your server's ID
(right-click the server icon → Copy Server ID, with Developer Mode on) and use
it as `DISCORD_GUILD_ID`. Without it, the command registers globally and can
take up to an hour to appear.

---

## 2. The bot service on Render

You're creating a **Web Service** from a **Public Git Repository**.

### Put the code on GitHub

1. Create a public repo. Name it `tagcolor-bot`. Tick **Add a README file** so
   the repo has a first commit.
2. Upload these four files from `tagcolor-bot/` to the repo root:
   - `index.js`
   - `package.json`
   - `Dockerfile`
   - `DEPLOY.md` (this file, optional)
3. Copy the repo URL, e.g. `https://github.com/yourname/tagcolor-bot`.

### Create the Render service

1. Render dashboard → **New** → **Web Service**.
2. Choose the **Public Git Repository** tab and paste the repo URL.
3. Render detects the `Dockerfile` and builds from it.
4. Set the environment variables below in the **Environment** section.
5. Deploy.

### Environment variables

| Name | Value | Required |
|---|---|---|
| `DISCORD_TOKEN` | your bot token | yes |
| `DISCORD_APP_ID` | your application ID | yes |
| `BRIDGE_SECRET` | a long random string | yes |
| `DISCORD_GUILD_ID` | your server ID | optional |
| `ADMIN_ROLE_ID` | a role ID to gate the command | optional |
| `FREE_RGB` | `1` to allow staff free colours | optional |

Generate a secret with something like 40 random characters. It has to match
`BridgeSecret` in the mod's settings.

### Confirm the deploy

Open your Render URL in a browser. You should get:

```json
{ "ok": true, "service": "tagcolor-bot", "queued": 0, "groups": [] }
```

If that appears, the service is live. Note the URL — you need it for the mod.

**Free-tier note:** Render's free web services spin down after inactivity and
wake on the next request. The first poll after a sleep may be slow; the mod
simply retries on the next cycle.

---

## 3. The wrapper mod on your server

### Build the PBO

1. Take `tagcolor-mod/source/TagColorBridge/` and pack it into a PBO with Addon
   Builder or PBO Manager. The folder already has `config.cpp`, `$PBOPREFIX$`
   and the scripts.
2. Sign it with your server key, same as your other mods.
3. Lay the mod folder out like this:

```
@TagColorBridge/
  mod.cpp
  addons/
    TagColorBridge.pbo
    TagColorBridge.bisign
  keys/
    TagColorBridge.bikey
```

### Install

1. Copy `@TagColorBridge` to your server root.
2. Copy `TagColorBridge.bikey` into the server's `keys` folder.
3. Add `@TagColorBridge` to the end of your `-mod=` list — the docs warn it must
   load after LB, since it calls into LB's group manager.
4. Start the server once. It writes:

```
profiles\TagColorBridge\Settings.json
```

5. Edit that file, then restart:

```json
{
  "Enabled": 1,
  "BotUrl": "https://your-app.onrender.com",
  "BridgeSecret": "the-same-secret-as-BRIDGE_SECRET",
  "PollIntervalSeconds": 3.0,
  "MaxRequestsPerPoll": 5,
  "LogLevel": 2
}
```

No trailing slash on `BotUrl`.

---

## 4. Test it

1. **Check the mod loaded.** After boot, open
   `profiles\TagColorBridge\TagColorBridge.log`. You should see `initialised,
   polling https://...`. If the file doesn't exist, the mod isn't running —
   check that it's in your `-mod=` list and the PBO is signed.
2. **Check the service sees the server.** Reload your Render URL. `groups`
   should now list your clan shortnames — proof the poll is reaching through.
3. **Run `/tagcolor` in Discord.** Pick a group from the autocomplete, pick a
   colour. The reply should update to "Done" within a few seconds.
4. **Check in game.** The tag colour changes live, no relog.
5. **Check the server log** for `applied BIDD -> r,g,b`.

---

## When something doesn't work

| Symptom | Where to look |
|---|---|
| `/tagcolor` doesn't appear in Discord | command registration failed — check Render logs; set `DISCORD_GUILD_ID` for instant registration |
| "No group called X is currently known" | the server hasn't polled yet, or the shortname doesn't match a filename in `LBGroup\Groups\` |
| "No response from the server within 25s" | Render service asleep or crashed; check the URL in a browser |
| Colour applies but tag looks unchanged | `showTagInChat` is off for that group, or Chatconfig forces tags off |
| Nothing applies, no log line | mod not loaded or PBO unsigned |
| Polls fail with an HTTP code | check the Render log; `LogLevel: 3` logs every poll |

---

## Security

- The bot token lives only in Render's environment variables. Never commit it.
  If it ever leaks, reset it in the Developer Portal immediately.
- `BRIDGE_SECRET` is the only thing stopping someone who finds your URL from
  posting fake results. Use a long random value.
- Only one bot token can exist per Discord application. If you run more than one
  DayZ server, either give each its own Render service or add a per-instance
  path later — the code is a single-instance bridge as written.
