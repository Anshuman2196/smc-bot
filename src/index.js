const http = require("http");
const { Client, GatewayIntentBits } = require("discord.js");
const config = require("./config");
const agent = require("./agent");
const controller = require("./controller");

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent]
});

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const allowedChannel = id => config.allowedChannelIds.length === 0 || config.allowedChannelIds.includes(id);
const canControl = member => {
  if (!config.adminIds.length && !config.controlRoleIds.length) return true;
  if (config.adminIds.includes(member.id)) return true;
  return member.roles.cache.some(role => config.controlRoleIds.includes(role.id));
};

function statusMessage(status) {
  const uptime = status.uptimeSec == null ? "—" : `${Math.floor(status.uptimeSec / 60)}m ${status.uptimeSec % 60}s`;
  return [
    "**SMC status**",
    `Codespace: **${status.codespace}**`,
    `Agent: **${status.agent}**`,
    `Minecraft: **${status.minecraft}**`,
    `Playit: **${status.playit}**`,
    `Players: **${status.players ?? "—"}/${status.maxPlayers ?? "—"}**`,
    `Uptime: **${uptime}**`,
    status.error ? `Error: \`${status.error}\`` : null,
    `Address: **${config.host}:${config.port}**`
  ].filter(Boolean).join("\n");
}

function progressReporter(message) {
  let last = 0;
  let pending = null;
  let timer = null;

  const flush = async () => {
    timer = null;
    if (!pending) return;
    const text = pending;
    pending = null;
    last = Date.now();
    await message.edit(`🟡 **SMC**\n${text}`).catch(() => {});
  };

  return text => {
    pending = String(text);
    if (timer) return;
    timer = setTimeout(flush, Math.max(0, 1500 - (Date.now() - last)));
  };
}

async function notify(text) {
  if (!config.notifyChannelId) return;
  const channel = await client.channels.fetch(config.notifyChannelId).catch(() => null);
  if (channel?.isTextBased()) await channel.send(text).catch(() => {});
}

async function handleCommand(message, parts) {
  const command = (parts[1] || "help").toLowerCase();

  if (command === "status") {
    return message.reply(statusMessage(await controller.liveStatus()));
  }

  if (command === "help") {
    return message.reply([
      "**SMC commands**",
      "`smc start` — start the Minecraft server",
      "`smc stop` — stop Minecraft and the Codespace",
      "`smc restart` — restart Minecraft",
      "`smc status` — show live state",
      "`smc whitelist add <username>` — add a player"
    ].join("\n"));
  }

  if (!canControl(message.member)) return message.reply("⚠️ You do not have permission to control SMC.");

  if (command === "whitelist" && parts[2]?.toLowerCase() === "add") {
    if (!parts[3]) return message.reply("Usage: `smc whitelist add <username>`");
    const result = controller.whitelistAdd(parts[3]);
    return message.reply(`🟡 Whitelist request queued for **${result.name}**.`);
  }

  if (!["start", "stop", "restart"].includes(command)) {
    return message.reply("Unknown command. Use `smc help`.");
  }

  const progress = await message.reply(command === "start" ? "🟡 Starting SMC…" : command === "stop" ? "🟡 Stopping SMC…" : "🟡 Restarting SMC…");
  const report = progressReporter(progress);

  try {
    const result = command === "start"
      ? await controller.startServer(report)
      : command === "stop"
        ? await controller.stopServer(report)
        : await controller.restartServer(report);

    if (command === "stop") {
      await progress.edit("🔴 **SMC stopped.**").catch(() => {});
      await notify("🔴 SMC stopped.");
    } else {
      await progress.edit(`🟢 **SMC online.**\n${statusMessage(result)}`).catch(() => {});
      await notify(`🟢 SMC online — ${config.host}:${config.port}`);
    }
  } catch (error) {
    await progress.edit(`⚠️ **SMC operation failed**\n\`${String(error.message || error).replace(/`/g, "'")}\``).catch(() => {});
  }
}

client.on("messageCreate", async message => {
  if (message.author.bot || !message.guild || !allowedChannel(message.channelId)) return;
  const parts = message.content.trim().split(/\s+/);
  if (parts[0]?.toLowerCase() !== "smc") return;
  try {
    await handleCommand(message, parts);
  } catch (error) {
    await message.reply(`⚠️ ${error.message || "SMC request failed."}`).catch(() => {});
  }
});

function json(response, status, payload) {
  response.writeHead(status, { "Content-Type": "application/json", "Cache-Control": "no-store" });
  response.end(JSON.stringify(payload));
}

const server = http.createServer((request, response) => {
  if (request.method === "GET" && (request.url === "/" || request.url === "/health")) {
    return json(response, 200, { ok: true, operation: controller.operation(), agent: agent.info() });
  }

  if (request.method !== "POST" || request.url !== "/agent/sync") {
    return json(response, 404, { error: "not_found" });
  }

  if (!agent.authenticated(request)) return json(response, 401, { error: "unauthorized" });

  let body = "";
  request.on("data", chunk => {
    body += chunk;
    if (body.length > 1024 * 1024) request.destroy();
  });
  request.on("end", () => {
    try {
      const input = JSON.parse(body || "{}");
      return json(response, 200, agent.sync(input.status));
    } catch (error) {
      return json(response, 400, { error: "invalid_request" });
    }
  });
});

server.listen(config.httpPort, "0.0.0.0", () => {
  console.log(`SMC control plane listening on ${config.httpPort}`);
});

client.once("ready", () => {
  console.log(`Discord connected as ${client.user.tag}`);
});

client.login(config.discordToken).catch(error => {
  console.error("Discord login failed:", error);
  process.exit(1);
});

process.on("SIGTERM", () => server.close(() => process.exit(0)));
process.on("SIGINT", () => server.close(() => process.exit(0)));

void sleep;
