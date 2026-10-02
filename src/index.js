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
  "`smc admin lock` / `smc admin unlock` — lock or unlock controls",
  "`smc admin audit` — show recent actions",
  "",
  "Changes apply immediately and last until the bot restarts."
].join("\n");

async function handleAdmin(message, parts) {
  if (!canAdmin(message.member))
    return message.reply("🔒 **Admin access required.**\nUse the configured admin role or admin user ID.");

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
    if (action === "list") return message.reply("🎮 **Control roles**\n" + (adminState.controlRoleIds.length ? adminState.controlRoleIds.map(id => `<@&${id}>`).join("\n") : "None — control is open to everyone."));
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
    if (action === "list") return message.reply("👑 **Admin roles**\n" + (adminState.adminRoleIds.length ? adminState.adminRoleIds.map(id => `<@&${id}>`).join("\n") : "None configured — use ADMIN_USER_IDS for initial access."));
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
  start: ["Alright, waking the world up.", "Give me a sec, getting the server going.", "Starting it up — one moment."],
  stop: ["Alright, shutting it down cleanly.", "Okay, putting the server to sleep.", "That’s it for now — shutting the world down."],
  restart: ["Alright, giving it a fresh start.", "Restarting it — should be back shortly.", "Okay, clean restart coming up."],
  online: ["Yep, the world is live.", "Here’s who’s in there right now.", "Let’s see who’s online."],
  stopped: ["All good — the world is offline.", "Server’s down cleanly.", "The world’s taking a nap."],
  status: ["Here’s what’s happening right now.", "Let me check the server.", "Yep — here’s the current state."],
  error: ["Hmm, that didn’t quite work.", "Something got in the way there.", "I couldn’t finish that one."],
  help: ["Here’s what you can do.", "These are the SMC commands.", "Alright, command list coming up."]
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
  if (command === "admin") return handleAdmin(message, parts);
  if (!allowed(message.channelId)) return;
  if (command === "status") return message.reply(format(await controller.liveStatus()));
  if (command === "health") return message.reply(controller.formatHealth(await controller.liveStatus()));
  if (command === "logs") return message.reply(controller.formatLogs(await controller.liveStatus()));
  if (command === "crash") return message.reply(controller.formatCrash(await controller.liveStatus()));
  if (command === "properties" || command === "props") return message.reply(controller.formatProperties(await controller.liveStatus()));
  if (command === "address") return message.reply(controller.formatAddress(await controller.liveStatus()));
  if (command === "online") return message.reply(controller.formatOnline(await controller.liveStatus()));
  if (command === "whitelist" && !["add", "remove", "rm", "clear"].includes((parts[2] || "").toLowerCase())) return message.reply(controller.formatWhitelist(await controller.liveStatus()));
  if (command === "help") return message.reply(["**SMC command deck**", pick("help"), "`smc start` — start Minecraft", "`smc stop` — stop only when empty", "`smc restart` — restart Minecraft", "`smc status` — live status", "`smc health` — health snapshot", "`smc online` — players online", "`smc address` — live Playit address", "`smc logs` — recent Minecraft log", "`smc say <message>` — announce in Minecraft", "`smc kick <player>` — kick a player", "`smc ban <player>` / `smc pardon <player>` — ban controls", "`smc op <player>` / `smc deop <player>` — operator controls", "`smc whitelist` / `smc whitelist add/remove/clear` — whitelist file controls (enforcement stays OFF)", "`smc save`, `smc seed`, `smc tps`, `smc version` — server tools", "`smc admin` — permissions, lock, audit and admin controls"].join("\n"));
  if (!canControl(message.member)) return message.reply("🔒 **Control access required.**\nYou need the configured SMC control role or admin role.");
  if (locked) return message.reply("🔒 **SMC controls are locked.**\nAn admin must use `smc admin unlock`.");
  const name = parts[2];
  try {
    let result;
    let working = null;
    const showState = async (title, text) => {
      const body = `🟡 **${title}**
${text}`;
      if (working) await working.edit(body).catch(() => {});
    };

    if (command === "start") {
      working = await message.reply(`🟡 **Starting**
${pick("start")}`);
      result = await controller.startServer((text) => showState("Starting", text));
    }
    else if (command === "stop") {
      working = await message.reply(`🟡 **Stopping**
${pick("stop")}`);
      result = await controller.stopServer((text) => showState("Stopping", text));
    }
    else if (command === "restart") {
      working = await message.reply(`🟡 **Restarting**
${pick("restart")}`);
      result = await controller.restartServer((text) => showState("Restarting", text));
    }
    else if (command === "say") { const msg = parts.slice(2).join(" "); if (!msg) throw new Error("Usage: smc say <message>"); result = await controller.say(msg); }
    else if (command === "set") { if (!canAdmin(message.member)) throw new Error("Admin access required for server.properties."); const key = parts[2]; const value = parts.slice(3).join(" "); if (!key || !value) throw new Error("Usage: smc set <property> <value>"); if (["online-mode","white-list","enforce-whitelist","server-port"].includes(key)) throw new Error("That property is protected by SMC safety rules."); result = await controller.propertySet(key, value); }
    else if (command === "kick") { if (!canAdmin(message.member)) throw new Error("Admin access required for kick."); result = await controller.kick(name); }
    else if (command === "ban") { if (!canAdmin(message.member)) throw new Error("Admin access required for ban."); result = await controller.ban(name); }
    else if (command === "pardon" || command === "unban") { if (!canAdmin(message.member)) throw new Error("Admin access required for unban."); result = await controller.pardon(name); }
    else if (command === "op") { if (!canAdmin(message.member)) throw new Error("Admin access required for op."); result = await controller.op(name); }
    else if (command === "deop") { if (!canAdmin(message.member)) throw new Error("Admin access required for deop."); result = await controller.deop(name); }
    else if (command === "save") result = await controller.save();
    else if (command === "seed") result = await controller.seed();
    else if (command === "tps") result = await controller.tps();
    else if (command === "version") result = await controller.version();
    else if (command === "whitelist") { const sub = (parts[2] || "list").toLowerCase(); if (sub === "add") result = await controller.whitelistAdd(parts[3]); else if (sub === "remove" || sub === "rm") result = await controller.whitelistRemove(parts[3]); else if (sub === "clear") result = await controller.whitelistClear(); else return message.reply(controller.formatWhitelist(await controller.liveStatus())); }
    else if (command === "command") { if (!canAdmin(message.member)) return message.reply("👑 **Admin access required for arbitrary Minecraft commands.**"); const raw = parts.slice(2).join(" "); if (!raw) throw new Error("Usage: smc command <minecraft command>"); result = await controller.command(raw); }
    else return message.reply("⚠️ Unknown command. Use `smc help`.");

    record(message, parts.slice(1).join(" "), "completed");

    if (working) {
      if (command === "start") return working.edit(`🟢 **Started**
${pick("online")}

${format(result)}`);
      if (command === "stop") return working.edit(`🔴 **Stopped**\nThe server is safely offline.`);
      if (command === "restart") return working.edit(`🟢 **Restarted**
${pick("online")}

${format(result)}`);
    }

    return message.reply(`✅ **Done** — ${parts.slice(1).join(" ")} completed.`);
  } catch (error) { record(message, parts.slice(1).join(" "), "error"); return message.reply(`⚠️ **SMC couldn’t complete that.**\n\`${String(error.message || error).replace(/\`/g, "'")}\``); }
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

async function notify(text) {
  if (!config.notifyChannelId) return;
  try { const ch = await client.channels.fetch(config.notifyChannelId); if (ch?.isTextBased()) await ch.send(text); } catch (error) { console.error("Notification failed:", error.message); }
}
let monitorSnapshot = null;
let emptySince = null;
let crashRecovery = { key: null, attempts: 0, lastAttemptAt: 0 };
setInterval(async () => {
  try {
    const s = await controller.liveStatus();
    const compact = [s.codespace, s.minecraft, s.playit, s.publicAddress, s.players?.online ?? null].join("|");
    if (monitorSnapshot && compact !== monitorSnapshot) {
      const old = monitorSnapshot.split("|");
      if (s.minecraft !== old[1] && s.minecraft === "running") await notify("🟢 **Minecraft is back online.**");
      if (s.publicAddress && s.publicAddress !== old[3]) await notify(`🌐 **Playit address:** ${s.publicAddress}`);
    }

    if (s.crashed) {
      const key = `${s.lastCrashAt || "unknown"}:${s.lastExit ?? "unknown"}`;
      if (crashRecovery.key !== key) crashRecovery = { key, attempts: 0, lastAttemptAt: 0 };
      if (crashRecovery.attempts < config.crashMaxRetries && Date.now() - crashRecovery.lastAttemptAt >= config.crashCooldownMs && !controller.operation()) {
        crashRecovery.attempts += 1;
        crashRecovery.lastAttemptAt = Date.now();
        await notify(`🚨 **Minecraft just crashed.**\nExit code: **${s.lastExit ?? "unknown"}**\nI’m going to try bringing it back up (attempt ${crashRecovery.attempts}/${config.crashMaxRetries}).\n\nLast few log lines:\n\`\`\`\n${(s.logTail || []).slice(-8).join("\n").slice(-1800)}\n\`\`\``);
        try {
          await controller.restartServer();
          await notify("🟢 **It’s back.** Minecraft started again after the crash.");
        } catch (error) {
          await notify(`⚠️ **I couldn’t bring Minecraft back automatically.**\n${error.message}\n\nI’ve left it alone so it doesn’t get stuck in a restart loop.`);
        }
      } else if (crashRecovery.attempts >= config.crashMaxRetries && Date.now() - crashRecovery.lastAttemptAt >= config.crashCooldownMs) {
        await notify("🛑 **Minecraft crashed again.** I’m not going to keep restarting it automatically. Check `smc crash` and `smc logs` before starting it again.");
        crashRecovery.lastAttemptAt = Date.now();
      }
    }

    monitorSnapshot = compact;
    if (s.minecraft === "running" && s.players?.online === 0) {
      if (!emptySince) emptySince = Date.now();
      const idleMs = config.idleMinutes * 60 * 1000;
      if (idleMs > 0 && Date.now() - emptySince >= idleMs && !controller.operation()) {
        await notify(`🛌 **SMC idle shutdown:** no players for ${config.idleMinutes} minutes.`);
        try { await controller.stopServer(); } catch (error) { await notify("⚠️ Idle shutdown was blocked: " + error.message); }
        emptySince = null;
      }
    } else emptySince = null;
  } catch (error) { console.error("SMC monitor error:", error.message); }
}, 10000);
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
