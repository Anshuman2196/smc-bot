const http = require("http");
const { Client, GatewayIntentBits } = require("discord.js");
const c = require("./config");
const ctl = require("./controller");
const agent = require("./agent");

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent]
});

const reply = (message, content) => message.reply({ content, allowedMentions: { repliedUser: false } });
const isControl = member => {
  if (!member) return false;
  if (c.adminIds.includes(member.id)) return true;
  if (c.controlRoleIds.length && member.roles?.cache?.some(role => c.controlRoleIds.includes(role.id))) return true;
  return !c.adminIds.length && !c.controlRoleIds.length;
};
const channelAllowed = id => !c.allowedChannelIds.length || c.allowedChannelIds.includes(id);

async function statusText() {
  const s = await ctl.snapshot();
  const error = s.errors?.[0] ? `\n\n⚠️ ${s.errors[0]}` : "";
  return [
    "**SMC Status**",
    "",
    `Codespace: **${s.codespace}**`,
    `Minecraft: **${s.mc}**`,
    `Playit: **${s.playit}**`,
    `Players: **${s.players ?? "—"}/${s.max ?? "—"}**`,
    `Uptime: **${s.uptimeSec == null ? "—" : `${Math.floor(s.uptimeSec / 60)}m`}**`,
    `Agent: **${agent.alive() ? "connected" : "offline"}**`,
    error,
    "",
    `Address: **${c.host}**`
  ].join("\n");
}

function progressEditor(message) {
  let last = 0;
  return async text => {
    const now = Date.now();
    if (now - last < 900) return;
    last = now;
    await message.edit(`🟡 ${text}`).catch(() => {});
  };
}

client.on("messageCreate", async message => {
  if (message.author.bot || !message.guild) return;
  if (!channelAllowed(message.channelId)) return;

  const parts = message.content.trim().split(/\s+/);
  if (parts[0]?.toLowerCase() !== "smc") return;

  const command = (parts[1] || "help").toLowerCase();

  try {
    if (command === "status") {
      return reply(message, await statusText());
    }

    if (["start", "stop", "restart", "whitelist"].includes(command) && !isControl(message.member)) {
      return reply(message, "⚠️ You don't have permission to control SMC.");
    }

    if (command === "whitelist" && parts[2]?.toLowerCase() === "add") {
      const name = parts[3];
      if (!name) return reply(message, "Usage: `smc whitelist add <username>`");
      const result = await ctl.whitelistAdd(name);
      return reply(message, `✅ Added **${result.added || name}** to the whitelist.`);
    }

    if (command === "start" || command === "stop") {
      const response = await reply(message, command === "start" ? "🟡 Starting SMC…" : "🟡 Stopping SMC…");
      const progress = progressEditor(response);
      if (command === "start") {
        await ctl.startServer(progress);
        return response.edit(`🟢 **SMC online!**\n\n${c.host}`).catch(() => {});
      }
      await ctl.stopServer(progress);
      return response.edit("🔴 **SMC stopped.**").catch(() => {});
    }

    if (command === "restart") {
      const response = await reply(message, "🟡 Restarting SMC…");
      const progress = progressEditor(response);
      await ctl.restartServer(progress);
      return response.edit(`🟢 **SMC online!**\n\n${c.host}`).catch(() => {});
    }

    return reply(message, [
      "**SMC commands**",
      "`smc start` — start the server",
      "`smc stop` — stop the server and Codespace",
      "`smc restart` — restart Minecraft",
      "`smc status` — show live status",
      "`smc whitelist add <username>` — add a player"
    ].join("\n"));
  } catch (error) {
    return reply(message, `⚠️ ${error.message || "SMC operation failed"}`);
  }
});

function readJson(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", chunk => {
      body += chunk;
      if (body.length > 1024 * 1024) req.destroy(new Error("Request too large"));
    });
    req.on("end", () => {
      try { resolve(body ? JSON.parse(body) : {}); }
      catch { reject(new Error("Invalid JSON")); }
    });
    req.on("error", reject);
  });
}

const server = http.createServer(async (req, res) => {
  try {
    if (req.method === "GET" && (req.url === "/" || req.url === "/health")) {
      res.writeHead(200, { "Content-Type": "application/json" });
      return res.end(JSON.stringify({ ok: true, agent: agent.alive(), queue: agent.queueInfo() }));
    }

    if (req.method === "POST" && req.url === "/agent/poll") {
      if (!agent.auth(req)) return res.writeHead(401).end();
      const command = await agent.poll();
      res.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "no-store" });
      return res.end(JSON.stringify(command));
    }

    if (req.method === "POST" && req.url === "/agent/result") {
      if (!agent.auth(req)) return res.writeHead(401).end();
      const payload = await readJson(req);
      const accepted = agent.result(payload);
      res.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "no-store" });
      return res.end(JSON.stringify({ ok: accepted }));
    }

    res.writeHead(404).end();
  } catch (error) {
    res.writeHead(500, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: error.message }));
  }
});

server.listen(c.httpPort, "0.0.0.0", () => console.log(`SMC HTTP listening on ${c.httpPort}`));
client.login(c.discordToken);
