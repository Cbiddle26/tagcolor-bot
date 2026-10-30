// DayZ clan tag colour bot
// Discord slash command  <->  request queue  <->  DayZ wrapper mod
//
// The DayZ server cannot accept inbound connections, so it POLLS this
// service for pending work and POSTs the result back. Nothing here ever
// reaches into the game server.

import express from "express";
import {
  Client,
  GatewayIntentBits,
  REST,
  Routes,
  SlashCommandBuilder,
  PermissionFlagsBits,
  EmbedBuilder,
} from "discord.js";

const TOKEN = process.env.DISCORD_TOKEN;
const APP_ID = process.env.DISCORD_APP_ID;
const GUILD_ID = process.env.DISCORD_GUILD_ID || null; // optional: instant command registration
const ADMIN_ROLE_ID = process.env.ADMIN_ROLE_ID || null; // optional: gate the command
const BRIDGE_SECRET = process.env.BRIDGE_SECRET || "change-me";

// Shared secret the wrapper mod sends. Stops randoms POSTing fake results.
if (!TOKEN || !APP_ID) {
  console.error("DISCORD_TOKEN and DISCORD_APP_ID must be set.");
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Colour palette. Twelve readable colours for chat text.
// A free-RGB option is available behind FREE_RGB=1 for staff only.
// ---------------------------------------------------------------------------
const PALETTE = [
  { name: "White",       value: "255,255,255" },
  { name: "Red",         value: "230,60,60" },
  { name: "Orange",      value: "240,140,40" },
  { name: "Yellow",      value: "240,220,60" },
  { name: "Green",       value: "80,200,90" },
  { name: "Teal",        value: "60,200,190" },
  { name: "Cyan",        value: "90,190,255" },
  { name: "Blue",        value: "60,110,240" },
  { name: "Purple",      value: "160,90,230" },
  { name: "Pink",        value: "240,110,190" },
  { name: "Gold",        value: "210,170,60" },
  { name: "Grey",        value: "170,170,170" },
];

const FREE_RGB = process.env.FREE_RGB === "1";

// ---------------------------------------------------------------------------
// Queue. Requests live here until the DayZ server collects them.
// Keyed by requestId so an id is never served twice.
// ---------------------------------------------------------------------------
const pending = new Map(); // requestId -> request
const results = new Map(); // requestId -> result
const knownGroups = new Set(); // shortnames, filled in by the wrapper mod

const REQUEST_TTL_MS = 5 * 60 * 1000;

function sweep() {
  const now = Date.now();
  for (const [id, req] of pending) {
    if (now - req.createdAt > REQUEST_TTL_MS) pending.delete(id);
  }
  for (const [id, res] of results) {
    if (now - res.at > REQUEST_TTL_MS) results.delete(id);
  }
}
setInterval(sweep, 60_000).unref();

function newId() {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}

// ---------------------------------------------------------------------------
// HTTP endpoints the DayZ wrapper mod talks to
// ---------------------------------------------------------------------------
const app = express();
app.use(express.json({ limit: "32kb" }));

// The wrapper polls this. It hands over its group list and takes back any
// pending colour change in one round trip.
app.post("/poll", (req, res) => {
  if (req.get("x-bridge-secret") !== BRIDGE_SECRET) {
    return res.status(401).json({ ok: false, error: "bad secret" });
  }

  // Wrapper reports which groups exist so the Discord picker stays current.
  const groups = req.body?.groups;
  if (Array.isArray(groups)) {
    knownGroups.clear();
    for (const g of groups) {
      if (typeof g === "string" && g.trim()) knownGroups.add(g.trim());
    }
  }

  // Hand back exactly one request, then remove it so it is never repeated.
  let job = null;
  for (const [id, r] of pending) {
    job = r;
    pending.delete(id);
    break;
  }

  res.json({ ok: true, job });
});

// The wrapper reports the outcome of a job it applied.
app.post("/result", (req, res) => {
  if (req.get("x-bridge-secret") !== BRIDGE_SECRET) {
    return res.status(401).json({ ok: false, error: "bad secret" });
  }

  const { requestId, ok, error } = req.body ?? {};
  if (!requestId) return res.status(400).json({ ok: false, error: "no requestId" });

  results.set(requestId, { ok: !!ok, error: error || null, at: Date.now() });
  res.json({ ok: true });
});

// Simple health check so you can confirm the deploy works in a browser.
app.get("/", (_req, res) => {
  res.json({
    ok: true,
    service: "tagcolor-bot",
    queued: pending.size,
    groups: [...knownGroups],
  });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Listening on ${PORT}`));

// ---------------------------------------------------------------------------
// Discord side
// ---------------------------------------------------------------------------
const client = new Client({ intents: [GatewayIntentBits.Guilds] });

const command = new SlashCommandBuilder()
  .setName("tagcolor")
  .setDescription("Change a clan's chat tag colour")
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles)
  .addStringOption((o) =>
    o.setName("group").setDescription("Clan shortname").setRequired(true).setAutocomplete(true)
  )
  .addStringOption((o) =>
    o.setName("color").setDescription("Colour to apply").setRequired(true).addChoices(
      ...PALETTE.map((c) => ({ name: c.name, value: c.value }))
    )
  );

if (FREE_RGB) {
  command.addStringOption((o) =>
    o.setName("rgb").setDescription("Staff: R,G,B e.g. 90,170,255 (overrides colour)").setRequired(false)
  );
}

client.once("clientReady", () => console.log(`Logged in as ${client.user.tag}`));

client.on("interactionCreate", async (interaction) => {
  if (interaction.isAutocomplete()) {
    const focused = interaction.options.getFocused().toLowerCase();
    const list = [...knownGroups]
      .filter((g) => g.toLowerCase().includes(focused))
      .slice(0, 25)
      .map((g) => ({ name: g, value: g }));
    return interaction.respond(list);
  }

  if (!interaction.isChatInputCommand() || interaction.commandName !== "tagcolor") return;

  if (ADMIN_ROLE_ID && !interaction.member.roles.cache.has(ADMIN_ROLE_ID)) {
    return interaction.reply({ content: "You do not have permission to do that.", ephemeral: true });
  }

  const group = interaction.options.getString("group").trim().toUpperCase();
  const chosen = interaction.options.getString("color");
  const freeRgb = interaction.options.getString("rgb");

  let r, g, b;
  if (freeRgb) {
    const parts = freeRgb.split(",").map((n) => Number(n.trim()));
    if (parts.length !== 3 || parts.some((n) => !Number.isFinite(n) || n < 0 || n > 255)) {
      return interaction.reply({ content: "RGB must be three numbers 0-255, e.g. `90,170,255`.", ephemeral: true });
    }
    [r, g, b] = parts;
    // Guard against unreadable tags in chat.
    if (r < 30 && g < 30 && b < 30) {
      return interaction.reply({ content: "That colour is too dark to read in chat. Pick something lighter.", ephemeral: true });
    }
  } else {
    [r, g, b] = chosen.split(",").map(Number);
  }

  if (!knownGroups.has(group)) {
    return interaction.reply({
      content: `No group called \`${group}\` is currently known. The list refreshes when the DayZ server polls.`,
      ephemeral: true,
    });
  }

  const requestId = newId();
  pending.set(requestId, { requestId, group, r, g, b, byPlayer: false, createdAt: Date.now() });

  await interaction.reply({
    content: `Queued **${group}** → RGB \`${r},${g},${b}\`. Waiting for the server...`,
    ephemeral: true,
  });

  // Wait for the wrapper to report back, then update the reply.
  const deadline = Date.now() + 25_000;
  while (Date.now() < deadline) {
    const result = results.get(requestId);
    if (result) {
      results.delete(requestId);
      const colour = `\`${r},${g},${b}\``;
      if (result.ok) {
        await interaction.editReply({
          content: `Done. **${group}** tag colour set to ${colour}.`,
        });
      } else {
        await interaction.editReply({
          content: `The server rejected that: ${result.error ?? "unknown error"}`,
        });
      }
      return;
    }
    await new Promise((res) => setTimeout(res, 1000));
  }

  await interaction.editReply({
    content: `No response from the server within 25s. The request may still apply — check the server log before retrying.`,
  });
});

// Register the command on boot.
(async () => {
  const rest = new REST({ version: "10" }).setToken(TOKEN);
  const body = [command.toJSON()];
  try {
    if (GUILD_ID) {
      await rest.put(Routes.applicationGuildCommands(APP_ID, GUILD_ID), { body });
      console.log(`Registered /tagcolor in guild ${GUILD_ID}`);
    } else {
      await rest.put(Routes.applicationCommands(APP_ID), { body });
      console.log("Registered /tagcolor globally (may take up to an hour to appear)");
    }
  } catch (err) {
    console.error("Command registration failed:", err);
  }
  await client.login(TOKEN);
})();
