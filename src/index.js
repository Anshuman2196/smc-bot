const http = require("http");
const { Client, GatewayIntentBits } = require("discord.js");
const config = require("./config");
const agent = require("./agent");
const controller = require("./controller");

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent]
});

const allowed = id =>
  !adminState.allowedChannelIds.length || adminState.allowedChannelIds.includes(id);

let locked = false;
const audit = [];
const record = (message, action, result = "ok") => { audit.unshift({ at: new Date().toISOString(), user: message.author.tag, action, result }); if (audit.length > 100) audit.pop(); };

const canAdmin = member =>
  config.adminIds.includes(member.id) ||
  member.roles.cache.some(role => adminState.adminRoleIds.includes(role.id));

const canControl = member =>
  canAdmin(member) ||
  (!config.adminIds.length && !adminState.controlRoleIds.length) ||
  member.roles.cache.some(role => adminState.controlRoleIds.includes(role.id));

const adminState = {
  allowedChannelIds: [...config.allowedChannelIds],
  controlRoleIds: [...config.controlRoleIds],
  adminRoleIds: [...config.adminRoleIds]
};

const adminHelp = () => [
  "**SMC • Admin**",
  "",
  "`smc admin` — current configuration",
  "`smc admin channel add/remove/list` — channel access",
  "`smc admin role add/remove/list` — control roles",
  "`smc admin adminrole set/clear/list` — admin role",
  "`smc admin lock/unlock` — lock controls",
  "`smc admin audit` — recent actions"
].join("\n");

async function handleAdmin(message, parts) {
  if (!canAdmin(message.member))
    return message.reply("╭━━━ 🔒 **ACCESS DENIED** ━━━╮\nYou need the configured SMC admin role or admin user ID.\n╰━━━━━━━━━━━━━━━━━━━━━━╯");

  const target = (parts[2] || "status").toLowerCase();
  const action = (parts[3] || "list").toLowerCase();
  const ref = target === "channel" ? message.mentions.channels.first() : message.mentions.roles.first();

  if (target === "help" || target === "status") {
    return message.reply(adminHelp() + "\n\n**Current:**\n" +
      "Channels: " + (adminState.allowedChannelIds.length ? adminState.allowedChannelIds.map(id => `<#${id}>`).join(", ") : "All channels") + "\n" +
      "Control roles: " + (adminState.controlRoleIds.length ? adminState.controlRoleIds.map(id => `<@&${id}>`).join(", ") : "Anyone, because none are configured") + "\n" +
      "Admin roles: " + (adminState.adminRoleIds.length ? adminState.adminRoleIds.map(id => `<@&${id}>`).join(", ") : "None configured"));
  }

  if (target === "lock") { locked = true; return message.reply("🔒 **SMC controls locked.**"); }
  if (target === "unlock") { locked = false; return message.reply("🔓 **SMC controls unlocked.**"); }
  if (target === "audit") { return message.reply("🧾 **Recent SMC audit**\n" + (audit.length ? audit.slice(0, 20).map(x => `• ${x.at} — ${x.user} — ${x.action} — ${x.result}`).join("\n") : "No actions recorded.")); }

  if (target === "channel") {
    if (action === "list") return message.reply("📍 **Allowed channels**\n" + (adminState.allowedChannelIds.length ? adminState.allowedChannelIds.map(id => `<#${id}>`).join("\n") : "All channels"));
    if (!ref) return message.reply("⚠️ **Channel required.**\nMention the Discord channel you want to use.");
    if (action === "add") {
      if (!adminState.allowedChannelIds.includes(ref.id)) adminState.allowedChannelIds.push(ref.id);
      return message.reply(`✅ **Channel added**\n${ref} can now receive SMC commands.`);
    }
    if (action === "remove") {
      adminState.allowedChannelIds.splice(0, adminState.allowedChannelIds.length, ...adminState.allowedChannelIds.filter(id => id !== ref.id));
      return message.reply(`✅ **Channel removed**\n${ref} can no longer receive SMC commands.`);
    }
  }

  if (target === "role") {
    if (action === "list") return message.reply("🎮 **Control roles**\n" + (adminState.controlRoleIds.length ? adminState.controlRoleIds.map(id => `<@&${id}>`).join("\n") : "None — control is open to everyone."));
    if (!ref) return message.reply("⚠️ Mention a role.");
    if (action === "add") {
      if (!adminState.controlRoleIds.includes(ref.id)) adminState.controlRoleIds.push(ref.id);
      return message.reply(`✅ **Control role added**\n${ref} can now control SMC.`);
    }
    if (action === "remove") {
      adminState.controlRoleIds.splice(0, adminState.controlRoleIds.length, ...adminState.controlRoleIds.filter(id => id !== ref.id));
      return message.reply(`✅ **Control role removed**\n${ref} can no longer control SMC.`);
    }
  }

  if (target === "adminrole") {
    if (action === "list") return message.reply("👑 **Admin roles**\n" + (adminState.adminRoleIds.length ? adminState.adminRoleIds.map(id => `<@&${id}>`).join("\n") : "None configured — use ADMIN_USER_IDS for initial access."));
    if (action === "clear") {
      adminState.adminRoleIds.length = 0;
      return message.reply("✅ **Admin role cleared.**\nInitial access remains available through `ADMIN_USER_IDS`.");
    }
    if (action === "set") {
      if (!ref) return message.reply("⚠️ Mention a role.");
      adminState.adminRoleIds.splice(0, adminState.adminRoleIds.length, ref.id);
      return message.reply(`👑 **Admin role updated**\n${ref} is now the SMC admin role.`);
    }
  }

  return message.reply(adminHelp());
}

