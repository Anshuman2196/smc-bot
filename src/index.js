const http = require("http");
const { Client, GatewayIntentBits } = require("discord.js");
const config = require("./config");
const agent = require("./agent");
const controller = require("./controller");

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent]
});

const allowed = id =>
  !config.allowedChannelIds.length || config.allowedChannelIds.includes(id);

const canAdmin = member =>
  config.adminIds.includes(member.id) ||
  member.roles.cache.some(role => config.adminRoleIds.includes(role.id));

const canControl = member =>
  canAdmin(member) ||
  (!config.adminIds.length && !config.controlRoleIds.length) ||
  member.roles.cache.some(role => config.controlRoleIds.includes(role.id));

const adminState = {
  allowedChannelIds: [...config.allowedChannelIds],
  controlRoleIds: [...config.controlRoleIds],
  adminRoleIds: [...config.adminRoleIds]
};

const adminHelp = () => [
  "**SMC admin controls**",
  "`smc admin` — show current configuration",
  "`smc admin channel add #channel` — allow a channel",
  "`smc admin channel remove #channel` — remove a channel",
  "`smc admin channel list` — list allowed channels",
  "`smc admin role add @role` — add a control role",
  "`smc admin role remove @role` — remove a control role",
  "`smc admin role list` — list control roles",
  "`smc admin adminrole set @role` — set the admin role",
  "`smc admin adminrole clear` — clear the admin role",
  "`smc admin adminrole list` — show the admin role",
  "",
  "Changes apply immediately and last until the bot restarts."
].join("\\n");

async function handleAdmin(message, parts) {
  if (!canAdmin(message.member))
    return message.reply("🔒 **Admin access required.**\\nUse the configured admin role or admin user ID.");

  const target = (parts[2] || "status").toLowerCase();
  const action = (parts[3] || "list").toLowerCase();
  const ref = target === "channel" ? message.mentions.channels.first() : message.mentions.roles.first();

  if (target === "help" || target === "status") {
    return message.reply(adminHelp() + "\\n\\n**Current:**\\n" +
      "Channels: " + (adminState.allowedChannelIds.length ? adminState.allowedChannelIds.map(id => `<#${id}>`).join(", ") : "All channels") + "\\n" +
      "Control roles: " + (adminState.controlRoleIds.length ? adminState.controlRoleIds.map(id => `<@&${id}>`).join(", ") : "Anyone, because none are configured") + "\\n" +
      "Admin roles: " + (adminState.adminRoleIds.length ? adminState.adminRoleIds.map(id => `<@&${id}>`).join(", ") : "None configured"));
  }

  if (target === "channel") {
    if (action === "list") return message.reply("📍 **Allowed channels**\\n" + (adminState.allowedChannelIds.length ? adminState.allowedChannelIds.map(id => `<#${id}>`).join("\\n") : "All channels"));
    if (!ref) return message.reply("⚠️ Mention a channel.");
    if (action === "add") {
      if (!adminState.allowedChannelIds.includes(ref.id)) adminState.allowedChannelIds.push(ref.id);
      return message.reply(`✅ ${ref} is now an allowed SMC channel.`);
    }
    if (action === "remove") {
      adminState.allowedChannelIds.splice(0, adminState.allowedChannelIds.length, ...adminState.allowedChannelIds.filter(id => id !== ref.id));
      return message.reply(`✅ ${ref} was removed from the allowed SMC channels.`);
    }
  }

  if (target === "role") {
    if (action === "list") return message.reply("🎮 **Control roles**\\n" + (adminState.controlRoleIds.length ? adminState.controlRoleIds.map(id => `<@&${id}>`).join("\\n") : "None — control is open to everyone."));
    if (!ref) return message.reply("⚠️ Mention a role.");
    if (action === "add") {
      if (!adminState.controlRoleIds.includes(ref.id)) adminState.controlRoleIds.push(ref.id);
      return message.reply(`✅ ${ref} can now control SMC.`);
    }
    if (action === "remove") {
      adminState.controlRoleIds.splice(0, adminState.controlRoleIds.length, ...adminState.controlRoleIds.filter(id => id !== ref.id));
      return message.reply(`✅ ${ref} can no longer control SMC.`);
    }
  }

  if (target === "adminrole") {
    if (action === "list") return message.reply("👑 **Admin roles**\\n" + (adminState.adminRoleIds.length ? adminState.adminRoleIds.map(id => `<@&${id}>`).join("\\n") : "None configured — use ADMIN_USER_IDS for initial access."));
    if (action === "clear") {
      adminState.adminRoleIds.length = 0;
      return message.reply("✅ Admin role cleared.");
    }
    if (action === "set") {
      if (!ref) return message.reply("⚠️ Mention a role.");
      adminState.adminRoleIds.splice(0, adminState.adminRoleIds.length, ref.id);
      return message.reply(`👑 ${ref} is now the SMC admin role.`);
    }
  }

  return message.reply(adminHelp());
}

