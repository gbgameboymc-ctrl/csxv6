// Discord -> Roblox relay bot.
// Roblox servers can't receive inbound requests and can't call discord.com,
// so the bot keeps a queue of commands and the Roblox server polls /poll.
//
// Env vars: DISCORD_TOKEN, API_KEY (shared secret), PORT (optional),
//           CHANNEL_ID (optional: only listen in this channel)

const { Client, GatewayIntentBits } = require("discord.js");
const express = require("express");

const TOKEN = process.env.DISCORD_TOKEN;
const API_KEY = process.env.API_KEY;
const PORT = process.env.PORT || 3000;
const CHANNEL_ID = process.env.CHANNEL_ID || null;
const PREFIX = "!";
const USER_COOLDOWN_MS = 800;
const MAX_QUEUE = 50;
const MIN_DURATION = 0.1; // seconds
const MAX_DURATION = 10;  // seconds
const MODE_COOLDOWN_MS = (parseFloat(process.env.MODE_COOLDOWN_SECONDS) || 30) * 1000; // global, whole server

if (!TOKEN || !API_KEY) {
  console.error("Set DISCORD_TOKEN and API_KEY environment variables.");
  process.exit(1);
}

// alias -> action understood by the Roblox script
const ACTIONS = {
  w: "forward", forward: "forward", up: "forward",
  s: "back", back: "back", down: "back",
  a: "left", left: "left",
  d: "right", right: "right",
  jump: "jump", j: "jump", space: "jump",
  stop: "stop",
};

let queue = [];
const lastUse = new Map();
let lastModeChange = 0;

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent, // enable in the Developer Portal too
  ],
});

client.on("ready", () => console.log(`Logged in as ${client.user.tag}`));

client.on("messageCreate", async (msg) => {
  if (msg.author.bot) return;
  if (CHANNEL_ID && msg.channelId !== CHANNEL_ID) return;
  if (!msg.content.startsWith(PREFIX)) return;

  // "!w 3" -> word = "w", duration = 3 seconds (optional, decimals allowed)
  const [word, arg] = msg.content.slice(PREFIX.length).trim().split(/\s+/);
  const cmdWord = (word || "").toLowerCase();

  // "!mode [global|relative]" switches how movement directions work.
  // No argument = toggle. Has a server-wide cooldown.
  if (cmdWord === "mode") {
    const t = Date.now();
    if (t - (lastUse.get(msg.author.id) || 0) < USER_COOLDOWN_MS) return;

    let mode = "toggle";
    if (arg !== undefined) {
      const a = arg.toLowerCase();
      if (["global", "world"].includes(a)) mode = "global";
      else if (["relative", "root", "local", "rotation"].includes(a)) mode = "relative";
      else {
        msg.reply("Usage: `!mode global`, `!mode relative`, or just `!mode` to toggle.").catch(() => {});
        return;
      }
    }

    const remaining = MODE_COOLDOWN_MS - (t - lastModeChange);
    if (remaining > 0) {
      msg.reply(`⏳ Movement mode can be changed again in ${Math.ceil(remaining / 1000)}s.`).catch(() => {});
      return;
    }

    lastModeChange = t;
    lastUse.set(msg.author.id, t);
    queue.push({ user: msg.member?.displayName || msg.author.username, action: "mode", mode });
    msg.react("✅").catch(() => {});
    return;
  }

  const action = ACTIONS[cmdWord];
  if (!action) return;

  let duration = null; // null = Roblox uses its default
  if (arg !== undefined) {
    const n = parseFloat(arg);
    if (Number.isFinite(n) && n > 0) {
      duration = Math.min(Math.max(n, MIN_DURATION), MAX_DURATION);
    }
  }

  const now = Date.now();
  if (now - (lastUse.get(msg.author.id) || 0) < USER_COOLDOWN_MS) return;
  lastUse.set(msg.author.id, now);

  if (queue.length >= MAX_QUEUE) return;
  queue.push({ user: msg.member?.displayName || msg.author.username, action, duration });
  msg.react("✅").catch(() => {});
});

const app = express();

app.get("/poll", (req, res) => {
  if (req.get("x-api-key") !== API_KEY) return res.status(401).json({ error: "bad key" });
  const commands = queue;
  queue = [];
  res.json({ commands });
});

app.get("/", (_req, res) => res.send("Discord obby relay is running."));

app.listen(PORT, () => console.log(`Relay listening on :${PORT}`));
client.login(TOKEN);