const uptime = seconds => seconds == null ? "—" : `${Math.floor(seconds / 60)}m ${seconds % 60}s`;

const statusIcon = value => ({
  online: "🟢",
  running: "🟢",
  offline: "⚫",
  stopped: "⚫",
  stopping: "🟡",
  starting: "🟡",
  restarting: "🟡",
  unknown: "⚪"
}[String(value).toLowerCase()] || "⚪");

const format = s => {
  const playerCount = `${s.players?.online ?? "—"}/${s.players?.max ?? s.maxPlayers ?? "—"}`;
  return [
    "**Smarties • Server Status**",
    "",
    `${statusIcon(s.minecraft)} **Minecraft** — ${s.minecraft}`,
    `${statusIcon(s.codespace)} **Codespace** — ${s.codespace}`,
    `${statusIcon(s.agent)} **Agent** — ${s.agent}`,
    `${statusIcon(s.playit)} **Playit** — ${s.playit}`,
    "",
    `**Players** — ${playerCount}`,
    `**Uptime** — ${uptime(s.uptimeSec)}`,
    `**Address** — ${s.publicAddress ? "\`" + s.publicAddress + "\`" : "not available"}`,
    s.error ? `⚠️ **Error** — ${s.error}` : ""
  ].filter(Boolean).join("\n");
};  if (command === "help") return message.reply([
    "**Smarties • SMC**",
    "",
    "**Server**",
    "`smc start` — start Minecraft",
    "`smc stop` — stop when empty",
    "`smc restart` — restart safely",
    "",
    "**Info**",
    "`smc status` — server status",
    "`smc online` — players online",
    "`smc health` — health check",
    "`smc address` — Playit address",
    "`smc logs` — recent log",
    "`smc crash` — crash details",
    "",
    "**Players**",
    "`smc say <message>`",
    "`smc kick <player>`",
    "`smc ban <player>` / `smc pardon <player>`",
    "`smc op <player>` / `smc deop <player>`",
    "`smc whitelist`",
    "`smc save`",
    "",
    "`smc admin` — admin controls"
  ].join("\n"));