const lines = {
  start: ["🚀 Starting the world.", "⚡ Bringing the server online.", "🎮 Your world is waking up."],
  stop: ["🌙 Shutting the world down cleanly.", "🛑 Putting the server to sleep.", "🔒 Closing the server safely."],
  restart: ["🔄 Restarting the world.", "♻️ Giving the server a clean second wind.", "⚡ Fresh start incoming."],
  online: ["🟢 The world is live.", "👥 Here’s who is in the world right now.", "🎮 Current players:"],
  stopped: ["🌙 The world is safely offline.", "🔴 Server stopped cleanly.", "🛌 The world is sleeping."],
  status: ["📡 Here’s the current server pulse.", "🛰️ Live server status:", "👀 Current SMC status:"],
  error: ["⚠️ SMC hit a snag.", "🧩 Something interrupted that request.", "🚧 That action couldn’t be completed."],
  help: ["🎮 SMC command deck:", "⚡ Available server commands:", "🛠️ Your SMC controls:"]
};

const pick = key => lines[key][Math.floor(Math.random() * lines[key].length)];
const uptime = seconds => seconds == null ? "—" : `${Math.floor(seconds / 60)}m ${seconds % 60}s`;

const format = s => {
  const address = s.publicAddress || "Not available yet";
  return [
    "**SMC status**",
    pick("status"),
    `Codespace: **${s.codespace}**`,
    `Agent: **${s.agent}**`,
    `Minecraft: **${s.minecraft}**`,
    `Playit: **${s.playit}**`,
    `Players: **${s.players?.online ?? "—"}/${s.players?.max ?? s.maxPlayers ?? "—"}**`,
    `Uptime: **${uptime(s.uptimeSec)}**`,
    `Address: **${address}**`,
    s.error ? `Error: \`${s.error}\`` : null
  ].filter(Boolean).join("\n");
};

async function progress(message, text) {
  await message.edit(`🟡 **SMC**\n${text}\n\n${pick("status")}`).catch(() => {});
}

async function handle(message, parts) {
  const command = (parts[1] || "help").toLowerCase();

  if (command === "admin")
    return handleAdmin(message, parts);

  if (command === "status")
    return message.reply(format(await controller.liveStatus()));

  if (command === "online")
    return message.reply(controller.formatOnline(await controller.liveStatus()));

  if (command === "whitelist")
    return message.reply(controller.formatWhitelist(await controller.liveStatus()));

  if (command === "help")
    return message.reply([
      "**SMC commands**",
      pick("help"),
      "`smc start` — start Minecraft",
      "`smc stop` — stop Minecraft only when the server is empty",
      "`smc restart` — restart Minecraft",
      "`smc status` — show live server status",
      "`smc online` — show who is online",
      "`smc whitelist` — show who is whitelisted",
      "`smc admin` — manage channels, control roles, and the admin role"
    ].join("\n"));

  if (!canControl(message.member))
    return message.reply(`⚠️ ${pick("error")}\nYou need the configured SMC control role to use this command.`);

  if (!["start", "stop", "restart"].includes(command))
    return message.reply(`⚠️ ${pick("error")}\nUnknown command. Use \`smc help\`.`);

  const out = await message.reply(`🟡 **SMC**\n${pick(command)}\nWorking on it…`);

  try {
    const result =
      command === "start"
        ? await controller.startServer(text => progress(out, text))
        : command === "stop"
          ? await controller.stopServer(text => progress(out, text))
          : await controller.restartServer(text => progress(out, text));

    await out.edit(
      command === "stop"
        ? `🔴 **SMC stopped.**\n${pick("stopped")}`
        : `🟢 **SMC online.**\n${pick("online")}\n\n${format(result)}`
    ).catch(() => {});
  } catch (error) {
    await out.edit(
      `⚠️ **SMC couldn’t complete that.**\n${pick("error")}\n\`${String(error.message || error).replace(/\`/g, "'")}\``
    ).catch(() => {});
  }
}

client.on("messageCreate", async message => {
  if (message.author.bot || !message.guild) return;

  const parts = message.content.trim().split(/\s+/);
  if (parts[0]?.toLowerCase() !== "smc") return;
  const command = (parts[1] || "help").toLowerCase();
  if (command !== "admin" && !allowed(message.channelId)) return;

  try {
    await handle(message, parts);
  } catch (error) {
    await message.reply(`⚠️ ${pick("error")}\n${error.message || "SMC request failed."}`).catch(() => {});
  }
});

const json = (res, status, data) => {
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Cache-Control": "no-store"
  });
  res.end(JSON.stringify(data));
};

const server = http.createServer((req, res) => {
  if (req.method === "GET" && (req.url === "/" || req.url === "/health"))
    return json(res, 200, { ok: true, operation: controller.operation(), agent: agent.info() });

  if (req.method !== "POST" || req.url !== "/agent/sync")
    return json(res, 404, { error: "not_found" });

  if (!agent.authenticated(req))
    return json(res, 401, { error: "unauthorized" });

  let body = "";
  req.on("data", chunk => {
    body += chunk;
    if (body.length > 1048576) req.destroy();
  });

  req.on("end", () => {
    try {
      return json(res, 200, agent.sync(JSON.parse(body || "{}").status));
    } catch (error) {
      return json(res, 400, { error: error.message || "invalid_request" });
    }
  });
});

server.listen(config.httpPort, "0.0.0.0", () =>
  console.log(`SMC control plane listening on ${config.httpPort}`)
);

client.once("ready", () => console.log(`Discord connected as ${client.user.tag}`));
client.login(config.discordToken).catch(error => {
  console.error("Discord login failed:", error);
  process.exit(1);
});
